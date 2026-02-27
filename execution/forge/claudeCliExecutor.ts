import type BetterSqlite3 from "better-sqlite3";
import { execFile } from "node:child_process";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "../../config/logger.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import type { Project } from "../../state/projects.js";
import { getResearchByGoalId } from "../../state/nexusResearch.js";
import { getGoalById } from "../../state/goals.js";
import { discoverProjectStructure } from "../discovery/fileDiscovery.js";
import { buildRepositoryIndex, formatIndexForPrompt } from "../discovery/repositoryIndexer.js";
import { checkBaselineBuild } from "./forgeValidation.js";
import { buildClaudeMdContent } from "./claudeCliInstructions.js";
import type { ClaudeCliInstructionsContext } from "./claudeCliInstructions.js";
import { classifyTaskType } from "./openclawInstructions.js";
import type { ForgeTaskType } from "./openclawInstructions.js";
import type { NexusResearchContext, GoalContext, ForgeCodeOutput } from "./forgeTypes.js";
import { runValidationCycle, DEFAULT_VALIDATIONS } from "./openclawValidation.js";
import type { ValidationResults, ExecutionStatus } from "./openclawValidation.js";
import { runHeuristicReview, formatReviewForCorrection } from "./openclawReview.js";
import type { ReviewResult } from "./openclawReview.js";
import {
  writeExecutionPlan,
  writeReviewReport,
  writeChangesManifest,
} from "./openclawArtifacts.js";
import type { ExecutionEventEmitter } from "../shared/executionEventEmitter.js";

const execFileAsync = promisify(execFile);

const REPO_INDEX_MAX_CHARS = 3000;
const MAX_CORRECTION_CYCLES = 5;
const MAX_REVIEW_CORRECTION_ATTEMPTS = 2;
const CLAUDE_MD_FILENAME = "CLAUDE.md";

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

interface ClaudeCliModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly costUSD?: number;
}

