import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { listForgeBranches, getBranchCommits } from "../execution/shared/gitManager.js";
import { publishArtifact } from "../execution/shared/publisher.js";
import { listPendingDrafts, approveDraft, rejectDraft } from "../services/approvalService.js";
import {
  listPendingCodeChanges,
  approveCodeChange,
  rejectCodeChange,
} from "../services/codeChangeService.js";
import { saveManualMetrics } from "../services/metricsCollector.js";
import {
  checkMergeReadiness,
  confirmMerge,
  markPRMerged,
} from "../services/mergeReadinessService.js";
import { approvePR, rejectPR } from "../services/pullRequestService.js";
import { getArtifactById } from "../state/artifacts.js";
import { getCodeChangeById } from "../state/codeChanges.js";
import { getPendingApprovalPRs, getOpenPRs, getReadyForMergePRs } from "../state/pullRequests.js";
import type { PullRequest } from "../state/pullRequests.js";

const POLLING_TIMEOUT_SECONDS = 30;
const ERROR_BACKOFF_MS = 5000;
const TITLE_MAX_LENGTH = 50;

interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: {
    readonly chat: { readonly id: number };
    readonly text?: string;
  };
}

interface TelegramResponse {
  readonly ok: boolean;
  readonly result: readonly TelegramUpdate[];
}

export async function startTelegramBot(db: BetterSqlite3.Database): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Bot cannot start.");
    return;
  }

  const authorizedChatId = Number(chatId);
  logger.info({ authorizedChatId }, "Telegram bot starting (long-polling)...");

  let offset = 0;

  while (true) {
    try {
      const updates = await fetchUpdates(token, offset);

      for (const update of updates) {
        offset = update.update_id + 1;

        if (!update.message?.text) {
          continue;
        }

        if (update.message.chat.id !== authorizedChatId) {
          logger.warn(
            { chatId: update.message.chat.id },
            "Unauthorized chat tried to send command",
          );
          continue;
        }

        await handleCommand(db, token, authorizedChatId, update.message.text);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Telegram polling error, retrying...");
      await sleep(ERROR_BACKOFF_MS);
    }
  }
}

async function fetchUpdates(token: string, offset: number): Promise<readonly TelegramUpdate[]> {
  const url = `https://api.telegram.org/bot${token}/getUpdates`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offset,
      timeout: POLLING_TIMEOUT_SECONDS,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram getUpdates failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as TelegramResponse;
  return data.result;
}

async function handleCommand(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  const [command, ...args] = trimmed.split(/\s+/);
  const normalizedCommand = command?.toLowerCase();

  logger.info({ command: normalizedCommand, args }, "Processing Telegram command");

  switch (normalizedCommand) {
    case "/drafts":
      await handleDrafts(db, token, chatId);
      break;
    case "/approve":
      await handleApprove(db, token, chatId, args[0]);
      break;
    case "/reject":
      await handleReject(db, token, chatId, args[0]);
      break;
    case "/publish":
      await handlePublish(db, token, chatId, args[0]);
      break;
    case "/metrics":
      await handleMetrics(db, token, chatId, args);
      break;
    case "/changes":
      await handleChanges(db, token, chatId);
      break;
    case "/approve_change":
      await handleApproveChange(db, token, chatId, args[0]);
      break;
    case "/reject_change":
      await handleRejectChange(db, token, chatId, args[0]);
      break;
    case "/branches":
      await handleBranches(token, chatId);
      break;
    case "/prs":
      await handlePRs(db, token, chatId);
      break;
    case "/approve_pr":
      await handleApprovePR(db, token, chatId, args[0]);
      break;
    case "/reject_pr":
      await handleRejectPR(db, token, chatId, args[0]);
      break;
    case "/merge_check":
      await handleMergeCheck(db, token, chatId, args[0]);
      break;
    case "/merge_status":
      await handleMergeStatus(db, token, chatId);
      break;
    case "/confirm_merge":
      await handleConfirmMerge(db, token, chatId, args[0]);
      break;
    case "/mark_merged":
      await handleMarkMerged(db, token, chatId, args[0]);
      break;
    case "/help":
    case "/start":
      await handleHelp(token, chatId);
      break;
    default:
      await sendMessage(
        token,
        chatId,
        "Comando nao reconhecido. Use /help para ver os comandos disponiveis.",
      );
  }
}

