import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import { sendTelegramMessage } from "../../interfaces/telegram.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import { logAudit, hashContent } from "../../state/auditLog.js";
import { saveCodeChange, updateCodeChangeStatus } from "../../state/codeChanges.js";
import { getProjectById } from "../../state/projects.js";
import {
  runForgeAgentLoop,
  loadForgeAgentConfig,
} from "../forge/forgeAgentLoop.js";
import type { ForgeCodeOutput } from "../forge/forgeAgentLoop.js";
import {
  commitVerifiedChanges,
  validateAndCalculateRisk,
} from "./projectCodeApplier.js";
import {
  ensureBaseClone,
  ensureBaseDependencies,
  createTaskWorkspace,
  cleanupTaskWorkspace,
} from "./projectWorkspace.js";
import type { ExecutionResult } from "../shared/types.js";

const MAX_FILES_PER_CHANGE = 5;

export async function executeProjectCode(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  projectId: string,
  traceId?: string,
): Promise<ExecutionResult> {
  const { task, goal_id } = delegation;
  const startTime = performance.now();

  try {
    const project = getProjectById(db, projectId);
    if (!project) {
      return buildResult(task, "failed", "", `Project not found: ${projectId}`, 0);
    }

    logger.info(
      { projectId, repoSource: project.repo_source, task: task.slice(0, 80) },
      "Starting project code execution (agent loop)",
    );

    await ensureBaseClone(projectId, project.repo_source);
    await ensureBaseDependencies(projectId);
    const workspacePath = await createTaskWorkspace(projectId, goal_id);

    try {
      const result = await executeWithAgentLoop(
        db,
        delegation,
        projectId,
        workspacePath,
        project,
        startTime,
        traceId,
      );
      return result;
    } finally {
      if (process.env.FORGE_KEEP_WORKSPACE === "true") {
        logger.info(
          { projectId, goalId: goal_id, workspacePath },
          "Keeping workspace for inspection (FORGE_KEEP_WORKSPACE=true)",
        );
      } else {
        await cleanupTaskWorkspace(projectId, goal_id);
      }
    }
  } catch (error) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task, projectId }, "Project code execution failed");

    logAudit(db, {
      agent: "forge",
      action: task,
      inputHash: hashContent(task),
      outputHash: null,
      sanitizerWarnings: [`project_code_execution_error: ${message}`],
      runtime: "openclaw",
    });

    return buildResult(task, "failed", "", message, executionTimeMs);
  }
}

async function executeWithAgentLoop(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  projectId: string,
  workspacePath: string,
  project: {
    readonly language: string;
    readonly framework: string;
    readonly repo_source: string;
  },
  startTime: number,
  traceId?: string,
): Promise<ExecutionResult> {
  const { task } = delegation;
  const agentConfig = loadForgeAgentConfig();

  const agentResult = await runForgeAgentLoop({
    db,
    delegation,
    projectId,
    workspacePath,
    project,
    traceId,
    maxCorrectionRounds: agentConfig.maxCorrectionRounds,
    runBuild: agentConfig.runBuild,
    buildTimeout: agentConfig.buildTimeout,
    maxContextFiles: agentConfig.maxContextFiles,
    enableRipgrep: agentConfig.enableRipgrep,
    enablePlanningPreview: agentConfig.enablePlanningPreview,
    enableImportExpansion: agentConfig.enableImportExpansion,
    enableFrameworkRules: agentConfig.enableFrameworkRules,
    enablePreLintCheck: agentConfig.enablePreLintCheck,
    enableTestExecution: agentConfig.enableTestExecution,
    testTimeout: agentConfig.testTimeout,
    enableAutoFix: agentConfig.enableAutoFix,
    enableAtomicEdits: agentConfig.enableAtomicEdits,
    enableStructuredErrors: agentConfig.enableStructuredErrors,
  });

  logger.info(
    {
      projectId,
      success: agentResult.success,
      phasesCompleted: agentResult.phasesCompleted,
      totalTokens: agentResult.totalTokensUsed,
    },
    "FORGE agent loop completed",
  );

  if (!agentResult.success || !agentResult.parsed) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(
      task,
      "failed",
      "",
      agentResult.error ?? "Agent loop failed without producing valid output",
      executionTimeMs,
      agentResult.totalTokensUsed,
    );
  }

  return handleSuccessfulAgentOutput({
    db,
    delegation,
    projectId,
    workspacePath,
    repoSource: project.repo_source,
    parsed: agentResult.parsed,
    totalTokensUsed: agentResult.totalTokensUsed,
    lintOutput: agentResult.lintOutput ?? "",
    startTime,
  });
}

