import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import { recordTokenUsage } from "../../state/tokenUsage.js";
import { incrementUsedTokens } from "../../state/budgets.js";
import {
  runForgeAgentLoop,
  loadForgeAgentConfig,
} from "../forge/forgeAgentLoop.js";
import {
  executeWithOpenClaw,
  buildForgeCodeOutput,
} from "../forge/openclawAutonomousExecutor.js";
import {
  executeWithClaudeCli,
  buildForgeCodeOutputFromCli,
} from "../forge/claudeCliExecutor.js";
import type { ExecutionResult } from "../shared/types.js";
import type { ExecutionEventEmitter } from "../shared/executionEventEmitter.js";
import { handleSuccessfulAgentOutput } from "./projectCodeDelivery.js";
import { isImplementationTask, loadNexusResearchForGoal, loadGoalContext, buildResult } from "./projectCodeHelpers.js";

const MAX_FILES_PER_CHANGE_CLI = 20;

interface ProjectRef {
  readonly language: string;
  readonly framework: string;
  readonly repo_source: string;
  readonly forge_executor: string;
  readonly base_branch: string;
  readonly push_enabled: number | null;
  readonly project_id: string;
}

export interface ExecutorModeContext {
  readonly db: BetterSqlite3.Database;
  readonly delegation: KairosDelegation;
  readonly projectId: string;
  readonly workspacePath: string;
  readonly project: ProjectRef;
  readonly startTime: number;
  readonly traceId?: string;
  readonly emitter?: ExecutionEventEmitter;
}

export async function executeWithClaudeCliMode(ctx: ExecutorModeContext): Promise<ExecutionResult> {
  const { db, delegation, projectId, workspacePath, project, startTime, traceId, emitter } = ctx;
  const { task } = delegation;

  logger.info({ projectId, mode: "claude-cli", task: task.slice(0, 80) }, "Routing to Claude CLI autonomous executor");

  const cliResult = await executeWithClaudeCli(
    db, delegation, project as Parameters<typeof executeWithClaudeCli>[2], workspacePath, traceId, emitter,
  );

  logger.info(
    { projectId, success: cliResult.success, status: cliResult.status, filesChanged: cliResult.filesChanged.length, tokens: cliResult.totalTokensUsed, iterations: cliResult.iterationsUsed, validations: cliResult.validations, correctionCycles: cliResult.correctionCycles },
    "Claude CLI autonomous execution finished",
  );

  if (cliResult.totalTokensUsed > 0) {
    recordTokenUsage(db, {
      agentId: "forge", taskId: delegation.goal_id,
      inputTokens: Math.round(cliResult.totalTokensUsed * 0.7),
      outputTokens: Math.round(cliResult.totalTokensUsed * 0.3),
      totalTokens: cliResult.totalTokensUsed,
      costUsd: cliResult.totalCostUsd,
    });
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    incrementUsedTokens(db, period, cliResult.totalTokensUsed);
  }

  if (!cliResult.success) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(task, "failed", "", cliResult.error ?? "Claude CLI autonomous execution failed", executionTimeMs, cliResult.totalTokensUsed);
  }

  if (cliResult.filesChanged.length === 0) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    if (isImplementationTask(task)) {
      logger.warn({ projectId, task: task.slice(0, 100) }, "Claude CLI returned no file changes for implementation task");
      return buildResult(task, "failed", "", `Implementation task produced no changes: ${cliResult.description.slice(0, 120)}`, executionTimeMs, cliResult.totalTokensUsed);
    }
    return buildResult(task, "success", `[${projectId}] Nenhuma alteracao necessaria: ${cliResult.description}`, undefined, executionTimeMs, cliResult.totalTokensUsed);
  }

  const pushEnabled = project.push_enabled !== 0;
  const parsed = buildForgeCodeOutputFromCli(cliResult);

  emitter?.info("forge", "forge:commit_started", "Commit and push flow started", {
    phase: "delivery",
    metadata: { filesChanged: cliResult.filesChanged.length, pushEnabled, tokensUsed: cliResult.totalTokensUsed, costUsd: cliResult.totalCostUsd },
  });

  const result = await handleSuccessfulAgentOutput({
    db, delegation, projectId, workspacePath, repoSource: project.repo_source, parsed,
    totalTokensUsed: cliResult.totalTokensUsed, lintOutput: "", startTime,
    commitOptions: { pushEnabled, branchPrefix: "auto", baseBranch: project.base_branch },
    maxFilesOverride: MAX_FILES_PER_CHANGE_CLI,
    emitter,
  });

  if (result.status === "success") {
    emitter?.info("forge", "forge:delivery_complete", "Changes committed and delivered", {
      phase: "delivery",
      metadata: { status: result.status, tokensUsed: result.tokensUsed, executionTimeMs: result.executionTimeMs },
    });
  }

  return result;
}