async function handleDrafts(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
): Promise<void> {
  const drafts = listPendingDrafts(db);

  if (drafts.length === 0) {
    await sendMessage(token, chatId, "Nenhum draft pendente.");
    return;
  }

  const lines = drafts.map((d) => {
    const shortId = d.id.slice(0, 8);
    const truncatedTitle =
      d.title.length > TITLE_MAX_LENGTH ? `${d.title.slice(0, TITLE_MAX_LENGTH)}...` : d.title;
    return `- [${shortId}] (${d.type}) ${truncatedTitle}`;
  });

  const message = `Drafts pendentes (${drafts.length}):\n\n${lines.join("\n")}\n\nUse /approve <id> ou /reject <id>`;
  await sendMessage(token, chatId, message);
}

async function handleApprove(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  idArg: string | undefined,
): Promise<void> {
  if (!idArg) {
    await sendMessage(token, chatId, "Uso: /approve <id>\nExemplo: /approve abc12345");
    return;
  }

  const artifactId = resolveArtifactId(db, idArg);
  if (!artifactId) {
    await sendMessage(token, chatId, `Artifact com ID "${idArg}" nao encontrado.`);
    return;
  }

  const result = approveDraft(db, artifactId, `telegram:${chatId}`);
  await sendMessage(token, chatId, result.message);
}

async function handleReject(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  idArg: string | undefined,
): Promise<void> {
  if (!idArg) {
    await sendMessage(token, chatId, "Uso: /reject <id>\nExemplo: /reject abc12345");
    return;
  }

  const artifactId = resolveArtifactId(db, idArg);
  if (!artifactId) {
    await sendMessage(token, chatId, `Artifact com ID "${idArg}" nao encontrado.`);
    return;
  }

  const result = rejectDraft(db, artifactId, `telegram:${chatId}`);
  await sendMessage(token, chatId, result.message);
}

async function handlePublish(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  idArg: string | undefined,
): Promise<void> {
  if (!idArg) {
    await sendMessage(token, chatId, "Uso: /publish <id>\nExemplo: /publish abc12345");
    return;
  }

  const artifactId = resolveArtifactId(db, idArg);
  if (!artifactId) {
    await sendMessage(token, chatId, `Artifact com ID "${idArg}" nao encontrado.`);
    return;
  }

  const result = publishArtifact(db, artifactId);

  if (result.success) {
    await sendMessage(
      token,
      chatId,
      `Publicado! ${result.message}\nPublication ID: ${result.publicationId}`,
    );
  } else {
    await sendMessage(token, chatId, result.message);
  }
}

async function handleMetrics(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  args: readonly string[],
): Promise<void> {
  if (args.length < 4) {
    await sendMessage(
      token,
      chatId,
      "Uso: /metrics <id> <impressions> <clicks> <engagement>\nExemplo: /metrics abc12345 500 50 85.0",
    );
    return;
  }

  const [idArg, impressionsStr, clicksStr, engagementStr] = args;

  const artifactId = resolveArtifactId(db, idArg);
  if (!artifactId) {
    await sendMessage(token, chatId, `Artifact com ID "${idArg}" nao encontrado.`);
    return;
  }

  const impressions = Number(impressionsStr);
  const clicks = Number(clicksStr);
  const engagement = Number(engagementStr);

  if (Number.isNaN(impressions) || Number.isNaN(clicks) || Number.isNaN(engagement)) {
    await sendMessage(token, chatId, "Valores invalidos. Todos devem ser numericos.");
    return;
  }

  if (impressions < 0 || clicks < 0 || engagement < 0 || engagement > 100) {
    await sendMessage(
      token,
      chatId,
      "Valores fora do intervalo. Impressions e clicks >= 0, engagement entre 0 e 100.",
    );
    return;
  }

  const result = saveManualMetrics(db, artifactId, impressions, clicks, engagement);
  await sendMessage(token, chatId, result.message);
}