interface ClaudeCliJsonOutput {
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

function loadClaudeCliConfig(): ClaudeCliExecutorConfig {
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

async function verifyClaudeCliAvailable(cliPath: string): Promise<boolean> {
  try {
    await execFileAsync(cliPath, ["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function detectChangedFiles(workspacePath: string): Promise<readonly string[]> {
  try {
    const { stdout: trackedDiff } = await execFileAsync(
      "git",
      ["diff", "--name-only", "HEAD"],
      { cwd: workspacePath, timeout: 15_000 },
    );

    const { stdout: untrackedFiles } = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: workspacePath, timeout: 15_000 },
    );

    const files = new Set<string>();

    for (const line of trackedDiff.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }

    for (const line of untrackedFiles.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }

    return [...files].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to detect changed files via git");
    return [];
  }
}

function buildPrompt(task: string, expectedOutput: string): string {
  const lines = [
    "IMPLEMENT the following task by making actual code changes:",
    "",
    task,
  ];

  if (expectedOutput) {
    lines.push("", `Expected output: ${expectedOutput}`);
  }

  lines.push(
    "",
    "CRITICAL: You MUST use tools to read and modify files. Do NOT just write a plan or explanation.",
    "If you respond with only text and no tool calls, the task will be marked as FAILED.",
  );

  return lines.join("\n");
}

export function parseClaudeCliOutput(rawOutput: string): ClaudeCliJsonOutput {
  const trimmed = rawOutput.trim();

  if (!trimmed) {
    return { result: "", is_error: true };
  }

  try {
    return JSON.parse(trimmed) as ClaudeCliJsonOutput;
  } catch {
    return { result: trimmed, is_error: false };
  }
}

function extractTokensUsed(output: ClaudeCliJsonOutput): number {
  if (output.modelUsage) {
    let total = 0;
    for (const model of Object.values(output.modelUsage)) {
      total += (model.inputTokens ?? 0)
        + (model.outputTokens ?? 0)
        + (model.cacheReadInputTokens ?? 0)
        + (model.cacheCreationInputTokens ?? 0);
    }
    return total;
  }

  if (!output.usage) return 0;
  return (output.usage.input_tokens ?? 0)
    + (output.usage.output_tokens ?? 0)
    + (output.usage.cache_creation_input_tokens ?? 0)
    + (output.usage.cache_read_input_tokens ?? 0);
}

function extractCostUsd(output: ClaudeCliJsonOutput): number {
  return output.total_cost_usd ?? 0;
}

async function writeClaudeMd(
  workspacePath: string,
  ctx: ClaudeCliInstructionsContext,
): Promise<string> {
  const content = buildClaudeMdContent(ctx);
  const filePath = path.join(workspacePath, CLAUDE_MD_FILENAME);
  await fsPromises.writeFile(filePath, content, "utf-8");
  logger.debug({ path: filePath }, "Generated CLAUDE.md for Claude CLI executor");
  return filePath;
}

async function removeClaudeMd(workspacePath: string): Promise<void> {
  try {
    await fsPromises.unlink(path.join(workspacePath, CLAUDE_MD_FILENAME));
  } catch {
    // ignore if already removed
  }
}

interface SpawnOptions {
  readonly model?: string;
  readonly resumeSessionId?: string;
}

async function spawnClaudeCli(
  config: ClaudeCliExecutorConfig,
  workspacePath: string,
  prompt: string,
  options?: SpawnOptions,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const effectiveModel = options?.model ?? config.model;

  const args: string[] = [
    "-p",
    prompt,
    "--output-format", "json",
    "--model", effectiveModel,
    "--max-turns", String(config.maxTurns),
    "--max-budget-usd", String(config.maxBudgetUsd),
    "--allowedTools", "Edit,Write,Bash,Read,Glob,Grep",
    "--dangerously-skip-permissions",
  ];

  if (options?.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  }

  logger.info(
    {
      cli: config.cliPath,
      model: effectiveModel,
      maxTurns: config.maxTurns,
      timeoutMs: config.timeoutMs,
      resumeSession: options?.resumeSessionId ?? null,
      workspacePath,
    },
    "Spawning Claude CLI process",
  );

  try {
    const { stdout, stderr } = await execFileAsync(
      config.cliPath,
      args,
      {
        cwd: workspacePath,
        timeout: config.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" },
      },
    );

    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
      signal?: string;
      message?: string;
    };

    if (execError.signal === "SIGTERM") {
      logger.warn({ timeoutMs: config.timeoutMs }, "Claude CLI process timed out");
    }

    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message ?? "",
      exitCode: execError.code ?? 1,
    };
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
    logger.warn({ error: msg }, "Failed to build repository index for Claude CLI");
    return "";
  }
}

interface ClaudeCliLoopParams {
  readonly db: BetterSqlite3.Database;
  readonly delegation: KairosDelegation;
  readonly project: Project;
  readonly workspacePath: string;
  readonly config: ClaudeCliExecutorConfig;
  readonly startTime: number;
  readonly traceId?: string;
  readonly emitter?: ExecutionEventEmitter;
}

async function executeClaudeCliTask(
  params: ClaudeCliLoopParams,
  spawnOpts?: SpawnOptions,
): Promise<ClaudeCliExecutionResult> {
  const { delegation, workspacePath, config, startTime, traceId } = params;
  const { task, expected_output } = delegation;

  const prompt = buildPrompt(task, expected_output);

  params.emitter?.info("forge", "forge:cli_spawned", `Spawning Claude CLI (${spawnOpts?.model ?? config.model})`, {
    phase: "cli_execution",
    metadata: {
      model: spawnOpts?.model ?? config.model,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      resume: Boolean(spawnOpts?.resumeSessionId),
    },
  });

  const cliResult = await spawnClaudeCli(config, workspacePath, prompt, spawnOpts);
  const parsed = parseClaudeCliOutput(cliResult.stdout);
  const tokensUsed = extractTokensUsed(parsed);
  const costUsd = extractCostUsd(parsed);
  const elapsed = Math.round(performance.now() - startTime);

  logger.info(
    {
      exitCode: cliResult.exitCode,
      tokensUsed,
      costUsd,
      numTurns: parsed.num_turns,
      durationMs: parsed.duration_ms,
      sessionId: parsed.session_id,
      hasResult: Boolean(parsed.result),
      elapsed,
      traceId,
    },
    "Claude CLI execution completed",
  );

  if (cliResult.stderr) {
    logger.debug({ stderr: cliResult.stderr.slice(0, 500) }, "Claude CLI stderr output");
  }

  if (parsed.is_error || (cliResult.exitCode !== 0 && !parsed.result)) {
    return {
      success: false,
      status: "FAILURE",
      description: "",
      filesChanged: [],
      totalTokensUsed: tokensUsed,
      totalCostUsd: costUsd,
      iterationsUsed: 1,
      validations: DEFAULT_VALIDATIONS,
      correctionCycles: 0,
      sessionId: parsed.session_id,
      error: parsed.result ?? cliResult.stderr ?? "Claude CLI execution failed",
    };
  }

  const filesChanged = await detectChangedFiles(workspacePath);

  params.emitter?.info("forge", "forge:cli_completed", "Claude CLI execution completed", {
    phase: "cli_execution",
    metadata: {
      tokensUsed,
      costUsd,
      elapsedMs: elapsed,
      filesChanged: filesChanged.length,
      sessionId: parsed.session_id,
    },
  });

  if (filesChanged.length > 0) {
    params.emitter?.info("forge", "forge:files_changed", `${filesChanged.length} files modified`, {
      phase: "cli_execution",
      metadata: { files: filesChanged },
    });
  }

  return {
    success: true,
    status: "SUCCESS",
    description: parsed.result ?? "Task completed via Claude CLI",
    filesChanged,
    totalTokensUsed: tokensUsed,
    totalCostUsd: costUsd,
    iterationsUsed: 1,
    validations: DEFAULT_VALIDATIONS,
    correctionCycles: 0,
    sessionId: parsed.session_id,
  };
}

async function executeCorrectionTask(
  params: ClaudeCliLoopParams,
  validationErrors: string,
  changedFiles: readonly string[],
  sessionId?: string,
): Promise<ClaudeCliExecutionResult> {
  const correctionParams: ClaudeCliLoopParams = {
    ...params,
    delegation: {
      ...params.delegation,
      task: `FIX VALIDATION ERRORS in previous changes:\n\n${validationErrors}\n\nFiles changed: ${changedFiles.join(", ")}`,
      expected_output: "Fix the errors and ensure lint/build/tests pass.",
    },
  };

  return executeClaudeCliTask(correctionParams, {
    resumeSessionId: sessionId,
  });
}

async function executeReviewCorrectionTask(
  params: ClaudeCliLoopParams,
  reviewFindings: string,
  changedFiles: readonly string[],
  sessionId?: string,
): Promise<ClaudeCliExecutionResult> {
  const correctionParams: ClaudeCliLoopParams = {
    ...params,
    delegation: {
      ...params.delegation,
      task: `FIX CODE REVIEW FINDINGS in previous changes:\n\n${reviewFindings}\n\nFiles changed: ${changedFiles.join(", ")}`,
      expected_output: "Fix the critical review findings. Do not change unrelated code.",
    },
  };

  return executeClaudeCliTask(correctionParams, {
    resumeSessionId: sessionId,
  });
}

async function runCorrectionLoop(
  initialResult: ClaudeCliExecutionResult,
  params: ClaudeCliLoopParams,
): Promise<ClaudeCliExecutionResult> {
  let currentResult = initialResult;
  let correctionCycles = 0;
  let validations = DEFAULT_VALIDATIONS;
  let accumulatedCostUsd = initialResult.totalCostUsd;
  const sessionId = initialResult.sessionId;

  for (let cycle = 0; cycle < MAX_CORRECTION_CYCLES; cycle++) {
    params.emitter?.info("forge", "forge:validation_started", `Validation cycle ${cycle + 1}`, {
      phase: "validation",
      metadata: { cycle: cycle + 1, accumulatedCostUsd },
    });

    const validation = await runValidationCycle(params.workspacePath, currentResult.filesChanged);
    validations = validation.results;

    if (validation.passed) {
      params.emitter?.info("forge", "forge:validation_passed", "All validations passed", {
        phase: "validation",
        metadata: { cycle: cycle + 1, lint: validations.lint, build: validations.build, tests: validations.tests },
      });
      logger.info({ cycle, validations }, "All validations passed (Claude CLI)");
      return { ...currentResult, status: "SUCCESS", validations, correctionCycles };
    }

    correctionCycles++;

    params.emitter?.warn("forge", "forge:validation_failed", "Validation failed, triggering correction", {
      phase: "validation",
      metadata: { cycle: correctionCycles, lint: validations.lint, build: validations.build, tests: validations.tests, accumulatedCostUsd },
    });

    if (accumulatedCostUsd >= params.config.maxTotalCostUsd) {
      params.emitter?.warn("forge", "forge:cost_ceiling_reached", "Cost ceiling reached during corrections", {
        phase: "validation",
        metadata: { accumulatedCostUsd, maxTotalCostUsd: params.config.maxTotalCostUsd },
      });
      logger.warn(
        { accumulatedCostUsd, maxTotalCostUsd: params.config.maxTotalCostUsd },
        "Total cost ceiling reached — stopping correction cycles",
      );
      break;
    }

    logger.warn(
      { cycle: correctionCycles, maxCycles: MAX_CORRECTION_CYCLES, validations, accumulatedCostUsd },
      "Validation failed, starting Claude CLI correction cycle",
    );

    const elapsed = performance.now() - params.startTime;
    if (elapsed >= params.config.timeoutMs) {
      logger.warn({ elapsed, timeout: params.config.timeoutMs }, "Timeout reached during correction cycle");
      break;
    }

    const correctionResult = await executeCorrectionTask(
      params,
      validation.errorOutput,
      currentResult.filesChanged,
      sessionId,
    );

    accumulatedCostUsd += correctionResult.totalCostUsd;
    const updatedFiles = await detectChangedFiles(params.workspacePath);

    currentResult = {
      ...correctionResult,
      filesChanged: updatedFiles.length > 0 ? updatedFiles : currentResult.filesChanged,
      totalTokensUsed: currentResult.totalTokensUsed + correctionResult.totalTokensUsed,
      totalCostUsd: accumulatedCostUsd,
      iterationsUsed: currentResult.iterationsUsed + correctionResult.iterationsUsed,
      sessionId: correctionResult.sessionId ?? sessionId,
    };
  }

  const anyFailed =
    validations.lint === "fail" || validations.build === "fail" || validations.tests === "fail";
  const finalStatus: ExecutionStatus = anyFailed ? "PARTIAL_SUCCESS" : "SUCCESS";

  return { ...currentResult, status: finalStatus, validations, correctionCycles };
}

async function runPostCorrectionReview(
  result: ClaudeCliExecutionResult,
  params: ClaudeCliLoopParams,
): Promise<ClaudeCliExecutionResult> {
  if (!result.success && result.status === "FAILURE") {
    return result;
  }

  if (result.filesChanged.length === 0) {
    return result;
  }

  params.emitter?.info("forge", "forge:review_started", "Heuristic review started", {
    phase: "review",
    metadata: { filesCount: result.filesChanged.length },
  });

  const review = await runHeuristicReview(params.workspacePath, result.filesChanged);

  if (review.passed) {
    params.emitter?.info("forge", "forge:review_passed", "Heuristic review passed", {
      phase: "review",
    });
    return { ...result, review };
  }

  const correctionContext = formatReviewForCorrection(review);
  if (!correctionContext) {
    return { ...result, review };
  }

  params.emitter?.warn("forge", "forge:review_failed", "Review found CRITICAL issues", {
    phase: "review",
    metadata: { criticalCount: review.criticalCount, warningCount: review.warningCount },
  });

  logger.warn(
    { criticalCount: review.criticalCount, warningCount: review.warningCount },
    "Heuristic review found CRITICAL issues — triggering Claude CLI correction",
  );

  let current = result;
  let accumulatedCostUsd = result.totalCostUsd;
  const sessionId = result.sessionId;

  for (let attempt = 0; attempt < MAX_REVIEW_CORRECTION_ATTEMPTS; attempt++) {
    const elapsed = performance.now() - params.startTime;
    if (elapsed >= params.config.timeoutMs) {
      logger.warn({ elapsed }, "Timeout during review correction (Claude CLI)");
      break;
    }

    if (accumulatedCostUsd >= params.config.maxTotalCostUsd) {
      logger.warn(
        { accumulatedCostUsd, maxTotalCostUsd: params.config.maxTotalCostUsd },
        "Total cost ceiling reached — stopping review corrections",
      );
      break;
    }

    const correctionResult = await executeReviewCorrectionTask(
      params,
      correctionContext,
      current.filesChanged,
      sessionId,
    );

    accumulatedCostUsd += correctionResult.totalCostUsd;
    const updatedFiles = await detectChangedFiles(params.workspacePath);

    const updatedResult: ClaudeCliExecutionResult = {
      ...current,
      filesChanged: updatedFiles.length > 0 ? updatedFiles : current.filesChanged,
      totalTokensUsed: current.totalTokensUsed + correctionResult.totalTokensUsed,
      totalCostUsd: accumulatedCostUsd,
      iterationsUsed: current.iterationsUsed + correctionResult.iterationsUsed,
      sessionId: correctionResult.sessionId ?? sessionId,
    };

    const retryReview = await runHeuristicReview(params.workspacePath, updatedResult.filesChanged);

    if (retryReview.passed) {
      logger.info({ attempt: attempt + 1 }, "Review correction resolved all CRITICAL issues (Claude CLI)");
      return { ...updatedResult, review: retryReview };
    }

    logger.warn(
      { attempt: attempt + 1, criticalCount: retryReview.criticalCount },
      "Review correction did not resolve all issues (Claude CLI)",
    );
    current = { ...updatedResult, review: retryReview };
  }

  return { ...current, review, status: "PARTIAL_SUCCESS" };
}

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