interface SuccessfulAgentOutputContext {
  readonly db: BetterSqlite3.Database;
  readonly delegation: KairosDelegation;
  readonly projectId: string;
  readonly workspacePath: string;
  readonly repoSource: string;
  readonly parsed: ForgeCodeOutput;
  readonly totalTokensUsed: number;
  readonly lintOutput: string;
  readonly startTime: number;
}

async function handleSuccessfulAgentOutput(
  ctx: SuccessfulAgentOutputContext,
): Promise<ExecutionResult> {
  const { db, delegation, projectId, workspacePath, repoSource, parsed, totalTokensUsed, lintOutput, startTime } = ctx;
  const { task, goal_id } = delegation;

  if (parsed.files.length === 0) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    logger.info(
      { projectId, description: parsed.description.slice(0, 80) },
      "FORGE returned no file changes, completing without commit",
    );
    return buildResult(
      task,
      "success",
      `[${projectId}] Nenhuma alteracao necessaria: ${parsed.description}`,
      undefined,
      executionTimeMs,
      totalTokensUsed,
    );
  }

  if (parsed.files.length > MAX_FILES_PER_CHANGE) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(
      task,
      "failed",
      "",
      `Too many files: ${String(parsed.files.length)} (max ${String(MAX_FILES_PER_CHANGE)})`,
      executionTimeMs,
      totalTokensUsed,
    );
  }

  const riskResult = validateAndCalculateRisk(parsed.files, workspacePath);
  if (!riskResult.valid) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(
      task,
      "failed",
      "",
      `Path validation failed: ${riskResult.errors.join("; ")}`,
      executionTimeMs,
      totalTokensUsed,
    );
  }

  const effectiveRisk = Math.max(riskResult.risk, parsed.risk);
  const filePaths = parsed.files.map((f) => f.path);
  const pendingFilesJson = JSON.stringify(
    parsed.files.map((f) => ({
      path: f.path,
      action: f.action,
      content: f.content,
      edits: f.edits,
    })),
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

  if (effectiveRisk >= 3) {
    updateCodeChangeStatus(db, changeId, { status: "pending_approval" });

    const approvalMessage = formatApprovalRequest(changeId, parsed, effectiveRisk, projectId);
    await sendTelegramMessage(approvalMessage);

    const executionTimeMs = Math.round(performance.now() - startTime);
    logger.info(
      { changeId, risk: effectiveRisk, projectId },
      "Project code change requires approval",
    );

    return buildResult(
      task,
      "success",
      `Aguardando aprovacao (risk=${String(effectiveRisk)}, project=${projectId}). Change ID: ${changeId.slice(0, 8)}`,
      undefined,
      executionTimeMs,
      totalTokensUsed,
    );
  }

  const commitResult = await commitVerifiedChanges(
    db, changeId, parsed.description, filePaths, workspacePath, lintOutput, repoSource,
  );

  if (commitResult.success) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    logger.info({ changeId, files: filePaths, projectId }, "Project code change committed");

    return buildResult(
      task,
      "success",
      `[${projectId}] Mudanca aplicada: ${parsed.description}. Files: ${filePaths.join(", ")}`,
      undefined,
      executionTimeMs,
      totalTokensUsed,
    );
  }

  const executionTimeMs = Math.round(performance.now() - startTime);

  updateCodeChangeStatus(db, changeId, {
    status: "failed",
    testOutput: commitResult.lintOutput,
    error: commitResult.error ?? "Commit failed after agent loop",
  });

  return buildResult(
    task,
    "failed",
    "",
    `Project code change commit failed: ${commitResult.error ?? "unknown"}`,
    executionTimeMs,
    totalTokensUsed,
  );
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

function buildResult(
  task: string,
  status: "success" | "failed" | "infra_unavailable",
  output: string,
  error?: string,
  executionTimeMs?: number,
  tokensUsed?: number,
): ExecutionResult {
  const effectiveTokens = tokensUsed && tokensUsed > 0 ? tokensUsed : undefined;
  return { agent: "forge", task, status, output, error, executionTimeMs, tokensUsed: effectiveTokens };
}
