import type BetterSqlite3 from "better-sqlite3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../config/logger.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import type { Project } from "../../state/projects.js";
import { getResearchByGoalId } from "../../state/nexusResearch.js";
import { getGoalById } from "../../state/goals.js";
import { discoverProjectStructure } from "../discovery/fileDiscovery.js";
import { buildRepositoryIndex, formatIndexForPrompt } from "../discovery/repositoryIndexer.js";
import { checkBaselineBuild } from "./forgeValidation.js";
import { callOpenClawWithTools } from "../shared/openclawResponsesClient.js";
import type { ResponseItem, OpenClawToolResponse, ToolCall } from "../shared/openclawResponsesClient.js";
import { getAllToolDefinitions } from "./openclawTools.js";
import { createDefaultConfig, executeTool } from "./openclawToolExecutor.js";
import type { ToolExecutorConfig } from "./openclawToolExecutor.js";
import { buildOpenClawInstructions } from "./openclawInstructions.js";
import type { NexusResearchContext, GoalContext, ForgeCodeOutput } from "./forgeTypes.js";

const execFileAsync = promisify(execFile);

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

export interface OpenClawExecutionResult {
  readonly success: boolean;
  readonly description: string;
  readonly filesChanged: readonly string[];
  readonly totalTokensUsed: number;
  readonly iterationsUsed: number;
  readonly error?: string;
}

function loadExecutorConfig(): OpenClawExecutorConfig {
  return {
    maxOutputTokens: Number(process.env.OPENCLAW_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS),
    maxIterations: Number(process.env.OPENCLAW_MAX_ITERATIONS ?? DEFAULT_MAX_ITERATIONS),
    taskTimeoutMs: Number(process.env.OPENCLAW_TASK_TIMEOUT_MS ?? DEFAULT_MAX_TASK_TIMEOUT_MS),
    perTaskTokenLimit: Number(process.env.OPENCLAW_PER_TASK_TOKEN_LIMIT ?? DEFAULT_PER_TASK_TOKEN_LIMIT),
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

function loadGoalContext(
  db: BetterSqlite3.Database,
  goalId: string,
): GoalContext | undefined {
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

async function detectChangedFiles(workspacePath: string): Promise<readonly string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", "HEAD"],
      { cwd: workspacePath, timeout: 10_000 },
    );

    const untrackedResult = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: workspacePath, timeout: 10_000 },
    );

    const tracked = stdout.trim().split("\n").filter(Boolean);
    const untracked = untrackedResult.stdout.trim().split("\n").filter(Boolean);

    const IGNORED_PREFIXES = ["node_modules", ".git", "dist", "build", ".next", ".turbo"];

    return [...new Set([...tracked, ...untracked])].filter(
      (f) => !IGNORED_PREFIXES.some((prefix) => f.startsWith(prefix)),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to detect changed files via git");
    return [];
  }
}

function buildInitialInput(task: string, expectedOutput: string): readonly ResponseItem[] {
  return [
    {
      role: "user",
      content: [
        "Execute the following task:",
        "",
        task,
        "",
        expectedOutput ? `Expected output: ${expectedOutput}` : "",
        "",
        "Start by exploring the codebase to understand the structure, then implement the changes.",
      ].filter(Boolean).join("\n"),
    },
  ];
}

function buildToolResultItems(
  toolCalls: readonly ToolCall[],
  toolResults: readonly string[],
): readonly ResponseItem[] {
  return toolCalls.map((tc, i) => ({
    role: "tool" as const,
    content: toolResults[i],
    tool_call_id: tc.callId,
  }));
}

interface ToolLoopState {
  readonly conversationHistory: ResponseItem[];
  totalTokensUsed: number;
  iterationsUsed: number;
  lastResponse: OpenClawToolResponse | null;
}

async function executeToolCalls(
  toolExecutorConfig: ToolExecutorConfig,
  toolCalls: readonly ToolCall[],
): Promise<readonly string[]> {
  const results: string[] = [];

  for (const tc of toolCalls) {
    const result = await executeTool(toolExecutorConfig, tc);
    results.push(result);

    logger.debug(
      { tool: tc.name, callId: tc.callId, resultLen: result.length },
      "Tool call executed",
    );
  }

  return results;
}

