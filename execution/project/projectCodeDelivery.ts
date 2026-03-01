import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import { sendTelegramMessage } from "../../interfaces/telegram.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import { logAudit, hashContent } from "../../state/auditLog.js";
import { saveCodeChange, updateCodeChangeStatus } from "../../state/codeChanges.js";
import type { ForgeCodeOutput } from "../forge/forgeAgentLoop.js";
import {
  commitVerifiedChanges,
  validateAndCalculateRisk,
} from "./projectCodeApplier.js";
import type { CommitOptions } from "./projectCodeApplier.js";
import type { ExecutionResult } from "../shared/types.js";
import { isImplementationTask, buildResult } from "./projectCodeHelpers.js";

const MAX_FILES_PER_CHANGE = 5;

export interface SuccessfulAgentOutputContext {
  readonly db: BetterSqlite3.Database;
  readonly delegation: KairosDelegation;
  readonly projectId: string;
  readonly workspacePath: string;
  readonly repoSource: string;
  readonly parsed: ForgeCodeOutput;
  readonly totalTokensUsed: number;
  readonly lintOutput: string;
  readonly startTime: number;
  readonly commitOptions?: CommitOptions;
  readonly maxFilesOverride?: number;
}

export async function handleSuccessfulAgentOutput(
  ctx: SuccessfulAgentOutputContext,
): Promise<ExecutionResult> {
  const { db, delegation, projectId, workspacePath, repoSource, parsed, totalTokensUsed, lintOutput, startTime } = ctx;
  const { task, goal_id } = delegation;

  if (parsed.files.length === 0) {
    const executionTimeMs = Math.round(performance.now() - startTime);

    if (isImplementationTask(task)) {
      logger.warn(
        { projectId, task: task.slice(0, 100), description: parsed.description.slice(0, 80) },
        "FORGE returned no file changes for an implementation task",
      );
      return buildResult(task, "failed", "", `Implementation task produced no changes: ${parsed.description.slice(0, 120)}`, executionTimeMs, totalTokensUsed);
    }

    logger.info({ projectId, description: parsed.description.slice(0, 80) }, "FORGE returned no file changes, completing without commit");
    return buildResult(task, "success", `[${projectId}] Nenhuma alteracao necessaria: ${parsed.description}`, undefined, executionTimeMs, totalTokensUsed);
  }

  const maxFiles = ctx.maxFilesOverride ?? MAX_FILES_PER_CHANGE;
  if (parsed.files.length > maxFiles) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(task, "failed", "", `Too many files: ${String(parsed.files.length)} (max ${String(maxFiles)})`, executionTimeMs, totalTokensUsed);
  }

  const riskResult = validateAndCalculateRisk(parsed.files, workspacePath);
  if (!riskResult.valid) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(task, "failed", "", `Path validation failed: ${riskResult.errors.join("; ")}`, executionTimeMs, totalTokensUsed);
  }

  const effectiveRisk = Math.max(riskResult.risk, parsed.risk);
  const filePaths = parsed.files.map((f) => f.path);
  const pendingFilesJson = JSON.stringify(
    parsed.files.map((f) => ({ path: f.path, action: f.action, content: f.content, edits: f.edits })),
  );

  const changeId = saveCodeChange(db, {
    taskId: goal_id,
    description: parsed.description,
    filesChanged: filePaths,
    risk: effectiveRisk,
    pendingFiles: pendingFilesJson,
    projectId,
  });

  logAudit(db, {
    agent: "forge",
    action: task,
    inputHash: hashContent(task),
    outputHash: hashContent(JSON.stringify(parsed)),
    sanitizerWarnings: [],
    runtime: "openclaw",
  });

  const commitResult = await commitVerifiedChanges({
    db, changeId, description: parsed.description, filePaths, workspacePath, lintOutput, repoSource,
    options: ctx.commitOptions,
  });

  if (!commitResult.success) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    updateCodeChangeStatus(db, changeId, {
      status: "failed",
      testOutput: commitResult.lintOutput,
      error: commitResult.error ?? "Commit failed after agent loop",
    });
    return buildResult(task, "failed", "", `Project code change commit failed: ${commitResult.error ?? "unknown"}`, executionTimeMs, totalTokensUsed);
  }

  if (effectiveRisk >= 3) {
    updateCodeChangeStatus(db, changeId, { status: "pending_approval" });
    const approvalMessage = formatApprovalRequest(changeId, parsed, effectiveRisk, projectId);
    await sendTelegramMessage(approvalMessage);
    const executionTimeMs = Math.round(performance.now() - startTime);
    logger.info({ changeId, risk: effectiveRisk, projectId }, "Project code change committed to branch but requires approval");
    return buildResult(task, "success", `Aguardando aprovacao (risk=${String(effectiveRisk)}, project=${projectId}). Change ID: ${changeId.slice(0, 8)}`, undefined, executionTimeMs, totalTokensUsed);
  }

  const executionTimeMs = Math.round(performance.now() - startTime);
  logger.info({ changeId, files: filePaths, projectId }, "Project code change committed");
  return buildResult(task, "success", `[${projectId}] Mudanca aplicada: ${parsed.description}. Files: ${filePaths.join(", ")}`, undefined, executionTimeMs, totalTokensUsed);
}

function formatApprovalRequest(
  changeId: string,
  parsed: ForgeCodeOutput,
  risk: number,
  projectId: string,
): string {
  const shortId = changeId.slice(0, 8);
  const filesList = parsed.files.map((f) => `- ${f.action}: ${f.path}`).join("\n");

  return [
    `*[FORGE — Mudanca de Codigo (Projeto)]*`,
    "",
    `*Projeto:* ${projectId}`,
    `*ID:* ${shortId}`,
    `*Risco:* ${String(risk)}/5`,
    `*Descricao:* ${parsed.description}`,
    "",
    `*Arquivos:*`,
    filesList,
    "",
    `*Rollback:* ${parsed.rollback}`,
    "",
    String.raw`Use /approve\_change ` + `${shortId} para aprovar`,
    String.raw`Use /reject\_change ` + `${shortId} para rejeitar`,
  ].join("\n");
}
