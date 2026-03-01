import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { pushBranch, createPullRequest, closePullRequest } from "../execution/shared/githubClient.js";
import { getCodeChangeById } from "../state/codeChanges.js";
import { getProjectById } from "../state/projects.js";
import {
  savePullRequest,
  getPullRequestById,
  updatePullRequestStatus,
} from "../state/pullRequests.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import type { ExecutionEventEmitter } from "../execution/shared/executionEventEmitter.js";

const DEFAULT_MAX_AUTO_RISK = 2;

export interface PRActionResult {
  readonly success: boolean;
  readonly message: string;
  readonly prId?: string;
}

function getMaxAutoRisk(): number {
  const envValue = process.env.PR_MAX_AUTO_RISK;
  if (!envValue) return DEFAULT_MAX_AUTO_RISK;
  const parsed = Number.parseInt(envValue, 10);
  return Number.isNaN(parsed) ? DEFAULT_MAX_AUTO_RISK : parsed;
}

function buildPRTitle(description: string, changeId: string): string {
  const shortId = changeId.slice(0, 8);
  const shortDesc = description.slice(0, 80);
  return `forge(${shortId}): ${shortDesc}`;
}

function buildPRBody(
  description: string,
  filesChanged: string,
  risk: number,
  diff: string | null,
): string {
  let filesList: string;
  try {
    const files = JSON.parse(filesChanged) as readonly string[];
    filesList = files.map((f) => `- ${f}`).join("\n");
  } catch {
    filesList = `- ${filesChanged}`;
  }

  const sections = [
    `## Objetivo`,
    description,
    ``,
    `## Arquivos Alterados`,
    filesList,
    ``,
    `## Risco`,
    `Nivel: ${risk}/5`,
    ``,
    `## Rollback`,
    `Fechar este PR e deletar o branch remoto.`,
    ``,
    `---`,
    `*PR criado automaticamente pelo agente FORGE via connexto-axiom.*`,
  ];

  if (diff) {
    const truncatedDiff =
      diff.length > 3000 ? `${diff.slice(0, 3000)}\n\n... (diff truncado)` : diff;
    sections.splice(8, 0, `## Diff`, "```diff", truncatedDiff, "```", ``);
  }

  return sections.join("\n");
}

function resolveBaseBranch(db: BetterSqlite3.Database, projectId: string | null): string {
  if (!projectId) return "main";
  const project = getProjectById(db, projectId);
  return project?.base_branch ?? "main";
}

export async function createPRForCodeChange(
  db: BetterSqlite3.Database,
  changeId: string,
  emitter?: ExecutionEventEmitter,
): Promise<PRActionResult> {
  const change = getCodeChangeById(db, changeId);

  if (!change) {
    return { success: false, message: `Code change "${changeId}" nao encontrado.` };
  }

  const baseBranch = resolveBaseBranch(db, change.project_id);

  if (change.status !== "applied") {
    return {
      success: false,
      message: `Code change nao esta aplicado (status: ${change.status}). PR nao criado.`,
    };
  }

  if (!change.branch_name) {
    return {
      success: false,
      message: `Code change "${changeId}" nao possui branch associado.`,
    };
  }

  if (!change.diff) {
    return {
      success: false,
      message: `Code change "${changeId}" nao possui diff persistido.`,
    };
  }

  const repo = process.env.GITHUB_REPO;
  if (!repo) {
    return { success: false, message: "GITHUB_REPO nao configurado." };
  }

  const title = buildPRTitle(change.description, changeId);
  const body = buildPRBody(change.description, change.files_changed, change.risk, change.diff);

  const prId = savePullRequest(db, {
    codeChangeId: changeId,
    repo,
    branchName: change.branch_name,
    title,
    body,
    risk: change.risk,
  });

  const maxAutoRisk = getMaxAutoRisk();

  if (change.risk > maxAutoRisk) {
    updatePullRequestStatus(db, prId, { status: "pending_approval" });

    emitter?.warn("forge", "forge:pr_pending_approval", `PR pending approval (risk ${change.risk}/5 > limit ${maxAutoRisk})`, {
      phase: "delivery",
      metadata: { prId: prId.slice(0, 8), branchName: change.branch_name, risk: change.risk, maxAutoRisk, baseBranch },
    });

    const message = [
      `*PR Pendente de Aprovacao*`,
      `ID: \`${prId.slice(0, 8)}\``,
      `Branch: \`${change.branch_name}\``,
      `Risco: ${change.risk}/5 (limite auto: ${maxAutoRisk})`,
      `Descricao: ${change.description.slice(0, 120)}`,
      ``,
      `Use /approve_pr ${prId.slice(0, 8)} para aprovar o push e criacao do PR.`,
      `Use /reject_pr ${prId.slice(0, 8)} para cancelar.`,
    ].join("\n");

    await sendTelegramMessage(message);

    logger.info(
      { prId, changeId, risk: change.risk, maxAutoRisk },
      "PR requires human approval before push (high risk)",
    );

    return {
      success: true,
      message: `PR criado com status pending_approval (risco ${change.risk} > limite ${maxAutoRisk}).`,
      prId,
    };
  }

  return executePushAndCreatePR(db, prId, baseBranch, emitter);
}

