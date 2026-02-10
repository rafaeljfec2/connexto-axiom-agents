import { logger } from "../config/logger.js";
import type { KairosOutput } from "./types.js";

const MAX_BRIEFING_LENGTH = 200;
const MAX_FOCUS_LENGTH = 120;
const MAX_TASK_LENGTH = 120;
const MAX_EXPECTED_OUTPUT_LENGTH = 120;

export function validateKairosOutput(output: unknown): KairosOutput {
  if (output === null || typeof output !== "object") {
    throw new TypeError("Kairos output must be a non-null object");
  }

  const record = output as Record<string, unknown>;

  assertNonEmptyString(record, "briefing");
  assertNonEmptyString(record, "next_24h_focus");
  assertArray(record, "decisions_needed");
  assertArray(record, "delegations");
  assertArray(record, "tasks_killed");

  validateDecisionsNeeded(record["decisions_needed"] as unknown[]);
  validateDelegations(record["delegations"] as unknown[]);
  validateTasksKilled(record["tasks_killed"] as unknown[]);

  truncateFields(record);

  return output as KairosOutput;
}

function truncateFields(record: Record<string, unknown>): void {
  truncateStringField(record, "briefing", MAX_BRIEFING_LENGTH);
  truncateStringField(record, "next_24h_focus", MAX_FOCUS_LENGTH);

  const delegations = record["delegations"] as Array<Record<string, unknown>>;
  for (const delegation of delegations) {
    truncateStringField(delegation, "task", MAX_TASK_LENGTH);
    truncateStringField(delegation, "expected_output", MAX_EXPECTED_OUTPUT_LENGTH);
  }
}

function truncateStringField(
  record: Record<string, unknown>,
  field: string,
  maxLength: number,
): void {
  const value = record[field];
  if (typeof value === "string" && value.length > maxLength) {
    logger.warn({ field, originalLength: value.length, maxLength }, "Truncating LLM output field");
    record[field] = value.slice(0, maxLength);
  }
}

function assertNonEmptyString(record: Record<string, unknown>, field: string): void {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(
      `Kairos output "${field}" must be a non-empty string, got: ${typeof value}`,
    );
  }
}

function assertArray(record: Record<string, unknown>, field: string): void {
  if (!Array.isArray(record[field])) {
    throw new TypeError(`Kairos output "${field}" must be an array, got: ${typeof record[field]}`);
  }
}

function assertStringField(item: Record<string, unknown>, field: string, context: string): void {
  const value = item[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${context} "${field}" must be a non-empty string`);
  }
}

function validateDecisionsNeeded(items: unknown[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === null || typeof item !== "object") {
      throw new TypeError(`decisions_needed[${i}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const ctx = `decisions_needed[${i}]`;
    assertStringField(record, "goal_id", ctx);
    assertStringField(record, "action", ctx);
    assertStringField(record, "reasoning", ctx);
  }
}

function validateDelegations(items: unknown[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === null || typeof item !== "object") {
      throw new TypeError(`delegations[${i}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const ctx = `delegations[${i}]`;
    assertStringField(record, "agent", ctx);
    assertStringField(record, "task", ctx);
    assertStringField(record, "goal_id", ctx);
    assertStringField(record, "expected_output", ctx);
    assertStringField(record, "deadline", ctx);
    validateDecisionMetrics(record["decision_metrics"], ctx);
  }
}

function validateDecisionMetrics(metrics: unknown, context: string): void {
  if (metrics === null || typeof metrics !== "object") {
    throw new TypeError(`${context} "decision_metrics" must be an object`);
  }

  const record = metrics as Record<string, unknown>;
  const fields = ["impact", "cost", "risk", "confidence"] as const;

  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
      throw new TypeError(
        `${context} decision_metrics.${field} must be an integer between 1 and 5, got: ${String(value)}`,
      );
    }
  }
}

function validateTasksKilled(items: unknown[]): void {
  for (let i = 0; i < items.length; i++) {
    if (typeof items[i] !== "string") {
      throw new TypeError(`tasks_killed[${i}] must be a string, got: ${typeof items[i]}`);
    }
  }
}
