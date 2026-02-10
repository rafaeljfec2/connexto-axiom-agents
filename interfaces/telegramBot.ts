import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { publishArtifact } from "../execution/publisher.js";
import { listPendingDrafts, approveDraft, rejectDraft } from "../services/approvalService.js";
import { saveManualMetrics } from "../services/metricsCollector.js";
import { getArtifactById } from "../state/artifacts.js";

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

async function handleHelp(token: string, chatId: number): Promise<void> {
  const helpText = [
    "Comandos disponiveis:",
    "",
    "/drafts — Lista drafts pendentes de aprovacao",
    "/approve <id> — Aprova um draft",
    "/reject <id> — Rejeita um draft",
    "/publish <id> — Publica um artifact aprovado (stub v1)",
    "/metrics <id> <impressions> <clicks> <engagement> — Registra metricas manuais",
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