  const isAvailable = await verifyClaudeCliAvailable(config.cliPath);
  if (!isAvailable) {
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
      error: `Claude CLI not found at "${config.cliPath}". Install it with: npm install -g @anthropic-ai/claude-code`,
    };
  }

  const taskType = classifyTaskType(delegation.task);
  const effectiveModel = selectModelForTask(config, taskType);

  logger.info(
    { taskType, selectedModel: effectiveModel, defaultModel: config.model, fixModel: config.fixModel },
    "Model selected based on task type",
  );

  emitter?.info("forge", "forge:model_selected", `Model ${effectiveModel} selected for ${taskType} task`, {
    phase: "setup",
    metadata: { taskType, model: effectiveModel, fixModel: config.fixModel },
  });

  await writeExecutionPlan(workspacePath, {
    task: delegation.task,
    taskType,
    expectedOutput: delegation.expected_output,
  });

  const [nexusResearch, goalContext, repoIndexSummary, baselineBuildFailed] = await Promise.all([
    Promise.resolve(loadNexusResearchForGoal(db, delegation.goal_id)),
    Promise.resolve(loadGoalContext(db, delegation.goal_id)),
    buildRepositoryIndexSummary(workspacePath),
    checkBaselineBuild(workspacePath, 60_000),
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
  };

  await writeClaudeMd(workspacePath, instructionsCtx);

  emitter?.info("forge", "forge:context_loaded", "Context loaded and CLAUDE.md generated", {
    phase: "setup",
    metadata: {
      hasNexusResearch: nexusResearch.length > 0,
      hasGoalContext: Boolean(goalContext),
      repoIndexChars: repoIndexSummary?.length ?? 0,
      baselineBuildFailed,
    },
  });

  const params: ClaudeCliLoopParams = {
    db,
    delegation,
    project,
    workspacePath,
    config,
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
