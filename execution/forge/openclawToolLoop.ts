import { logger } from "../../config/logger.js";
import { callOpenClawWithTools } from "../shared/openclawResponsesClient.js";
import type {
  ResponseItem,
  OpenClawToolResponse,
  ToolCall,
  ToolDefinition,
} from "../shared/openclawResponsesClient.js";
import { executeTool } from "./openclawToolExecutor.js";
import type { ToolExecutorConfig } from "./openclawToolExecutor.js";
import { DEFAULT_VALIDATIONS } from "./openclawValidation.js";
import type { OpenClawExecutorConfig, OpenClawExecutionResult } from "./openclawAutonomousExecutor.js";
import { PROJECT_TREE_FILENAME } from "./openclawSandboxManager.js";

const SLIDING_WINDOW_THRESHOLD = 5;
const SLIDING_WINDOW_KEEP_RECENT = 3;

export interface ToolLoopState {
  conversationHistory: ResponseItem[];
  totalTokensUsed: number;
  iterationsUsed: number;
  lastResponse: OpenClawToolResponse | null;
}

export interface LoopContext {
  readonly config: OpenClawExecutorConfig;
  readonly instructions: string;
  readonly tools: readonly ToolDefinition[];
  readonly toolExecutorConfig: ToolExecutorConfig;
  readonly workspacePath: string;
  readonly traceId?: string;
  readonly startTime: number;
}

type IterationOutcome =
  | { readonly done: false }
  | { readonly done: true; readonly result: OpenClawExecutionResult };