function checkBudgetExceeded(
  state: ToolLoopState,
  config: OpenClawExecutorConfig,
): string | null {
  if (state.totalTokensUsed >= config.perTaskTokenLimit) {
    return `Token budget exceeded: ${String(state.totalTokensUsed)} / ${String(config.perTaskTokenLimit)}`;
  }

  if (state.iterationsUsed >= config.maxIterations) {
    return `Max iterations reached: ${String(state.iterationsUsed)} / ${String(config.maxIterations)}`;
  }

  return null;
}

function extractFinalDescription(response: OpenClawToolResponse): string {
  return response.text ?? "Task completed (no summary provided by agent)";
}

interface LoopContext {
  readonly config: OpenClawExecutorConfig;
  readonly instructions: string;
  readonly tools: readonly import("../shared/openclawResponsesClient.js").ToolDefinition[];
  readonly toolExecutorConfig: ToolExecutorConfig;
  readonly workspacePath: string;
  readonly traceId?: string;
  readonly startTime: number;
}

type IterationOutcome =
  | { readonly done: false }
  | { readonly done: true; readonly result: OpenClawExecutionResult };

function handleFailedResponse(
  response: OpenClawToolResponse,
  state: ToolLoopState,
): IterationOutcome {
  return {
    done: true,
    result: {
      success: false,
      description: "",
      filesChanged: [],
      totalTokensUsed: state.totalTokensUsed,
      iterationsUsed: state.iterationsUsed,
      error: response.text ?? "OpenClaw agent returned failed status",
    },
  };
}

async function handleCompletedResponse(
  response: OpenClawToolResponse,
  state: ToolLoopState,
  ctx: LoopContext,
): Promise<IterationOutcome> {
  const filesChanged = await detectChangedFiles(ctx.workspacePath);
  const description = extractFinalDescription(response);

  const noToolsUsed = state.iterationsUsed === 1 && filesChanged.length === 0;
  if (noToolsUsed) {
    logger.warn(
      { iterations: state.iterationsUsed, textPreview: description.slice(0, 200) },
      "OpenClaw completed without using any tools and no files changed — model may not support function calling",
    );

    return {
      done: true,
      result: {
        success: false,
        description,
        filesChanged: [],
        totalTokensUsed: state.totalTokensUsed,
        iterationsUsed: state.iterationsUsed,
        error: "Agent completed without using tools or making changes. The model may not support function calling.",
      },
    };
  }

  logger.info(
    {
      iterations: state.iterationsUsed,
      tokens: state.totalTokensUsed,
      filesChanged: filesChanged.length,
      elapsed: Math.round(performance.now() - ctx.startTime),
    },
    "OpenClaw autonomous execution completed",
  );

  return {
    done: true,
    result: { success: true, description, filesChanged, totalTokensUsed: state.totalTokensUsed, iterationsUsed: state.iterationsUsed },
  };
}

async function handleToolCallResponse(
  response: OpenClawToolResponse,
  state: ToolLoopState,
  ctx: LoopContext,
): Promise<void> {
  const toolResults = await executeToolCalls(ctx.toolExecutorConfig, response.toolCalls!);

  if (response.rawAssistantMessage) {
    state.conversationHistory.push({
      role: "assistant",
      content: response.rawAssistantMessage.content ?? "",
      tool_calls: response.rawAssistantMessage.tool_calls,
    });
  }

  const resultItems = buildToolResultItems(response.toolCalls!, toolResults);
  state.conversationHistory.push(...resultItems);
}

