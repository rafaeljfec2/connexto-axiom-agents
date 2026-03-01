import { logger } from "../../config/logger.js";
import { DEFAULT_VALIDATIONS } from "./openclawValidation.js";
import type {
  ClaudeCliExecutionResult,
  ClaudeCliLoopParams,
  SpawnOptions,
} from "./claudeCliTypes.js";
import { PHASE_TOOL_SETS, PHASE_MAX_TURNS } from "./claudeCliTypes.js";
import { spawnClaudeCli } from "./claudeCliProcess.js";
import { parseClaudeCliOutput, extractTokensUsed, extractCostUsd } from "./claudeCliOutputParser.js";
import { detectChangedFiles, buildPlanningPrompt, buildImplementationPrompt, buildTestingPrompt } from "./claudeCliContext.js";

export interface PlanningPhaseResult {
  readonly success: boolean;
  readonly plan: string;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly sessionId?: string;
}

export async function executePlanningPhase(
  params: ClaudeCliLoopParams,
  spawnOpts?: SpawnOptions,
): Promise<PlanningPhaseResult> {
  const { delegation, workspacePath, config, startTime } = params;

  const prompt = buildPlanningPrompt(delegation.task, delegation.expected_output);

  params.emitter?.info("forge", "forge:planning_started", "Planning phase started (read-only analysis)", {
    phase: "planning",
    metadata: { model: spawnOpts?.model ?? config.model },
  });

  const planningConfig = {
    ...config,
    maxTurns: PHASE_MAX_TURNS.planning,
    maxBudgetUsd: Math.min(config.maxBudgetUsd, 2),
  };

  const cliResult = await spawnClaudeCli(planningConfig, workspacePath, prompt, {
    ...spawnOpts,
    allowedTools: PHASE_TOOL_SETS.planning,
    maxTurnsOverride: PHASE_MAX_TURNS.planning,
    emitter: params.emitter,
  });

  const parsed = parseClaudeCliOutput(cliResult.stdout);
  const tokensUsed = extractTokensUsed(parsed);
  const costUsd = extractCostUsd(parsed);
  const elapsed = Math.round(performance.now() - startTime);

  logger.info(
    { exitCode: cliResult.exitCode, tokensUsed, costUsd, elapsed, phase: "planning" },
    "Planning phase completed",
  );

  if (parsed.is_error || (cliResult.exitCode !== 0 && !parsed.result)) {
    params.emitter?.warn("forge", "forge:planning_failed", "Planning phase failed, proceeding without plan", {
      phase: "planning",
      metadata: { exitCode: cliResult.exitCode, error: (parsed.result ?? cliResult.stderr ?? "").slice(0, 300) },
    });
    return { success: false, plan: "", tokensUsed, costUsd, sessionId: parsed.session_id };
  }

  const plan = parsed.result ?? "";

  params.emitter?.info("forge", "forge:planning_completed", "Planning phase completed", {
    phase: "planning",
    metadata: { planLength: plan.length, tokensUsed, costUsd },
  });

  return { success: true, plan, tokensUsed, costUsd, sessionId: parsed.session_id };
}

