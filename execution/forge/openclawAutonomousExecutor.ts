import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import type { Project } from "../../state/projects.js";
import { getResearchByGoalId } from "../../state/nexusResearch.js";
import { getGoalById } from "../../state/goals.js";
import { discoverProjectStructure } from "../discovery/fileDiscovery.js";
import { buildRepositoryIndex, formatIndexForPrompt } from "../discovery/repositoryIndexer.js";
import { checkBaselineBuild } from "./forgeValidation.js";
import { getAllToolDefinitions } from "./openclawTools.js";
import { createDefaultConfig } from "./openclawToolExecutor.js";
import { buildOpenClawInstructions, classifyTaskType } from "./openclawInstructions.js";
import { loadAndSelectReferences } from "./referenceLoader.js";
import { loadManifest } from "../../projects/manifestLoader.js";
import type { NexusResearchContext, GoalContext, ForgeCodeOutput } from "./forgeTypes.js";
import type { ValidationResults, ExecutionStatus } from "./openclawValidation.js";
import type { ReviewResult } from "./openclawReview.js";
import {
  writeExecutionPlan,
  writeReviewReport,
  writeChangesManifest,
} from "./openclawArtifacts.js";
import {
  copyWorkspaceToSandbox,
  syncChangesBack,
  cleanupSandboxProjectFiles,
} from "./openclawSandboxManager.js";
import { buildInitialInput, runToolLoop } from "./openclawToolLoop.js";
import type { LoopContext, ToolLoopState } from "./openclawToolLoop.js";
import { runCorrectionLoop, runPostCorrectionReview } from "./openclawCorrectionHandler.js";

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_MAX_TASK_TIMEOUT_MS = 300_000;
const DEFAULT_PER_TASK_TOKEN_LIMIT = 50_000;
const REPO_INDEX_MAX_CHARS = 3000;

export interface OpenClawExecutorConfig {
  readonly maxOutputTokens: number;
  readonly maxIterations: number;
  readonly taskTimeoutMs: number;
  readonly perTaskTokenLimit: number;
}

export type {
  ValidationStepResult,
  ValidationResults,
  ExecutionStatus,
} from "./openclawValidation.js";

export interface OpenClawExecutionResult {
  readonly success: boolean;
  readonly status: ExecutionStatus;
  readonly description: string;
  readonly filesChanged: readonly string[];
  readonly totalTokensUsed: number;
  readonly iterationsUsed: number;
  readonly validations: ValidationResults;
  readonly correctionCycles: number;
  readonly review?: ReviewResult;
  readonly error?: string;
}

export interface OpenClawLoopParams {
  readonly db: BetterSqlite3.Database;
  readonly delegation: KairosDelegation;
  readonly project: Project;
  readonly workspacePath: string;
  readonly config: OpenClawExecutorConfig;
  readonly startTime: number;
  readonly traceId?: string;
}

export type OpenClawLoopExecutor = (params: OpenClawLoopParams) => Promise<OpenClawExecutionResult>;