export function buildInitialInput(task: string, expectedOutput: string): readonly ResponseItem[] {
  return [
    {
      role: "user",
      content: [
        "IMPLEMENT the following task by making actual code changes using your tools:",
        "",
        task,
        "",
        expectedOutput ? `Expected output: ${expectedOutput}` : "",
        "",
        "INSTRUCTIONS:",
        `1. Start by calling read_file("${PROJECT_TREE_FILENAME}") to see the project structure.`,
        "2. Read the relevant source files to understand the current code.",
        "3. Use edit_file or write_file to make the required changes.",
        "4. Verify your changes with run_command.",
        "",
        "CRITICAL: You MUST call tools to read and modify files. Do NOT just write a plan or explanation.",
        "If you respond with only text and no tool calls, the task will be marked as FAILED.",
      ]
        .filter(Boolean)
        .join("\n"),
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

export function pruneConversationHistory(state: ToolLoopState): void {
  const history = state.conversationHistory;
  const minEntriesForPruning = (SLIDING_WINDOW_KEEP_RECENT * 2) + 2;
  if (history.length <= minEntriesForPruning) return;

  const initialMessages = history.slice(0, 1);
  const recentCount = SLIDING_WINDOW_KEEP_RECENT * 2;
  const recentMessages = history.slice(-recentCount);
  const middleMessages = history.slice(1, -recentCount);

  const summaryParts: string[] = [];
  for (const msg of middleMessages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      const toolNames = msg.tool_calls.map((tc) => tc.function?.name ?? "unknown").join(", ");
      summaryParts.push(`Called tools: ${toolNames}`);
    } else if (msg.role === "tool") {
      const preview = msg.content.length > 100
        ? `${msg.content.slice(0, 100)}...`
        : msg.content;
      summaryParts.push(`Tool result: ${preview}`);
    }
  }

  const summaryContent = [
    `[CONTEXT SUMMARY: ${middleMessages.length} messages pruned for token efficiency]`,
    summaryParts.slice(0, 10).join("\n"),
  ].join("\n");

  const summaryItem: ResponseItem = { role: "user", content: summaryContent };
  const prunedLength = history.length;
  state.conversationHistory = [...initialMessages, summaryItem, ...recentMessages];

  logger.info(
    { before: prunedLength, after: state.conversationHistory.length, pruned: middleMessages.length },
    "Conversation history pruned (sliding window)",
  );
}

async function executeToolCalls(
  toolExecutorConfig: ToolExecutorConfig,
  toolCalls: readonly ToolCall[],
): Promise<readonly string[]> {
  const results: string[] = [];
  for (const tc of toolCalls) {
    const result = await executeTool(toolExecutorConfig, tc);
    results.push(result);
    logger.debug({ tool: tc.name, callId: tc.callId, resultLen: result.length }, "Tool call executed");
  }
  return results;
}

function checkBudgetExceeded(state: ToolLoopState, config: OpenClawExecutorConfig): string | null {
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

function handleFailedResponse(response: OpenClawToolResponse, state: ToolLoopState): IterationOutcome {
  return {
    done: true,
    result: {
      success: false, status: "FAILURE", description: "", filesChanged: [],
      totalTokensUsed: state.totalTokensUsed, iterationsUsed: state.iterationsUsed,
      validations: DEFAULT_VALIDATIONS, correctionCycles: 0,
      error: response.text ?? "OpenClaw agent returned failed status",
    },
  };
}

async function handleCompletedResponse(
  response: OpenClawToolResponse, state: ToolLoopState, ctx: LoopContext,
): Promise<IterationOutcome> {
  const description = extractFinalDescription(response);
  const elapsed = Math.round(performance.now() - ctx.startTime);
  logger.info(
    { iterations: state.iterationsUsed, tokens: state.totalTokensUsed, elapsed },
    "OpenClaw autonomous execution completed",
  );
  return {
    done: true,
    result: {
      success: true, status: "SUCCESS", description, filesChanged: [],
      totalTokensUsed: state.totalTokensUsed, iterationsUsed: state.iterationsUsed,
      validations: DEFAULT_VALIDATIONS, correctionCycles: 0,
    },
  };
}

async function handleToolCallResponse(
  response: OpenClawToolResponse, state: ToolLoopState, ctx: LoopContext,
): Promise<void> {
  const toolCalls = response.toolCalls ?? [];
  const toolResults = await executeToolCalls(ctx.toolExecutorConfig, toolCalls);

  if (response.rawAssistantMessage) {
    state.conversationHistory.push({
      role: "assistant",
      content: response.rawAssistantMessage.content ?? "",
      tool_calls: response.rawAssistantMessage.tool_calls,
    });
  }

  const resultItems = buildToolResultItems(toolCalls, toolResults);
  state.conversationHistory.push(...resultItems);
}

async function processIteration(state: ToolLoopState, ctx: LoopContext): Promise<IterationOutcome> {
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
  return {
    done: true,
    result: {
      success: true, status: "SUCCESS", description: response.text ?? "Unexpected completion",
      filesChanged: [], totalTokensUsed: state.totalTokensUsed, iterationsUsed: state.iterationsUsed,
      validations: DEFAULT_VALIDATIONS, correctionCycles: 0,
    },
  };
}

export function buildTimeoutResult(state: ToolLoopState): OpenClawExecutionResult {
  return {
    success: false, status: "FAILURE",
    description: "Task timed out", filesChanged: [],
    totalTokensUsed: state.totalTokensUsed, iterationsUsed: state.iterationsUsed,
    validations: DEFAULT_VALIDATIONS, correctionCycles: 0, error: "Task execution timed out",
  };
}

export function buildBudgetExceededResult(state: ToolLoopState, reason: string): OpenClawExecutionResult {
  return {
    success: false, status: "FAILURE",
    description: `Budget limit: ${reason}.`, filesChanged: [],
    totalTokensUsed: state.totalTokensUsed, iterationsUsed: state.iterationsUsed,
    validations: DEFAULT_VALIDATIONS, correctionCycles: 0, error: reason,
  };
}

export async function runToolLoop(state: ToolLoopState, ctx: LoopContext): Promise<OpenClawExecutionResult> {
  while (true) {
    const elapsed = performance.now() - ctx.startTime;
    if (elapsed >= ctx.config.taskTimeoutMs) {
      logger.warn({ elapsed, timeout: ctx.config.taskTimeoutMs, iterations: state.iterationsUsed }, "OpenClaw task timeout reached");
      return buildTimeoutResult(state);
    }

    const budgetError = checkBudgetExceeded(state, ctx.config);
    if (budgetError) {
      logger.warn({ reason: budgetError, iterations: state.iterationsUsed, tokens: state.totalTokensUsed }, "OpenClaw budget limit reached");
      return buildBudgetExceededResult(state, budgetError);
    }

    const outcome = await processIteration(state, ctx);
    if (outcome.done) return outcome.result;

    if (state.iterationsUsed > 0 && state.iterationsUsed % SLIDING_WINDOW_THRESHOLD === 0) {
      pruneConversationHistory(state);
    }
  }
}
