import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { KairosOutput } from "../orchestration/types.js";

export interface RecentDecision {
  readonly id: string;
  readonly agent_id: string;
  readonly action: string;
  readonly reasoning: string | null;
  readonly created_at: string;
}

export function saveDecision(db: BetterSqlite3.Database, output: KairosOutput): void {
  db.prepare(
    "INSERT INTO decisions (id, task_id, agent_id, action, reasoning) VALUES (?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), null, "kairos", JSON.stringify(output), output.briefing);
}

export function loadRecentDecisions(
  db: BetterSqlite3.Database,
  limit: number,
): readonly RecentDecision[] {
  return db
    .prepare(
      "SELECT id, agent_id, action, reasoning, created_at FROM decisions ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit) as RecentDecision[];
}
