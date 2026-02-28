import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import type { Project } from "../../state/projects.js";
import { checkBaselineBuild } from "./forgeValidation.js";
import type { ClaudeCliInstructionsContext } from "./claudeCliInstructions.js";
import { classifyTaskType } from "./openclawInstructions.js";
import type { ForgeCodeOutput } from "./forgeTypes.js";
import { DEFAULT_VALIDATIONS } from "./openclawValidation.js";
import {
  writeExecutionPlan,
  writeReviewReport,
  writeChangesManifest,
  writeImplementationReport,
} from "./openclawArtifacts.js";
import type { ExecutionEventEmitter } from "../shared/executionEventEmitter.js";
import {
  loadClaudeCliConfig,
  selectModelForTask,
  classifyTaskComplexity,
} from "./claudeCliTypes.js";
import type {
  ClaudeCliExecutionResult,
  ClaudeCliLoopParams,
} from "./claudeCliTypes.js";
import {
  verifyClaudeCliAvailable,
  writeClaudeMd,
  removeClaudeMd,
  loadNexusResearchForGoal,
  loadGoalContext,
  buildRepositoryIndexSummary,
  readProjectInstructions,
} from "./claudeCliContext.js";
import { executeClaudeCliTask, runCorrectionLoop, runPostCorrectionReview } from "./claudeCliCorrectionLoop.js";

export { parseClaudeCliOutput } from "./claudeCliOutputParser.js";
export { selectModelForTask } from "./claudeCliTypes.js";
export type { ClaudeCliExecutorConfig, ClaudeCliExecutionResult } from "./claudeCliTypes.js";

export async function executeWithClaudeCli(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  project: Project,
  workspacePath: string,
  traceId?: string,
  emitter?: ExecutionEventEmitter,
): Promise<ClaudeCliExecutionResult> {
  const config = loadClaudeCliConfig();
  const startTime = performance.now();

  logger.info(
    {
      projectId: project.project_id,
      task: delegation.task.slice(0, 100),
      model: config.model,
      maxTurns: config.maxTurns,
    },
    "Starting Claude CLI autonomous execution",
  );

  const authStatus = await verifyClaudeCliAvailable(config.cliPath);
  if (!authStatus.available || !authStatus.authenticated) {
    const errorMsg = authStatus.error
      ?? `Claude CLI not found at "${config.cliPath}". Install it with: npm install -g @anthropic-ai/claude-code`;

    emitter?.error("forge", "forge:cli_failed", errorMsg, {
      phase: "setup",
      metadata: { available: authStatus.available, authenticated: authStatus.authenticated },
    });

    return {
      success: false,
      status: "FAILURE",
      description: "",
      filesChanged: [],
      totalTokensUsed: 0,
      totalCostUsd: 0,
      iterationsUsed: 0,
      validations: DEFAULT_VALIDATIONS,
      correctionCycles: 0,
      error: errorMsg,
    };
  }

  const taskType = classifyTaskType(delegation.task);
  const effectiveModel = selectModelForTask(config, taskType);
  const complexity = classifyTaskComplexity(delegation.task, taskType);

  logger.info(
    { taskType, complexity, selectedModel: effectiveModel, defaultModel: config.model, fixModel: config.fixModel },
    "Task classified and model selected",
  );

  emitter?.info("forge", "forge:complexity_classified", `Task classified as ${complexity} (${taskType})`, {
    phase: "setup",
    metadata: { taskType, complexity, model: effectiveModel, fixModel: config.fixModel },
  });

  await writeExecutionPlan(workspacePath, {
    task: delegation.task,
    taskType,
    expectedOutput: delegation.expected_output,
  });

  const repoIndexMaxChars = complexity === "complex" ? 5000 : undefined;
  const skipRepoIndex = complexity === "simple";

  const [nexusResearch, goalContext, repoIndexSummary, baselineBuildFailed, projectInstructions] = await Promise.all([
    Promise.resolve(loadNexusResearchForGoal(db, delegation.goal_id)),
    Promise.resolve(loadGoalContext(db, delegation.goal_id)),
    skipRepoIndex ? Promise.resolve("") : buildRepositoryIndexSummary(workspacePath, repoIndexMaxChars),
    checkBaselineBuild(workspacePath, 60_000),
    readProjectInstructions(workspacePath),
  ]);

  const instructionsCtx: ClaudeCliInstructionsContext = {
    task: delegation.task,
    expectedOutput: delegation.expected_output,
    language: project.language,
    framework: project.framework,
    projectId: project.project_id,
    nexusResearch: nexusResearch.length > 0 ? nexusResearch : undefined,
    goalContext,
    repositoryIndexSummary: repoIndexSummary ?? undefined,
    baselineBuildFailed,
    projectInstructions,
    complexity,
  };

  await writeClaudeMd(workspacePath, instructionsCtx);

  const adjustedMaxTurns = complexity === "simple"
    ? Math.min(config.maxTurns, 15)
    : complexity === "complex"
      ? Math.max(config.maxTurns, 35)
      : config.maxTurns;

  const adjustedConfig = { ...config, maxTurns: adjustedMaxTurns };

  emitter?.info("forge", "forge:context_loaded", "Context loaded and CLAUDE.md generated", {
    phase: "setup",
    metadata: {
      hasNexusResearch: nexusResearch.length > 0,
      hasGoalContext: Boolean(goalContext),
      repoIndexChars: repoIndexSummary?.length ?? 0,
      baselineBuildFailed,
      complexity,
      adjustedMaxTurns: adjustedConfig.maxTurns,
    },
  });

  const params: ClaudeCliLoopParams = {
    db,
    delegation,
    project,
    workspacePath,
    config: adjustedConfig,
    startTime,
    traceId,
    emitter,
  };

  try {
    const initialResult = await executeClaudeCliTask(params, { model: effectiveModel });

    if (!initialResult.success) {
      return initialResult;
    }

    if (initialResult.filesChanged.length === 0) {
      return initialResult;
    }

    await writeChangesManifest(workspacePath, [...initialResult.filesChanged]);

    const correctedResult = await runCorrectionLoop(initialResult, params);

    const reviewedResult = await runPostCorrectionReview(correctedResult, params);

    if (reviewedResult.review) {
      await writeReviewReport(workspacePath, reviewedResult.review);
    }

    await writeImplementationReport(workspacePath, {
      taskType,
      model: effectiveModel,
      totalTokensUsed: reviewedResult.totalTokensUsed,
      totalCostUsd: reviewedResult.totalCostUsd,
      durationMs: Math.round(performance.now() - startTime),
      filesChanged: reviewedResult.filesChanged,
      validations: reviewedResult.validations,
      correctionCycles: reviewedResult.correctionCycles,
      status: reviewedResult.status,
    });

    return reviewedResult;
  } finally {
    await removeClaudeMd(workspacePath);
  }
}

export function buildForgeCodeOutputFromCli(result: ClaudeCliExecutionResult): ForgeCodeOutput {
  const fileCount = result.filesChanged.length;
  const risk = fileCount === 0 ? 0 : Math.min(fileCount, 3);

  return {
    description: result.description,
    risk,
    rollback: fileCount > 0 ? "git checkout -- " + result.filesChanged.join(" ") : "No changes to rollback",
    files: result.filesChanged.map((filePath) => ({
      path: filePath,
      action: "modify" as const,
      content: "",
    })),
  };
}