async function processIteration(
  state: ToolLoopState,
  ctx: LoopContext,
): Promise<IterationOutcome> {
  const response = await callOpenClawWithTools({
    agentId: "forge",
    input: state.conversationHistory,
    instructions: ctx.instructions,
    tools: ctx.tools,
    maxOutputTokens: ctx.config.maxOutputTokens,
    traceId: ctx.traceId,
  });

  state.lastResponse = response;
  state.iterationsUsed++;

  if (response.usage) {
    state.totalTokensUsed += response.usage.totalTokens;
  }

  logger.info(
    { iteration: state.iterationsUsed, status: response.status, toolCalls: response.toolCalls?.length ?? 0, tokens: state.totalTokensUsed },
    "OpenClaw iteration completed",
  );

  if (response.status === "failed") return handleFailedResponse(response, state);
  if (response.status === "completed") return handleCompletedResponse(response, state, ctx);

  if (response.status === "requires_action" && response.toolCalls && response.toolCalls.length > 0) {
    await handleToolCallResponse(response, state, ctx);
    return { done: false };
  }

  logger.warn({ status: response.status, iteration: state.iterationsUsed }, "Unexpected status, treating as completed");
  const filesChanged = await detectChangedFiles(ctx.workspacePath);
  return {
    done: true,
    result: { success: filesChanged.length > 0, description: response.text ?? "Unexpected completion", filesChanged, totalTokensUsed: state.totalTokensUsed, iterationsUsed: state.iterationsUsed },
  };
}

export async function executeWithOpenClaw(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  project: Project,
  workspacePath: string,
  traceId?: string,
): Promise<OpenClawExecutionResult> {
  const config = loadExecutorConfig();
  const { task, expected_output, goal_id } = delegation;

  logger.info(
    { projectId: project.project_id, task: task.slice(0, 100), maxIterations: config.maxIterations, tokenLimit: config.perTaskTokenLimit },
    "Starting OpenClaw autonomous execution",
  );

  const startTime = performance.now();

  const [nexusResearch, goalContext, repoIndexSummary, baselineBuildFailed] = await Promise.all([
    Promise.resolve(loadNexusResearchForGoal(db, goal_id)),
    Promise.resolve(loadGoalContext(db, goal_id)),
    buildRepositoryIndexSummary(workspacePath),
    checkBaselineBuild(workspacePath, 60_000),
  ]);

  const instructions = buildOpenClawInstructions({
    task,
    expectedOutput: expected_output,
    language: project.language,
    framework: project.framework,
    projectId: project.project_id,
    nexusResearch: nexusResearch.length > 0 ? nexusResearch : undefined,
    goalContext,
    repositoryIndexSummary: repoIndexSummary || undefined,
    baselineBuildFailed,
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

  while (true) {
    const elapsed = performance.now() - startTime;
    if (elapsed >= config.taskTimeoutMs) {
      logger.warn({ elapsed, timeout: config.taskTimeoutMs, iterations: state.iterationsUsed }, "OpenClaw task timeout reached");
      return buildTimeoutResult(state, workspacePath);
    }

    const budgetError = checkBudgetExceeded(state, config);
    if (budgetError) {
      logger.warn({ reason: budgetError, iterations: state.iterationsUsed, tokens: state.totalTokensUsed }, "OpenClaw budget limit reached");
      return buildBudgetExceededResult(state, budgetError, workspacePath);
    }

    const outcome = await processIteration(state, ctx);
    if (outcome.done) return outcome.result;
  }
}

async function buildTimeoutResult(
  state: ToolLoopState,
  workspacePath: string,
): Promise<OpenClawExecutionResult> {
  const filesChanged = await detectChangedFiles(workspacePath);
  return {
    success: filesChanged.length > 0,
    description: "Task timed out but partial changes may have been applied",
    filesChanged,
    totalTokensUsed: state.totalTokensUsed,
    iterationsUsed: state.iterationsUsed,
    error: "Task execution timed out",
  };
}

async function buildBudgetExceededResult(
  state: ToolLoopState,
  reason: string,
  workspacePath: string,
): Promise<OpenClawExecutionResult> {
  const filesChanged = await detectChangedFiles(workspacePath);
  return {
    success: filesChanged.length > 0,
    description: `Budget limit: ${reason}. Partial changes may have been applied.`,
    filesChanged,
    totalTokensUsed: state.totalTokensUsed,
    iterationsUsed: state.iterationsUsed,
    error: reason,
  };
}

export function buildForgeCodeOutput(
  result: OpenClawExecutionResult,
): ForgeCodeOutput {
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