async function handleChanges(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
): Promise<void> {
  const changes = listPendingCodeChanges(db);

  if (changes.length === 0) {
    await sendMessage(token, chatId, "Nenhuma mudanca de codigo pendente de aprovacao.");
    return;
  }

  const lines = changes.map((c) => {
    const shortId = c.id.slice(0, 8);
    const files = JSON.parse(c.files_changed) as readonly string[];
    const fileCount = files.length;
    const truncatedDesc =
      c.description.length > TITLE_MAX_LENGTH
        ? `${c.description.slice(0, TITLE_MAX_LENGTH)}...`
        : c.description;
    const branchTag = c.branch_name ? ` [${c.branch_name}]` : "";
    return `- [${shortId}] R:${c.risk} (${fileCount} arquivo${fileCount > 1 ? "s" : ""})${branchTag} ${truncatedDesc}`;
  });

  const message = `Mudancas de codigo pendentes (${changes.length}):\n\n${lines.join("\n")}\n\nUse /approve_change <id> ou /reject_change <id>`;
  await sendMessage(token, chatId, message);
}

async function handleApproveChange(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  idArg: string | undefined,
): Promise<void> {
  if (!idArg) {
    await sendMessage(
      token,
      chatId,
      "Uso: /approve_change <id>\nExemplo: /approve_change abc12345",
    );
    return;
  }

  const changeId = resolveCodeChangeId(db, idArg);
  if (!changeId) {
    await sendMessage(token, chatId, `Mudanca com ID "${idArg}" nao encontrada.`);
    return;
  }

  const result = await approveCodeChange(db, changeId, `telegram:${chatId}`);
  await sendMessage(token, chatId, result.message);
}

async function handleRejectChange(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  idArg: string | undefined,
): Promise<void> {
  if (!idArg) {
    await sendMessage(token, chatId, "Uso: /reject_change <id>\nExemplo: /reject_change abc12345");
    return;
  }

  const changeId = resolveCodeChangeId(db, idArg);
  if (!changeId) {
    await sendMessage(token, chatId, `Mudanca com ID "${idArg}" nao encontrada.`);
    return;
  }

  const result = await rejectCodeChange(db, changeId, `telegram:${chatId}`);
  await sendMessage(token, chatId, result.message);
}

