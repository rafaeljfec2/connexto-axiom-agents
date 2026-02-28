import { logger } from "../../config/logger.js";
import { runValidationCycle, DEFAULT_VALIDATIONS } from "./openclawValidation.js";
import type { ExecutionStatus, ValidationCycleOptions } from "./openclawValidation.js";
import { runHeuristicReview, formatReviewForCorrection } from "./openclawReview.js";
import type {
  ClaudeCliExecutionResult,
  ClaudeCliLoopParams,
  SpawnOptions,
} from "./claudeCliTypes.js";
import { MAX_CORRECTION_CYCLES, MAX_REVIEW_CORRECTION_ATTEMPTS, PHASE_TOOL_SETS, PHASE_MAX_TURNS } from "./claudeCliTypes.js";
import { spawnClaudeCli } from "./claudeCliProcess.js";
import { parseClaudeCliOutput, extractTokensUsed, extractCostUsd } from "./claudeCliOutputParser.js";
import { detectChangedFiles, buildPrompt, buildPlanningPrompt, buildImplementationPrompt, buildTestingPrompt } from "./claudeCliContext.js";

export async function executeClaudeCliTask(
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

  const cliResult = await spawnClaudeCli(config, workspacePath, prompt, {
    ...spawnOpts,
    emitter: params.emitter,
  });
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

  const hasFailed = parsed.is_error || (cliResult.exitCode !== 0 && !parsed.result);

  if (cliResult.stderr) {
    const logLevel = hasFailed ? "warn" : "debug";
    logger[logLevel]({ stderr: cliResult.stderr.slice(0, 1000) }, "Claude CLI stderr output");
  }

  if (hasFailed) {
    const errorMessage = parsed.result || cliResult.stderr || "Claude CLI execution failed (no output)";
    const isTimeout = cliResult.exitCode === 143;

    params.emitter?.error("forge", "forge:cli_failed", isTimeout
      ? `Claude CLI timed out after ${Math.round(config.timeoutMs / 1000)}s`
      : `Claude CLI failed (exit ${cliResult.exitCode})`, {
      phase: "cli_execution",
      metadata: {
        exitCode: cliResult.exitCode,
        isTimeout,
        tokensUsed,
        costUsd,
        elapsedMs: elapsed,
        error: errorMessage.slice(0, 500),
      },
    });

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
      error: errorMessage,
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
    metadata: {
      model: spawnOpts?.model ?? config.model,
      maxTurns: config.maxTurns,
      hasPlan: true,
    },
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

export async function runCorrectionLoop(
  initialResult: ClaudeCliExecutionResult,
  params: ClaudeCliLoopParams,
): Promise<ClaudeCliExecutionResult> {
  let currentResult = initialResult;
  let correctionCycles = 0;
  let validations = DEFAULT_VALIDATIONS;
  let accumulatedCostUsd = initialResult.totalCostUsd;
  const sessionId = initialResult.sessionId;
  const validationOptions: ValidationCycleOptions = {
    skipBuild: params.baselineBuildFailed,
  };

  for (let cycle = 0; cycle < MAX_CORRECTION_CYCLES; cycle++) {
    params.emitter?.info("forge", "forge:validation_started", `Validation cycle ${cycle + 1}`, {
      phase: "validation",
      metadata: { cycle: cycle + 1, accumulatedCostUsd },
    });

    const validation = await runValidationCycle(params.workspacePath, currentResult.filesChanged, validationOptions);
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

export async function runPostCorrectionReview(
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

  const stackContext = { language: params.project.language, framework: params.project.framework };
  const review = await runHeuristicReview(params.workspacePath, result.filesChanged, stackContext);

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

    const retryReview = await runHeuristicReview(params.workspacePath, updatedResult.filesChanged, stackContext);

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
