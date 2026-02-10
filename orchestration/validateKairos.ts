import type { KairosOutput } from "./types.js";

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

  return output as KairosOutput;
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
  }
}

function validateTasksKilled(items: unknown[]): void {
  for (let i = 0; i < items.length; i++) {
    if (typeof items[i] !== "string") {
      throw new TypeError(`tasks_killed[${i}] must be a string, got: ${typeof items[i]}`);
    }
  }
}
