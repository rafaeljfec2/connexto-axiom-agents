import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { KairosOutput } from "../orchestration/types.js";

export function saveDecision(db: BetterSqlite3.Database, output: KairosOutput): void {
  db.prepare(
    "INSERT INTO decisions (id, task_id, agent_id, action, reasoning) VALUES (?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), null, "kairos", JSON.stringify(output), output.briefing);
}
