import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { ExecutionResult } from "../execution/types.js";

export interface Outcome {
  readonly id: string;
  readonly agent_id: string;
  readonly task: string;
  readonly status: string;
  readonly output: string | null;
  readonly error: string | null;
  readonly created_at: string;
}

export function saveOutcome(db: BetterSqlite3.Database, result: ExecutionResult): void {
  db.prepare(
    "INSERT INTO outcomes (id, agent_id, task, status, output, error) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    crypto.randomUUID(),
    result.agent,
    result.task,
    result.status,
    result.output ?? null,
    result.error ?? null,
  );
}

export function loadRecentOutcomes(db: BetterSqlite3.Database, limit: number): readonly Outcome[] {
  return db
    .prepare(
      "SELECT id, agent_id, task, status, output, error, created_at FROM outcomes ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit) as Outcome[];
}
