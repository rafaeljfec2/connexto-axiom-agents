import type { BudgetConfig } from "../config/budget.js";
import type { ExecutionResult } from "../execution/shared/types.js";
import type { ExecutionEvaluation, EvaluationGrade } from "./forgeEvaluator.js";

const SLOW_EXECUTION_THRESHOLD_MS = 60_000;
const HIGH_TOKEN_USAGE_RATIO = 0.8;

export function evaluateNexusExecution(
  result: ExecutionResult,
  budgetConfig: BudgetConfig,
): ExecutionEvaluation {
  if (result.status === "failed") {
    return {
      grade: "FAILURE" as EvaluationGrade,
      reasons: [result.error ?? "execution_error"],
    };
  }

  const partialReasons: string[] = [];

  if (isTokenUsageHigh(result.tokensUsed, budgetConfig.perTaskTokenLimit)) {
    partialReasons.push(
      `high_token_usage: ${String(result.tokensUsed)}/${String(budgetConfig.perTaskTokenLimit)}`,
    );
  }

  if (isExecutionSlow(result.executionTimeMs)) {
    partialReasons.push(`slow_execution: ${String(result.executionTimeMs)}ms`);
  }

  if (partialReasons.length > 0) {
    return { grade: "PARTIAL" as EvaluationGrade, reasons: partialReasons };
  }

  return { grade: "SUCCESS" as EvaluationGrade, reasons: [] };
}

function isTokenUsageHigh(tokensUsed: number | undefined, perTaskTokenLimit: number): boolean {
  return tokensUsed !== undefined && tokensUsed > perTaskTokenLimit * HIGH_TOKEN_USAGE_RATIO;
}

function isExecutionSlow(executionTimeMs: number | undefined): boolean {
  return executionTimeMs !== undefined && executionTimeMs > SLOW_EXECUTION_THRESHOLD_MS;
}
