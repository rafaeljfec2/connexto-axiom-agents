import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateNexusExecution } from "./nexusEvaluator.js";
import type { ExecutionResult } from "../execution/shared/types.js";
import type { BudgetConfig } from "../config/budget.js";

const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  monthlyTokenLimit: 500_000,
  perAgentMonthlyLimit: 500_000,
  perTaskTokenLimit: 50_000,
  maxTasksPerDay: 10,
  warningThresholdPercent: 20,
  kairosMaxInputTokens: 800,
  kairosMaxOutputTokens: 400,
  nexusMaxOutputTokens: 600,
};

function buildResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    agent: "nexus",
    task: "Pesquisar opcoes de cache",
    status: "success",
    output: "Research saved (uuid): Recomendacao aqui",
    ...overrides,
  };
}

describe("evaluateNexusExecution", () => {
  it("should return SUCCESS for a normal successful execution", () => {
    const result = buildResult({
      tokensUsed: 1000,
      executionTimeMs: 5000,
    });

    const evaluation = evaluateNexusExecution(result, DEFAULT_BUDGET_CONFIG);

    assert.equal(evaluation.grade, "SUCCESS");
    assert.equal(evaluation.reasons.length, 0);
  });

  it("should return FAILURE for a failed execution", () => {
    const result = buildResult({
      status: "failed",
      error: "LLM timeout",
    });

    const evaluation = evaluateNexusExecution(result, DEFAULT_BUDGET_CONFIG);

    assert.equal(evaluation.grade, "FAILURE");
    assert.ok(evaluation.reasons.includes("LLM timeout"));
  });

  it("should return FAILURE with default reason when error is undefined", () => {
    const result = buildResult({
      status: "failed",
    });

    const evaluation = evaluateNexusExecution(result, DEFAULT_BUDGET_CONFIG);

    assert.equal(evaluation.grade, "FAILURE");
    assert.ok(evaluation.reasons.includes("execution_error"));
  });

  it("should return PARTIAL when token usage is high", () => {
    const result = buildResult({
      tokensUsed: 45_000,
      executionTimeMs: 5000,
    });

    const evaluation = evaluateNexusExecution(result, DEFAULT_BUDGET_CONFIG);

    assert.equal(evaluation.grade, "PARTIAL");
    assert.ok(evaluation.reasons.some((r) => r.includes("high_token_usage")));
  });

  it("should return PARTIAL when execution is slow", () => {
    const result = buildResult({
      tokensUsed: 1000,
      executionTimeMs: 70_000,
    });

    const evaluation = evaluateNexusExecution(result, DEFAULT_BUDGET_CONFIG);

    assert.equal(evaluation.grade, "PARTIAL");
    assert.ok(evaluation.reasons.some((r) => r.includes("slow_execution")));
  });

  it("should return PARTIAL with both reasons when token usage is high and execution is slow", () => {
    const result = buildResult({
      tokensUsed: 45_000,
      executionTimeMs: 70_000,
    });

    const evaluation = evaluateNexusExecution(result, DEFAULT_BUDGET_CONFIG);

    assert.equal(evaluation.grade, "PARTIAL");
    assert.equal(evaluation.reasons.length, 2);
  });

  it("should return SUCCESS when tokensUsed is undefined", () => {
    const result = buildResult({
      executionTimeMs: 5000,
    });

    const evaluation = evaluateNexusExecution(result, DEFAULT_BUDGET_CONFIG);

    assert.equal(evaluation.grade, "SUCCESS");
  });

  it("should return SUCCESS when executionTimeMs is undefined", () => {
    const result = buildResult({
      tokensUsed: 1000,
    });

    const evaluation = evaluateNexusExecution(result, DEFAULT_BUDGET_CONFIG);

    assert.equal(evaluation.grade, "SUCCESS");
  });

  it("should return SUCCESS when token usage is exactly at threshold", () => {
    const result = buildResult({
      tokensUsed: 40_000,
      executionTimeMs: 5000,
    });

    const evaluation = evaluateNexusExecution(result, DEFAULT_BUDGET_CONFIG);

    assert.equal(evaluation.grade, "SUCCESS");
  });
});
