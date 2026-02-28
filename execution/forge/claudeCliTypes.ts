import type BetterSqlite3 from "better-sqlite3";
import type { KairosDelegation } from "../../orchestration/types.js";
import type { Project } from "../../state/projects.js";
import type { ForgeTaskType } from "./openclawInstructions.js";
import type { ValidationResults, ExecutionStatus } from "./openclawValidation.js";
import type { ReviewResult } from "./openclawReview.js";
import type { ExecutionEventEmitter } from "../shared/executionEventEmitter.js";

export const REPO_INDEX_MAX_CHARS = 3000;
export const MAX_CORRECTION_CYCLES = 5;
export const MAX_REVIEW_CORRECTION_ATTEMPTS = 2;
export const CLAUDE_MD_FILENAME = "CLAUDE.md";
export const INACTIVITY_TIMEOUT_MS = 60_000;

export interface ClaudeCliExecutorConfig {
  readonly cliPath: string;
  readonly model: string;
  readonly fixModel: string;
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly maxBudgetUsd: number;
  readonly maxTotalCostUsd: number;
}

export interface ClaudeCliExecutionResult {
  readonly success: boolean;
  readonly status: ExecutionStatus;
  readonly description: string;
  readonly filesChanged: readonly string[];
  readonly totalTokensUsed: number;
  readonly totalCostUsd: number;
  readonly iterationsUsed: number;
  readonly validations: ValidationResults;
  readonly correctionCycles: number;
  readonly sessionId?: string;
  readonly review?: ReviewResult;
  readonly error?: string;
}

export interface ClaudeCliModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly costUSD?: number;
}

export interface ClaudeCliJsonOutput {
  readonly type?: string;
  readonly subtype?: string;
  readonly is_error?: boolean;
  readonly result?: string;
  readonly session_id?: string;
  readonly duration_ms?: number;
  readonly duration_api_ms?: number;
  readonly num_turns?: number;
  readonly total_cost_usd?: number;
  readonly stop_reason?: string | null;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_creation_input_tokens?: number;
    readonly cache_read_input_tokens?: number;
  };
  readonly modelUsage?: Record<string, ClaudeCliModelUsage>;
}

export interface ClaudeStreamContentBlock {
  readonly type: string;
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  readonly text?: string;
  readonly thinking?: string;
}

export interface ClaudeStreamEvent {
  readonly type: string;
  readonly subtype?: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: readonly ClaudeStreamContentBlock[];
  };
  readonly is_error?: boolean;
  readonly result?: string;
  readonly session_id?: string;
  readonly total_cost_usd?: number;
  readonly num_turns?: number;
  readonly duration_ms?: number;
  readonly duration_api_ms?: number;
  readonly usage?: ClaudeCliJsonOutput["usage"];
  readonly modelUsage?: Record<string, ClaudeCliModelUsage>;
}

export interface ClaudeAuthStatus {
  readonly available: boolean;
  readonly authenticated: boolean;
  readonly error?: string;
}

export type ExecutionPhase = "planning" | "implementation" | "testing" | "correction";

export const PHASE_TOOL_SETS: Record<ExecutionPhase, string> = {
  planning: "Read,Glob,Grep,Bash",
  implementation: "Edit,Write,Bash,Read,Glob,Grep",
  testing: "Edit,Write,Bash,Read,Glob,Grep",
  correction: "Edit,Write,Bash,Read,Glob,Grep",
};

export const PHASE_MAX_TURNS: Record<ExecutionPhase, number> = {
  planning: 10,
  implementation: 25,
  testing: 15,
  correction: 10,
};

export interface SpawnOptions {
  readonly model?: string;
  readonly resumeSessionId?: string;
  readonly allowedTools?: string;
  readonly maxTurnsOverride?: number;
}

export interface SpawnClaudeCliOptions extends SpawnOptions {
  readonly emitter?: ExecutionEventEmitter;
}

export interface ImplementationReportData {
  readonly taskType: string;
  readonly model: string;
  readonly totalTokensUsed: number;
  readonly totalCostUsd: number;
  readonly durationMs: number;
  readonly filesChanged: readonly string[];
  readonly validations: ValidationResults;
  readonly correctionCycles: number;
  readonly status: ExecutionStatus;
}

export interface ClaudeCliLoopParams {
  readonly db: BetterSqlite3.Database;
  readonly delegation: KairosDelegation;
  readonly project: Project;
  readonly workspacePath: string;
  readonly config: ClaudeCliExecutorConfig;
  readonly startTime: number;
  readonly traceId?: string;
  readonly emitter?: ExecutionEventEmitter;
  readonly baselineBuildFailed?: boolean;
}

export type TaskComplexity = "simple" | "standard" | "complex";

const COMPLEX_TASK_PATTERNS = [
  "from scratch", "new module", "new service", "migration", "migrate",
  "redesign", "rewrite", "full rewrite", "new api", "new endpoint",
  "new feature", "new system", "architecture",
];

export function classifyTaskComplexity(task: string, taskType: ForgeTaskType): TaskComplexity {
  if (taskType === "FIX" && task.length < 200) {
    const multiFileHints = /\b(multiple files|several files|across files|all files)\b/i;
    if (!multiFileHints.test(task)) return "simple";
  }

  if (taskType === "CREATE") return "complex";

  const lower = task.toLowerCase();
  if (COMPLEX_TASK_PATTERNS.some((pattern) => lower.includes(pattern))) return "complex";

  return "standard";
}

export function loadClaudeCliConfig(): ClaudeCliExecutorConfig {
  return {
    cliPath: process.env.CLAUDE_CLI_PATH ?? "claude",
    model: process.env.CLAUDE_CLI_MODEL ?? "sonnet",
    fixModel: process.env.CLAUDE_CLI_FIX_MODEL ?? "haiku",
    maxTurns: Number(process.env.CLAUDE_CLI_MAX_TURNS ?? 25),
    timeoutMs: Number(process.env.CLAUDE_CLI_TIMEOUT_MS ?? 300_000),
    maxBudgetUsd: Number(process.env.CLAUDE_CLI_MAX_BUDGET_USD ?? 5),
    maxTotalCostUsd: Number(process.env.CLAUDE_CLI_MAX_TOTAL_COST_USD ?? 10),
  };
}

export function selectModelForTask(config: ClaudeCliExecutorConfig, taskType: ForgeTaskType): string {
  if (taskType === "FIX") return config.fixModel;
  return config.model;
}