async function handleBranches(token: string, chatId: number): Promise<void> {
  try {
    const branches = await listForgeBranches();

    if (branches.length === 0) {
      await sendMessage(token, chatId, "Nenhuma branch local do FORGE encontrada.");
      return;
    }

    const lines: string[] = [];
    for (const branch of branches) {
      const commits = await getBranchCommits(branch);
      const commitCount = commits.length;
      const lastCommit = commits[0]?.message ?? "sem commits";
      lines.push(
        `- ${branch} (${commitCount} commit${commitCount === 1 ? "" : "s"}) — ${lastCommit}`,
      );
    }

    const message = `Branches locais FORGE (${branches.length}):\n\n${lines.join("\n")}`;
    await sendMessage(token, chatId, message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Failed to list forge branches");
    await sendMessage(token, chatId, `Erro ao listar branches: ${message}`);
  }
}

async function handlePRs(db: BetterSqlite3.Database, token: string, chatId: number): Promise<void> {
  const pending = getPendingApprovalPRs(db);
  const open = getOpenPRs(db);

  if (pending.length === 0 && open.length === 0) {
    await sendMessage(token, chatId, "Nenhum PR pendente ou aberto.");
    return;
  }

  const lines: string[] = [];

  if (pending.length > 0) {
    lines.push(`Aguardando aprovacao (${pending.length}):`);
    for (const pr of pending) {
      lines.push(formatPRLine(pr));
    }
    lines.push("");
  }

  if (open.length > 0) {
    lines.push(`PRs abertos (${open.length}):`);
    for (const pr of open) {
      lines.push(formatPRLine(pr));
    }
  }

  lines.push("", "Use /approve_pr <id> ou /reject_pr <id>");

  await sendMessage(token, chatId, lines.join("\n"));
}

function formatPRLine(pr: PullRequest): string {
  const shortId = pr.id.slice(0, 8);
  const prLink = pr.pr_url ? ` ${pr.pr_url}` : "";
  const prNum = pr.pr_number ? ` #${pr.pr_number}` : "";
  return `- [${shortId}] R:${pr.risk} ${pr.branch_name}${prNum}${prLink}`;
}

async function handleApprovePR(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  idArg: string | undefined,
): Promise<void> {
  if (!idArg) {
    await sendMessage(token, chatId, "Uso: /approve_pr <id>\nExemplo: /approve_pr abc12345");
    return;
  }

  const prId = resolvePullRequestId(db, idArg);
  if (!prId) {
    await sendMessage(token, chatId, `PR com ID "${idArg}" nao encontrado.`);
    return;
  }

  const result = await approvePR(db, prId, `telegram:${chatId}`);
  await sendMessage(token, chatId, result.message);
}

async function handleRejectPR(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  idArg: string | undefined,
): Promise<void> {
  if (!idArg) {
    await sendMessage(token, chatId, "Uso: /reject_pr <id>\nExemplo: /reject_pr abc12345");
    return;
  }

  const prId = resolvePullRequestId(db, idArg);
  if (!prId) {
    await sendMessage(token, chatId, `PR com ID "${idArg}" nao encontrado.`);
    return;
  }

  const result = await rejectPR(db, prId);
  await sendMessage(token, chatId, result.message);
}

function resolvePullRequestId(db: BetterSqlite3.Database, partialId: string): string | undefined {
  const row = db
    .prepare("SELECT id FROM pull_requests WHERE id LIKE ? LIMIT 2")
    .all(`${partialId}%`) as ReadonlyArray<{ id: string }>;

  if (row.length === 1) {
    return row[0].id;
  }

  return undefined;
}

async function handleMergeCheck(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  idArg: string | undefined,
): Promise<void> {
  if (!idArg) {
    await sendMessage(token, chatId, "Uso: /merge_check <pr_id>\nExemplo: /merge_check abc12345");
    return;
  }

  const prId = resolvePullRequestId(db, idArg);
  if (!prId) {
    await sendMessage(token, chatId, `PR com ID "${idArg}" nao encontrado.`);
    return;
  }

  await sendMessage(token, chatId, "Verificando merge readiness...");

  const result = await checkMergeReadiness(db, prId);
  await sendMessage(token, chatId, result.message);
}

async function handleMergeStatus(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
): Promise<void> {
  const ready = getReadyForMergePRs(db);
  const open = getOpenPRs(db);
  const blocked = open.filter(
    (pr) => pr.merge_status === "blocked" || pr.merge_status === "unchecked" || !pr.merge_status,
  );

  if (ready.length === 0 && blocked.length === 0) {
    await sendMessage(token, chatId, "Nenhum PR aberto para merge.");
    return;
  }

  const lines: string[] = [];

  if (ready.length > 0) {
    lines.push(`Prontos para merge (${ready.length}):`);
    for (const pr of ready) {
      const status = pr.merge_status === "confirmed" ? " [CONFIRMADO]" : "";
      lines.push(`${formatPRLine(pr)}${status}`);
    }
    lines.push("");
  }

  if (blocked.length > 0) {
    lines.push(`Aguardando acao (${blocked.length}):`);
    for (const pr of blocked) {
      const tag = pr.merge_status === "blocked" ? " [BLOQUEADO]" : " [NAO VERIFICADO]";
      lines.push(`${formatPRLine(pr)}${tag}`);
    }
  }

  lines.push("", "Use /merge_check <id> para verificar um PR.");

  await sendMessage(token, chatId, lines.join("\n"));
}

async function handleConfirmMerge(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  idArg: string | undefined,
): Promise<void> {
  if (!idArg) {
    await sendMessage(
      token,
      chatId,
      "Uso: /confirm_merge <pr_id>\nExemplo: /confirm_merge abc12345",
    );
    return;
  }

  const prId = resolvePullRequestId(db, idArg);
  if (!prId) {
    await sendMessage(token, chatId, `PR com ID "${idArg}" nao encontrado.`);
    return;
  }

  const result = await confirmMerge(db, prId, `telegram:${chatId}`);
  await sendMessage(token, chatId, result.message);
}

async function handleMarkMerged(
  db: BetterSqlite3.Database,
  token: string,
  chatId: number,
  idArg: string | undefined,
): Promise<void> {
  if (!idArg) {
    await sendMessage(token, chatId, "Uso: /mark_merged <pr_id>\nExemplo: /mark_merged abc12345");
    return;
  }

  const prId = resolvePullRequestId(db, idArg);
  if (!prId) {
    await sendMessage(token, chatId, `PR com ID "${idArg}" nao encontrado.`);
    return;
  }

  const result = await markPRMerged(db, prId);
  await sendMessage(token, chatId, result.message);
}

async function handleHelp(token: string, chatId: number): Promise<void> {
  const helpText = [
    "Comandos disponiveis:",
    "",
    "/drafts — Lista drafts pendentes de aprovacao",
    "/approve <id> — Aprova um draft",
    "/reject <id> — Rejeita um draft",
    "/publish <id> — Publica um artifact aprovado (stub v1)",
    "/metrics <id> <impressions> <clicks> <engagement> — Registra metricas manuais",
    "/changes — Lista mudancas de codigo pendentes",
    "/approve_change <id> — Aprova e aplica uma mudanca de codigo",
    "/reject_change <id> — Rejeita uma mudanca de codigo",
    "/branches — Lista branches locais do FORGE",
    "/prs — Lista PRs pendentes e abertos",
    "/approve_pr <id> — Aprova push e criacao de PR",
    "/reject_pr <id> — Cancela um PR pendente",
    "/merge_check <id> — Verifica se PR esta pronto para merge",
    "/merge_status — Lista PRs prontos e bloqueados para merge",
    "/confirm_merge <id> — Confirma merge de PR de alto risco",
    "/mark_merged <id> — Marca PR como mergeado apos acao no GitHub",
    "/help — Mostra esta mensagem",
    "",
    "IDs podem ser parciais (primeiros 8 caracteres).",
  ].join("\n");

  await sendMessage(token, chatId, helpText);
}

function resolveArtifactId(db: BetterSqlite3.Database, partialId: string): string | undefined {
  const direct = getArtifactById(db, partialId);
  if (direct) {
    return direct.id;
  }

  const row = db
    .prepare("SELECT id FROM artifacts WHERE id LIKE ? LIMIT 2")
    .all(`${partialId}%`) as ReadonlyArray<{ id: string }>;

  if (row.length === 1) {
    return row[0].id;
  }

  return undefined;
}

function resolveCodeChangeId(db: BetterSqlite3.Database, partialId: string): string | undefined {
  const direct = getCodeChangeById(db, partialId);
  if (direct) {
    return direct.id;
  }

  const row = db
    .prepare("SELECT id FROM code_changes WHERE id LIKE ? LIMIT 2")
    .all(`${partialId}%`) as ReadonlyArray<{ id: string }>;

  if (row.length === 1) {
    return row[0].id;
  }

  return undefined;
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error({ status: response.status, body }, "Failed to send Telegram message");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