function loadExecutorConfig(): OpenClawExecutorConfig {
  return {
    maxOutputTokens: Number(process.env.OPENCLAW_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS),
    maxIterations: Number(process.env.OPENCLAW_MAX_ITERATIONS ?? DEFAULT_MAX_ITERATIONS),
    taskTimeoutMs: Number(process.env.OPENCLAW_TASK_TIMEOUT_MS ?? DEFAULT_MAX_TASK_TIMEOUT_MS),
    perTaskTokenLimit: Number(
      process.env.OPENCLAW_PER_TASK_TOKEN_LIMIT ?? DEFAULT_PER_TASK_TOKEN_LIMIT,
    ),
  };
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

function loadGoalContext(db: BetterSqlite3.Database, goalId: string): GoalContext | undefined {
  const goal = getGoalById(db, goalId);
  if (!goal) return undefined;
  return { title: goal.title, description: goal.description };
}

async function buildRepositoryIndexSummary(workspacePath: string): Promise<string> {
  try {
    const structure = await discoverProjectStructure(workspacePath);
    const index = await buildRepositoryIndex(workspacePath, structure);
    return formatIndexForPrompt(index, REPO_INDEX_MAX_CHARS);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to build repository index for OpenClaw instructions");
    return "";
  }
}

export async function executeWithOpenClaw(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  project: Project,
  workspacePath: string,
  traceId?: string,
): Promise<OpenClawExecutionResult> {
  const config = loadExecutorConfig();

  logger.info(
    {
      projectId: project.project_id,
      task: delegation.task.slice(0, 100),
      maxIterations: config.maxIterations,
      tokenLimit: config.perTaskTokenLimit,
    },
    "Starting OpenClaw autonomous execution",
  );

  const startTime = performance.now();
  const taskType = classifyTaskType(delegation.task);

  await writeExecutionPlan(workspacePath, {
    task: delegation.task,
    taskType,
    expectedOutput: delegation.expected_output,
  });

  await copyWorkspaceToSandbox(workspacePath);
  logger.info(
    { workspacePath, taskType },
    "OpenClaw sandbox workspace prepared",
  );

  const loopParams: OpenClawLoopParams = {
    db, delegation, project, workspacePath, config, startTime, traceId,
  };

  try {
    const result = await executeOpenClawLoop(loopParams);
    const syncedFiles = await syncChangesBack(workspacePath);
    const mergedResult = mergeWithSyncedFiles(result, syncedFiles);

    if (mergedResult.filesChanged.length === 0) {
      return mergedResult;
    }

    await writeChangesManifest(workspacePath, [...mergedResult.filesChanged]);

    const correctedResult = await runCorrectionLoop({
      initialResult: mergedResult,
      loopParams,
      loopExecutor: executeOpenClawLoop,
    });

    const reviewedResult = await runPostCorrectionReview(
      correctedResult, loopParams, executeOpenClawLoop,
    );

    if (reviewedResult.review) {
      await writeReviewReport(workspacePath, reviewedResult.review);
    }

    return reviewedResult;
  } finally {
    await cleanupSandboxProjectFiles();
  }
}

function mergeWithSyncedFiles(
  result: OpenClawExecutionResult,
  syncedFiles: readonly string[],
): OpenClawExecutionResult {
  if (syncedFiles.length > 0 && !result.success) {
    return {
      ...result,
      success: true,
      status: "PARTIAL_SUCCESS",
      filesChanged: syncedFiles,
      error: undefined,
    };
  }

  if (syncedFiles.length > 0) {
    return { ...result, filesChanged: syncedFiles };
  }

  return result;
}

async function executeOpenClawLoop(params: OpenClawLoopParams): Promise<OpenClawExecutionResult> {
  const { db, delegation, project, workspacePath, config, startTime, traceId } = params;
  const { task, expected_output, goal_id } = delegation;

  const taskType = classifyTaskType(task);

  let referencesConfig: { readonly maxTokens?: number; readonly includeGlobal?: boolean } | undefined;
  try {
    const manifest = loadManifest(project.project_id);
    referencesConfig = manifest.references;
  } catch {
    logger.debug({ projectId: project.project_id }, "Could not load manifest for references config");
  }

  const [nexusResearch, goalContext, repoIndexSummary, baselineBuildFailed, referenceExamples] = await Promise.all([
    Promise.resolve(loadNexusResearchForGoal(db, goal_id)),
    Promise.resolve(loadGoalContext(db, goal_id)),
    buildRepositoryIndexSummary(workspacePath),
    checkBaselineBuild(workspacePath, 60_000),
    loadAndSelectReferences(project.project_id, {
      taskType,
      language: project.language,
      framework: project.framework,
      taskDescription: task,
    }, referencesConfig),
  ]);

  const instructions = await buildOpenClawInstructions({
    task,
    expectedOutput: expected_output,
    language: project.language,
    framework: project.framework,
    projectId: project.project_id,
    nexusResearch: nexusResearch.length > 0 ? nexusResearch : undefined,
    goalContext,
    repositoryIndexSummary: repoIndexSummary || undefined,
    baselineBuildFailed,
    referenceExamples: referenceExamples || undefined,
  });

  const ctx: LoopContext = {
    config,
    instructions,
    tools: getAllToolDefinitions(),
    toolExecutorConfig: createDefaultConfig(workspacePath),
    workspacePath,
    traceId,
    startTime,
  };

  const state: ToolLoopState = {
    conversationHistory: [...buildInitialInput(task, expected_output)],
    totalTokensUsed: 0,
    iterationsUsed: 0,
    lastResponse: null,
  };

  return runToolLoop(state, ctx);
}

export function buildForgeCodeOutput(result: OpenClawExecutionResult): ForgeCodeOutput {
  return {
    description: result.description,
    risk: result.filesChanged.length > 3 ? 3 : Math.max(1, result.filesChanged.length),
    rollback: "git checkout -- " + result.filesChanged.join(" "),
    files: result.filesChanged.map((filePath) => ({
      path: filePath,
      action: "modify" as const,
      content: "",
    })),
  };
}
