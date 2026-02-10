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