export async function executeImplementationWithPlan(
  params: ClaudeCliLoopParams,
  executionPlan: string,
  spawnOpts?: SpawnOptions,
): Promise<ClaudeCliExecutionResult> {
  const { delegation, workspacePath, config, startTime, traceId } = params;

  const prompt = buildImplementationPrompt(delegation.task, delegation.expected_output, executionPlan);

  params.emitter?.info("forge", "forge:cli_spawned", `Implementation phase (${spawnOpts?.model ?? config.model}) with execution plan`, {
    phase: "cli_execution",
    metadata: { model: spawnOpts?.model ?? config.model, maxTurns: config.maxTurns, hasPlan: true },
  });

  const cliResult = await spawnClaudeCli(config, workspacePath, prompt, {
    ...spawnOpts,
    allowedTools: PHASE_TOOL_SETS.implementation,
    emitter: params.emitter,
  });

  const parsed = parseClaudeCliOutput(cliResult.stdout);
  const tokensUsed = extractTokensUsed(parsed);
  const costUsd = extractCostUsd(parsed);
  const elapsed = Math.round(performance.now() - startTime);

  logger.info(
    { exitCode: cliResult.exitCode, tokensUsed, costUsd, numTurns: parsed.num_turns, sessionId: parsed.session_id, elapsed, traceId },
    "Implementation phase completed",
  );

  if (parsed.is_error || (cliResult.exitCode !== 0 && !parsed.result)) {
    const errorMessage = parsed.result ?? cliResult.stderr ?? "Implementation phase failed";
    const isTimeout = cliResult.exitCode === 143;

    params.emitter?.error("forge", "forge:cli_failed", isTimeout
      ? `Implementation timed out after ${Math.round(config.timeoutMs / 1000)}s`
      : `Implementation failed (exit ${cliResult.exitCode})`, {
      phase: "cli_execution",
      metadata: { exitCode: cliResult.exitCode, isTimeout, tokensUsed, costUsd, error: errorMessage.slice(0, 500) },
    });

    return {
      success: false, status: "FAILURE", description: "", filesChanged: [],
      totalTokensUsed: tokensUsed, totalCostUsd: costUsd, iterationsUsed: 1,
      validations: DEFAULT_VALIDATIONS, correctionCycles: 0, sessionId: parsed.session_id, error: errorMessage,
    };
  }

  const filesChanged = await detectChangedFiles(workspacePath);

  params.emitter?.info("forge", "forge:cli_completed", "Implementation phase completed", {
    phase: "cli_execution",
    metadata: { tokensUsed, costUsd, elapsedMs: elapsed, filesChanged: filesChanged.length, sessionId: parsed.session_id },
  });

  return {
    success: true, status: "SUCCESS",
    description: parsed.result ?? "Task completed via Claude CLI (with plan)",
    filesChanged, totalTokensUsed: tokensUsed, totalCostUsd: costUsd,
    iterationsUsed: 1, validations: DEFAULT_VALIDATIONS, correctionCycles: 0,
    sessionId: parsed.session_id,
  };
}

export async function executeTestingPhase(
  params: ClaudeCliLoopParams,
  filesChanged: readonly string[],
  sessionId?: string,
  spawnOpts?: SpawnOptions,
): Promise<ClaudeCliExecutionResult> {
  const { delegation, workspacePath, config, startTime, traceId } = params;

  const prompt = buildTestingPrompt(delegation.task, filesChanged);

  params.emitter?.info("forge", "forge:testing_started", "Testing phase started (writing tests)", {
    phase: "testing",
    metadata: { filesCount: filesChanged.length, model: spawnOpts?.model ?? config.model },
  });

  const testingConfig = {
    ...config,
    maxTurns: PHASE_MAX_TURNS.testing,
    maxBudgetUsd: Math.min(config.maxBudgetUsd, 3),
  };

  const cliResult = await spawnClaudeCli(testingConfig, workspacePath, prompt, {
    ...spawnOpts,
    allowedTools: PHASE_TOOL_SETS.testing,
    maxTurnsOverride: PHASE_MAX_TURNS.testing,
    resumeSessionId: sessionId,
    emitter: params.emitter,
  });

  const parsed = parseClaudeCliOutput(cliResult.stdout);
  const tokensUsed = extractTokensUsed(parsed);
  const costUsd = extractCostUsd(parsed);
  const elapsed = Math.round(performance.now() - startTime);

  logger.info(
    { exitCode: cliResult.exitCode, tokensUsed, costUsd, elapsed, phase: "testing", traceId },
    "Testing phase completed",
  );

  if (parsed.is_error || (cliResult.exitCode !== 0 && !parsed.result)) {
    params.emitter?.warn("forge", "forge:testing_failed", "Testing phase failed", {
      phase: "testing",
      metadata: { exitCode: cliResult.exitCode, error: (parsed.result ?? cliResult.stderr ?? "").slice(0, 300) },
    });

    return {
      success: false, status: "PARTIAL_SUCCESS", description: "", filesChanged: [],
      totalTokensUsed: tokensUsed, totalCostUsd: costUsd, iterationsUsed: 1,
      validations: DEFAULT_VALIDATIONS, correctionCycles: 0, sessionId: parsed.session_id,
    };
  }

  const testFilesChanged = await detectChangedFiles(workspacePath);

  params.emitter?.info("forge", "forge:testing_completed", "Testing phase completed", {
    phase: "testing",
    metadata: { tokensUsed, costUsd, newFiles: testFilesChanged.length },
  });

  return {
    success: true, status: "SUCCESS",
    description: parsed.result ?? "Tests written",
    filesChanged: testFilesChanged, totalTokensUsed: tokensUsed, totalCostUsd: costUsd,
    iterationsUsed: 1, validations: DEFAULT_VALIDATIONS, correctionCycles: 0,
    sessionId: parsed.session_id,
  };
}
