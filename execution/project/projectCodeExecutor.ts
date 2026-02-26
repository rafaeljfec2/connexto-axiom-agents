import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import { sendTelegramMessage } from "../../interfaces/telegram.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import { logAudit, hashContent } from "../../state/auditLog.js";
import { saveCodeChange, updateCodeChangeStatus } from "../../state/codeChanges.js";
import { getProjectById } from "../../state/projects.js";
import { getResearchByGoalId } from "../../state/nexusResearch.js";
import { getGoalById } from "../../state/goals.js";
import {
  runForgeAgentLoop,
  loadForgeAgentConfig,
} from "../forge/forgeAgentLoop.js";
import type { ForgeCodeOutput } from "../forge/forgeAgentLoop.js";
import type { NexusResearchContext, GoalContext } from "../forge/forgeTypes.js";
import {
  commitVerifiedChanges,
  validateAndCalculateRisk,
} from "./projectCodeApplier.js";
import type { CommitOptions } from "./projectCodeApplier.js";
import {
  ensureBaseClone,
  ensureBaseDependencies,
  createTaskWorkspace,
  cleanupTaskWorkspace,
} from "./projectWorkspace.js";
import type { ExecutionResult } from "../shared/types.js";
import type { ForgeExecutorMode } from "../../projects/manifest.schema.js";
import {
  executeWithOpenClaw,
  buildForgeCodeOutput,
} from "../forge/openclawAutonomousExecutor.js";
import {
  executeWithClaudeCli,
  buildForgeCodeOutputFromCli,
} from "../forge/claudeCliExecutor.js";

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
      const executorMode = project.forge_executor ?? "legacy";

      const result = await routeToExecutor({
        executorMode,
        db,
        delegation,
        projectId,
        workspacePath,
        project,
        startTime,
        traceId,
      });

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

function loadNexusResearchForGoal(
  db: BetterSqlite3.Database,
  goalId: string,
): readonly NexusResearchContext[] {
  const research = getResearchByGoalId(db, goalId);
  if (research.length === 0) return [];

  return research.map((r) => ({
    question: r.question,
    recommendation: r.recommendation,
    rawOutput: r.raw_output,
  }));
}

function loadGoalContext(
  db: BetterSqlite3.Database,
  goalId: string,
): GoalContext | undefined {
  const goal = getGoalById(db, goalId);
  if (!goal) return undefined;

  return { title: goal.title, description: goal.description };
}

const IMPLEMENTATION_TASK_PATTERNS: ReadonlySet<string> = new Set([
  "implementar", "implement", "criar", "create", "adicionar", "add",
  "alterar", "change", "modificar", "modify", "aplicar", "apply",
  "override", "substituir", "replace", "trocar", "swap",
]);

function isImplementationTask(task: string): boolean {
  const normalized = task.toLowerCase();
  for (const pattern of IMPLEMENTATION_TASK_PATTERNS) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

interface ExecutorRouteContext {
  readonly executorMode: ForgeExecutorMode;
  readonly db: BetterSqlite3.Database;
  readonly delegation: KairosDelegation;
  readonly projectId: string;
  readonly workspacePath: string;
  readonly project: {
    readonly language: string;
    readonly framework: string;
    readonly repo_source: string;
    readonly forge_executor: string;
    readonly push_enabled: number | null;
    readonly project_id: string;
  };
  readonly startTime: number;
  readonly traceId?: string;
}

async function routeToExecutor(ctx: ExecutorRouteContext): Promise<ExecutionResult> {
  const { executorMode, db, delegation, projectId, workspacePath, project, startTime, traceId } = ctx;

  switch (executorMode) {
    case "openclaw":
      return executeWithOpenClawMode(db, delegation, projectId, workspacePath, project, startTime, traceId);
    case "claude-cli":
      return executeWithClaudeCliMode(db, delegation, projectId, workspacePath, project, startTime, traceId);
    default:
      return executeWithAgentLoop(db, delegation, projectId, workspacePath, project, startTime, traceId);
  }
}

async function executeWithClaudeCliMode(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  projectId: string,
  workspacePath: string,
  project: {
    readonly language: string;
    readonly framework: string;
    readonly repo_source: string;
    readonly forge_executor: string;
    readonly push_enabled: number | null;
    readonly project_id: string;
  },
  startTime: number,
  traceId?: string,
): Promise<ExecutionResult> {
  const { task } = delegation;

  logger.info(
    { projectId, mode: "claude-cli", task: task.slice(0, 80) },
    "Routing to Claude CLI autonomous executor",
  );

  const cliResult = await executeWithClaudeCli(
    db,
    delegation,
    project as Parameters<typeof executeWithClaudeCli>[2],
    workspacePath,
    traceId,
  );

  logger.info(
    {
      projectId,
      success: cliResult.success,
      status: cliResult.status,
      filesChanged: cliResult.filesChanged.length,
      tokens: cliResult.totalTokensUsed,
      iterations: cliResult.iterationsUsed,
      validations: cliResult.validations,
      correctionCycles: cliResult.correctionCycles,
    },
    "Claude CLI autonomous execution finished",
  );

  if (!cliResult.success) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(
      task,
      "failed",
      "",
      cliResult.error ?? "Claude CLI autonomous execution failed",
      executionTimeMs,
      cliResult.totalTokensUsed,
    );
  }

  if (cliResult.filesChanged.length === 0) {
    const executionTimeMs = Math.round(performance.now() - startTime);

    if (isImplementationTask(task)) {
      logger.warn(
        { projectId, task: task.slice(0, 100) },
        "Claude CLI returned no file changes for implementation task",
      );
      return buildResult(
        task,
        "failed",
        "",
        `Implementation task produced no changes: ${cliResult.description.slice(0, 120)}`,
        executionTimeMs,
        cliResult.totalTokensUsed,
      );
    }

    return buildResult(
      task,
      "success",
      `[${projectId}] Nenhuma alteracao necessaria: ${cliResult.description}`,
      undefined,
      executionTimeMs,
      cliResult.totalTokensUsed,
    );
  }

  const pushEnabled = project.push_enabled === 1;
  const parsed = buildForgeCodeOutputFromCli(cliResult);

  return handleSuccessfulAgentOutput({
    db,
    delegation,
    projectId,
    workspacePath,
    repoSource: project.repo_source,
    parsed,
    totalTokensUsed: cliResult.totalTokensUsed,
    lintOutput: "",
    startTime,
    commitOptions: { pushEnabled, branchPrefix: "auto" },
  });
}

