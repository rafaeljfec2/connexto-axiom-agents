import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export interface TokenUsageEntry {
  readonly agentId: string;
  readonly taskId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export function recordTokenUsage(db: BetterSqlite3.Database, entry: TokenUsageEntry): void {
  db.prepare(
    "INSERT INTO token_usage (id, agent_id, task_id, input_tokens, output_tokens, total_tokens) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    crypto.randomUUID(),
    entry.agentId,
    entry.taskId,
    entry.inputTokens,
    entry.outputTokens,
    entry.totalTokens,
  );
}

export function getAgentUsageToday(db: BetterSqlite3.Database, agentId: string): number {
  const today = new Date().toISOString().slice(0, 10);

  const row = db
    .prepare(
      "SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE agent_id = ? AND created_at >= ?",
    )
    .get(agentId, `${today}T00:00:00.000Z`) as { total: number };

  return row.total;
}

export function getAgentUsageMonth(db: BetterSqlite3.Database, agentId: string): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const monthStart = `${year}-${month}-01T00:00:00.000Z`;

  const row = db
    .prepare(
      "SELECT COALESCE(SUM(total_tokens), 0) AS total FROM token_usage WHERE agent_id = ? AND created_at >= ?",
    )
    .get(agentId, monthStart) as { total: number };

  return row.total;
}

export function getTaskCountToday(db: BetterSqlite3.Database, agentId: string): number {
  const today = new Date().toISOString().slice(0, 10);

  const row = db
    .prepare("SELECT COUNT(*) AS count FROM token_usage WHERE agent_id = ? AND created_at >= ?")
    .get(agentId, `${today}T00:00:00.000Z`) as { count: number };

  return row.count;
}
