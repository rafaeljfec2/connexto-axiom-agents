import type BetterSqlite3 from "better-sqlite3";

export function getAverageTokensPerDecision7d(db: BetterSqlite3.Database, agentId: string): number {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString();

  const row = db
    .prepare(
      "SELECT COALESCE(AVG(total_tokens), 0) AS avg_tokens FROM token_usage WHERE agent_id = ? AND created_at >= ?",
    )
    .get(agentId, cutoff) as { avg_tokens: number };

  return Math.round(row.avg_tokens);
}