async function executeWithOpenClawMode(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  projectId: string,
  workspacePath: string,
  project: {
    readonly language: string;
    readonly framework: string;
    readonly repo_source: string;
    readonly forge_executor: string;
    readonly push_enabled: number | null;
    readonly project_id: string;
  },
  startTime: number,
  traceId?: string,
): Promise<ExecutionResult> {
  const { task } = delegation;

  logger.info(
    { projectId, mode: "openclaw", task: task.slice(0, 80) },
    "Routing to OpenClaw autonomous executor",
  );

  const openclawResult = await executeWithOpenClaw(
    db,
    delegation,
    project as Parameters<typeof executeWithOpenClaw>[2],
    workspacePath,
    traceId,
  );

  logger.info(
    {
      projectId,
      success: openclawResult.success,
      status: openclawResult.status,
      filesChanged: openclawResult.filesChanged.length,
      tokens: openclawResult.totalTokensUsed,
      iterations: openclawResult.iterationsUsed,
      validations: openclawResult.validations,
      correctionCycles: openclawResult.correctionCycles,
    },
    "OpenClaw autonomous execution finished",
  );

  if (!openclawResult.success) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(
      task,
      "failed",
      "",
      openclawResult.error ?? "OpenClaw autonomous execution failed",
      executionTimeMs,
      openclawResult.totalTokensUsed,
    );
  }

  if (openclawResult.filesChanged.length === 0) {
    const executionTimeMs = Math.round(performance.now() - startTime);

    if (isImplementationTask(task)) {
      logger.warn(
        { projectId, task: task.slice(0, 100) },
        "OpenClaw returned no file changes for implementation task",
      );
      return buildResult(
        task,
        "failed",
        "",
        `Implementation task produced no changes: ${openclawResult.description.slice(0, 120)}`,
        executionTimeMs,
        openclawResult.totalTokensUsed,
      );
    }

    return buildResult(
      task,
      "success",
      `[${projectId}] Nenhuma alteracao necessaria: ${openclawResult.description}`,
      undefined,
      executionTimeMs,
      openclawResult.totalTokensUsed,
    );
  }

  const pushEnabled = project.push_enabled === 1;
  const parsed = buildForgeCodeOutput(openclawResult);

  return handleSuccessfulAgentOutput({
    db,
    delegation,
    projectId,
    workspacePath,
    repoSource: project.repo_source,
    parsed,
    totalTokensUsed: openclawResult.totalTokensUsed,
    lintOutput: "",
    startTime,
    commitOptions: { pushEnabled, branchPrefix: "auto" },
  });
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

  const nexusResearch = loadNexusResearchForGoal(db, delegation.goal_id);
  const goalContext = loadGoalContext(db, delegation.goal_id);

  if (nexusResearch.length > 0) {
    logger.info(
      { goalId: delegation.goal_id, researchCount: nexusResearch.length },
      "NEXUS research context loaded for FORGE",
    );
  }

  if (goalContext) {
    logger.info(
      { goalId: delegation.goal_id, goalTitle: goalContext.title.slice(0, 80) },
      "Goal context loaded for FORGE",
    );
  }

  const agentResult = await runForgeAgentLoop({
    db,
    delegation,
    projectId,
    workspacePath,
    project,
    traceId,
    nexusResearch: nexusResearch.length > 0 ? nexusResearch : undefined,
    goalContext,
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
    enableRepositoryIndex: agentConfig.enableRepositoryIndex,
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
  readonly commitOptions?: CommitOptions;
}

async function handleSuccessfulAgentOutput(
  ctx: SuccessfulAgentOutputContext,
): Promise<ExecutionResult> {
  const { db, delegation, projectId, workspacePath, repoSource, parsed, totalTokensUsed, lintOutput, startTime } = ctx;
  const { task, goal_id } = delegation;

  if (parsed.files.length === 0) {
    const executionTimeMs = Math.round(performance.now() - startTime);

    if (isImplementationTask(task)) {
      logger.warn(
        { projectId, task: task.slice(0, 100), description: parsed.description.slice(0, 80) },
        "FORGE returned no file changes for an implementation task — marking as failed",
      );
      return buildResult(
        task,
        "failed",
        "",
        `Implementation task produced no changes: ${parsed.description.slice(0, 120)}`,
        executionTimeMs,
        totalTokensUsed,
      );
    }

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

  const commitResult = await commitVerifiedChanges({
    db, changeId, description: parsed.description, filePaths, workspacePath, lintOutput, repoSource,
    options: ctx.commitOptions,
  });

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