export async function executeWithOpenClawMode(ctx: ExecutorModeContext): Promise<ExecutionResult> {
  const { db, delegation, projectId, workspacePath, project, startTime, traceId, emitter } = ctx;
  const { task } = delegation;

  logger.info({ projectId, mode: "openclaw", task: task.slice(0, 80) }, "Routing to OpenClaw autonomous executor");

  const openclawResult = await executeWithOpenClaw(
    db, delegation, project as Parameters<typeof executeWithOpenClaw>[2], workspacePath, traceId,
  );

  logger.info(
    { projectId, success: openclawResult.success, status: openclawResult.status, filesChanged: openclawResult.filesChanged.length, tokens: openclawResult.totalTokensUsed, iterations: openclawResult.iterationsUsed, validations: openclawResult.validations, correctionCycles: openclawResult.correctionCycles },
    "OpenClaw autonomous execution finished",
  );

  if (openclawResult.totalTokensUsed > 0) {
    recordTokenUsage(db, {
      agentId: "forge", taskId: delegation.goal_id,
      inputTokens: Math.round(openclawResult.totalTokensUsed * 0.7),
      outputTokens: Math.round(openclawResult.totalTokensUsed * 0.3),
      totalTokens: openclawResult.totalTokensUsed,
    });
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    incrementUsedTokens(db, period, openclawResult.totalTokensUsed);
  }

  if (!openclawResult.success) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(task, "failed", "", openclawResult.error ?? "OpenClaw autonomous execution failed", executionTimeMs, openclawResult.totalTokensUsed);
  }

  if (openclawResult.filesChanged.length === 0) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    if (isImplementationTask(task)) {
      logger.warn({ projectId, task: task.slice(0, 100) }, "OpenClaw returned no file changes for implementation task");
      return buildResult(task, "failed", "", `Implementation task produced no changes: ${openclawResult.description.slice(0, 120)}`, executionTimeMs, openclawResult.totalTokensUsed);
    }
    return buildResult(task, "success", `[${projectId}] Nenhuma alteracao necessaria: ${openclawResult.description}`, undefined, executionTimeMs, openclawResult.totalTokensUsed);
  }

  const pushEnabled = project.push_enabled !== 0;
  const parsed = buildForgeCodeOutput(openclawResult);

  return handleSuccessfulAgentOutput({
    db, delegation, projectId, workspacePath, repoSource: project.repo_source, parsed,
    totalTokensUsed: openclawResult.totalTokensUsed, lintOutput: "", startTime,
    commitOptions: { pushEnabled, branchPrefix: "auto", baseBranch: project.base_branch },
    emitter,
  });
}

export async function executeWithAgentLoop(ctx: ExecutorModeContext): Promise<ExecutionResult> {
  const { db, delegation, projectId, workspacePath, project, startTime, traceId, emitter } = ctx;
  const { task } = delegation;
  const agentConfig = loadForgeAgentConfig();

  const nexusResearch = loadNexusResearchForGoal(db, delegation.goal_id);
  const goalContext = loadGoalContext(db, delegation.goal_id);

  if (nexusResearch.length > 0) {
    logger.info({ goalId: delegation.goal_id, researchCount: nexusResearch.length }, "NEXUS research context loaded for FORGE");
  }

  if (goalContext) {
    logger.info({ goalId: delegation.goal_id, goalTitle: goalContext.title.slice(0, 80) }, "Goal context loaded for FORGE");
  }

  const agentResult = await runForgeAgentLoop({
    db, delegation, projectId, workspacePath, project, traceId,
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
    { projectId, success: agentResult.success, phasesCompleted: agentResult.phasesCompleted, totalTokens: agentResult.totalTokensUsed },
    "FORGE agent loop completed",
  );

  if (!agentResult.success || !agentResult.parsed) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(task, "failed", "", agentResult.error ?? "Agent loop failed without producing valid output", executionTimeMs, agentResult.totalTokensUsed);
  }

  return handleSuccessfulAgentOutput({
    db, delegation, projectId, workspacePath, repoSource: project.repo_source,
    parsed: agentResult.parsed, totalTokensUsed: agentResult.totalTokensUsed,
    lintOutput: agentResult.lintOutput ?? "", startTime,
    commitOptions: { baseBranch: project.base_branch },
    emitter,
  });
}