export async function approvePR(
  db: BetterSqlite3.Database,
  prId: string,
  approvedBy: string,
): Promise<PRActionResult> {
  const pr = getPullRequestById(db, prId);

  if (!pr) {
    return { success: false, message: `PR "${prId}" nao encontrado.` };
  }

  if (pr.status !== "pending_approval") {
    return {
      success: false,
      message: `PR nao esta aguardando aprovacao (status: ${pr.status}).`,
    };
  }

  logger.info({ prId, approvedBy }, "PR approved for push");

  return executePushAndCreatePR(db, prId);
}

export async function rejectPR(db: BetterSqlite3.Database, prId: string): Promise<PRActionResult> {
  const pr = getPullRequestById(db, prId);

  if (!pr) {
    return { success: false, message: `PR "${prId}" nao encontrado.` };
  }

  if (pr.status !== "pending_approval") {
    return {
      success: false,
      message: `PR nao esta aguardando aprovacao (status: ${pr.status}).`,
    };
  }

  updatePullRequestStatus(db, prId, { status: "closed" });
  logger.info({ prId }, "PR rejected, status set to closed");

  return {
    success: true,
    message: `PR ${prId.slice(0, 8)} rejeitado e fechado.`,
  };
}

export async function closePR(db: BetterSqlite3.Database, prId: string): Promise<PRActionResult> {
  const pr = getPullRequestById(db, prId);

  if (!pr) {
    return { success: false, message: `PR "${prId}" nao encontrado.` };
  }

  if (pr.status !== "open" || !pr.pr_number) {
    return {
      success: false,
      message: `PR nao esta aberto ou nao possui numero (status: ${pr.status}).`,
    };
  }

  try {
    await closePullRequest(pr.pr_number);
    updatePullRequestStatus(db, prId, { status: "closed" });

    return {
      success: true,
      message: `PR #${pr.pr_number} fechado com sucesso no GitHub.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ prId, error: message }, "Failed to close PR on GitHub");
    return { success: false, message: `Erro ao fechar PR: ${message}` };
  }
}

async function executePushAndCreatePR(
  db: BetterSqlite3.Database,
  prId: string,
  baseBranch = "main",
  emitter?: ExecutionEventEmitter,
): Promise<PRActionResult> {
  const pr = getPullRequestById(db, prId);

  if (!pr) {
    return { success: false, message: `PR "${prId}" nao encontrado.` };
  }

  emitter?.info("forge", "forge:push_started", `Pushing branch ${pr.branch_name} to remote`, {
    phase: "delivery",
    metadata: { prId: prId.slice(0, 8), branchName: pr.branch_name },
  });

  try {
    await pushBranch(pr.branch_name);
    logger.info({ prId, branchName: pr.branch_name }, "Branch pushed to remote");

    emitter?.info("forge", "forge:push_completed", `Branch ${pr.branch_name} pushed to remote`, {
      phase: "delivery",
      metadata: { prId: prId.slice(0, 8), branchName: pr.branch_name },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updatePullRequestStatus(db, prId, { status: "closed" });
    logger.error({ prId, error: message }, "Failed to push branch");

    emitter?.error("forge", "forge:push_failed", `Push failed: ${message.slice(0, 200)}`, {
      phase: "delivery",
      metadata: { prId: prId.slice(0, 8), branchName: pr.branch_name, error: message.slice(0, 300) },
    });

    return { success: false, message: `Erro ao fazer push: ${message}` };
  }

  emitter?.info("forge", "forge:pr_creating", `Creating PR: ${pr.branch_name} → ${baseBranch}`, {
    phase: "delivery",
    metadata: { prId: prId.slice(0, 8), head: pr.branch_name, base: baseBranch },
  });

  try {
    const ghPR = await createPullRequest({
      title: pr.title,
      body: pr.body,
      head: pr.branch_name,
      base: baseBranch,
    });

    updatePullRequestStatus(db, prId, {
      status: "open",
      prNumber: ghPR.number,
      prUrl: ghPR.html_url,
    });

    logger.info(
      { prId, prNumber: ghPR.number, prUrl: ghPR.html_url },
      "Pull request created on GitHub",
    );

    emitter?.info("forge", "forge:pr_created", `PR #${ghPR.number} created: ${ghPR.html_url}`, {
      phase: "delivery",
      metadata: { prId: prId.slice(0, 8), prNumber: ghPR.number, prUrl: ghPR.html_url, baseBranch },
    });

    return {
      success: true,
      message: `PR #${ghPR.number} criado: ${ghPR.html_url}`,
      prId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updatePullRequestStatus(db, prId, { status: "closed" });
    logger.error({ prId, error: message }, "Failed to create pull request on GitHub");

    emitter?.error("forge", "forge:pr_failed", `PR creation failed: ${message.slice(0, 200)}`, {
      phase: "delivery",
      metadata: { prId: prId.slice(0, 8), error: message.slice(0, 300) },
    });

    return { success: false, message: `Erro ao criar PR no GitHub: ${message}` };
  }
}
