import { logger } from "../../config/logger.js";
import { runValidationCycle, DEFAULT_VALIDATIONS } from "./openclawValidation.js";
import type { ExecutionStatus } from "./openclawValidation.js";
import { runHeuristicReview, formatReviewForCorrection } from "./openclawReview.js";
import type { OpenClawExecutionResult } from "./openclawAutonomousExecutor.js";
import type { OpenClawLoopParams, OpenClawLoopExecutor } from "./openclawAutonomousExecutor.js";
import { copyWorkspaceToSandbox, syncChangesBack } from "./openclawSandboxManager.js";

const MAX_CORRECTION_CYCLES = 5;
const MAX_REVIEW_CORRECTION_ATTEMPTS = 2;

interface CorrectionLoopContext {
  readonly initialResult: OpenClawExecutionResult;
  readonly loopParams: OpenClawLoopParams;
  readonly loopExecutor: OpenClawLoopExecutor;
}

export async function runCorrectionLoop(
  ctx: CorrectionLoopContext,
): Promise<OpenClawExecutionResult> {
  const { initialResult, loopParams, loopExecutor } = ctx;
  const { workspacePath, config } = loopParams;

  let currentResult = initialResult;
  let correctionCycles = 0;
  let validations = DEFAULT_VALIDATIONS;

  for (let cycle = 0; cycle < MAX_CORRECTION_CYCLES; cycle++) {
    const validation = await runValidationCycle(workspacePath, currentResult.filesChanged);
    validations = validation.results;

    if (validation.passed) {
      logger.info({ cycle, validations }, "All validations passed");
      return { ...currentResult, status: "SUCCESS", validations, correctionCycles };
    }

    correctionCycles++;
    logger.warn(
      { cycle: correctionCycles, maxCycles: MAX_CORRECTION_CYCLES, validations },
      "Validation failed, starting correction cycle",
    );

    const elapsed = performance.now() - loopParams.startTime;
    if (elapsed >= config.taskTimeoutMs) {
      logger.warn(
        { elapsed, timeout: config.taskTimeoutMs },
        "Timeout reached during correction cycle",
      );
      break;
    }

    await copyWorkspaceToSandbox(workspacePath);

    const correctionResult = await executeCorrectionLoop(
      loopParams,
      validation.errorOutput,
      currentResult.filesChanged,
      loopExecutor,
    );

    const syncedFiles = await syncChangesBack(workspacePath);

    currentResult = {
      ...correctionResult,
      filesChanged: syncedFiles.length > 0 ? syncedFiles : currentResult.filesChanged,
      totalTokensUsed: currentResult.totalTokensUsed + correctionResult.totalTokensUsed,
      iterationsUsed: currentResult.iterationsUsed + correctionResult.iterationsUsed,
    };
  }

  const anyFailed =
    validations.lint === "fail" || validations.build === "fail" || validations.tests === "fail";
  const finalStatus: ExecutionStatus = anyFailed ? "PARTIAL_SUCCESS" : "SUCCESS";

  return { ...currentResult, status: finalStatus, validations, correctionCycles };
}

export async function runPostCorrectionReview(
  result: OpenClawExecutionResult,
  loopParams: OpenClawLoopParams,
  loopExecutor: OpenClawLoopExecutor,
): Promise<OpenClawExecutionResult> {
  if (!result.success && result.status === "FAILURE") {
    return result;
  }

  if (result.filesChanged.length === 0) {
    return result;
  }

  const review = await runHeuristicReview(loopParams.workspacePath, result.filesChanged);

  if (review.passed) {
    return { ...result, review };
  }

  const correctionContext = formatReviewForCorrection(review);
  if (!correctionContext) {
    return { ...result, review };
  }

  logger.warn(
    { criticalCount: review.criticalCount, warningCount: review.warningCount },
    "Heuristic review found CRITICAL issues — triggering correction",
  );

  for (let attempt = 0; attempt < MAX_REVIEW_CORRECTION_ATTEMPTS; attempt++) {
    const elapsed = performance.now() - loopParams.startTime;
    if (elapsed >= loopParams.config.taskTimeoutMs) {
      logger.warn({ elapsed }, "Timeout during review correction");
      break;
    }

    await copyWorkspaceToSandbox(loopParams.workspacePath);

    const correctionResult = await executeReviewCorrectionLoop(
      loopParams,
      correctionContext,
      result.filesChanged,
      loopExecutor,
    );
    const syncedFiles = await syncChangesBack(loopParams.workspacePath);

    const updatedResult: OpenClawExecutionResult = {
      ...result,
      filesChanged: syncedFiles.length > 0 ? syncedFiles : result.filesChanged,
      totalTokensUsed: result.totalTokensUsed + correctionResult.totalTokensUsed,
      iterationsUsed: result.iterationsUsed + correctionResult.iterationsUsed,
    };

    const retryReview = await runHeuristicReview(
      loopParams.workspacePath,
      updatedResult.filesChanged,
    );

    if (retryReview.passed) {
      logger.info({ attempt: attempt + 1 }, "Review correction resolved all CRITICAL issues");
      return { ...updatedResult, review: retryReview };
    }

    logger.warn(
      { attempt: attempt + 1, criticalCount: retryReview.criticalCount },
      "Review correction did not resolve all issues",
    );
    result = { ...updatedResult, review: retryReview };
  }

  return { ...result, review, status: "PARTIAL_SUCCESS" };
}

async function executeReviewCorrectionLoop(
  baseParams: OpenClawLoopParams,
  reviewFindings: string,
  changedFiles: readonly string[],
  loopExecutor: OpenClawLoopExecutor,
): Promise<OpenClawExecutionResult> {
  const correctionParams: OpenClawLoopParams = {
    ...baseParams,
    delegation: {
      ...baseParams.delegation,
      task: `FIX CODE REVIEW FINDINGS in previous changes:\n\n${reviewFindings}\n\nFiles changed: ${changedFiles.join(", ")}`,
      expected_output: "Fix the critical review findings. Do not change unrelated code.",
    },
  };

  return loopExecutor(correctionParams);
}

async function executeCorrectionLoop(
  baseParams: OpenClawLoopParams,
  validationErrors: string,
  changedFiles: readonly string[],
  loopExecutor: OpenClawLoopExecutor,
): Promise<OpenClawExecutionResult> {
  const correctionParams: OpenClawLoopParams = {
    ...baseParams,
    delegation: {
      ...baseParams.delegation,
      task: `FIX VALIDATION ERRORS in previous changes:\n\n${validationErrors}\n\nFiles changed: ${changedFiles.join(", ")}`,
      expected_output: "Fix the errors and ensure lint/build/tests pass.",
    },
  };

  return loopExecutor(correctionParams);
}
