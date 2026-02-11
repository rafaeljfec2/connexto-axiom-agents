import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export interface GovernanceRecord {
  readonly id: string;
  readonly cycle_id: string;
  readonly complexity: number;
  readonly risk: number;
  readonly cost: number;
  readonly historical_stability: string;
  readonly selected_model: string;
  readonly model_tier: string;
  readonly nexus_pre_research: number;
  readonly nexus_research_id: string | null;
  readonly human_approval_required: number;
  readonly post_validation_status: string | null;
  readonly post_validation_notes: string | null;
  readonly reasons: string;
  readonly tokens_used: number | null;
  readonly created_at: string;
}

export interface GovernanceLogEntry {
  readonly cycleId: string;
  readonly complexity: number;
  readonly risk: number;
  readonly cost: number;
  readonly historicalStability: string;
  readonly selectedModel: string;
  readonly modelTier: string;
  readonly nexusPreResearch: boolean;
  readonly nexusResearchId?: string;
  readonly humanApprovalRequired: boolean;
  readonly postValidationStatus?: string;
  readonly postValidationNotes?: string;
  readonly reasons: readonly string[];
  readonly tokensUsed?: number;
}

export interface GovernanceStats {
  readonly totalDecisions: number;
  readonly economyCount: number;
  readonly standardCount: number;
  readonly premiumCount: number;
  readonly nexusPreResearchCount: number;
  readonly mismatchCount: number;
  readonly estimatedTokensSaved: number;
}

export function saveGovernanceDecision(
  db: BetterSqlite3.Database,
  entry: GovernanceLogEntry,
): string {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO governance_decisions
       (id, cycle_id, complexity, risk, cost, historical_stability,
        selected_model, model_tier, nexus_pre_research, nexus_research_id,
        human_approval_required, post_validation_status, post_validation_notes,
        reasons, tokens_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.cycleId,
    entry.complexity,
    entry.risk,
    entry.cost,
    entry.historicalStability,
    entry.selectedModel,
    entry.modelTier,
    entry.nexusPreResearch ? 1 : 0,
    entry.nexusResearchId ?? null,
    entry.humanApprovalRequired ? 1 : 0,
    entry.postValidationStatus ?? null,
    entry.postValidationNotes ?? null,
    JSON.stringify(entry.reasons),
    entry.tokensUsed ?? null,
  );

  return id;
}

export function getRecentGovernanceDecisions(
  db: BetterSqlite3.Database,
  limit: number = 10,
): readonly GovernanceRecord[] {
  return db
    .prepare(
      `SELECT id, cycle_id, complexity, risk, cost, historical_stability,
              selected_model, model_tier, nexus_pre_research, nexus_research_id,
              human_approval_required, post_validation_status, post_validation_notes,
              reasons, tokens_used, created_at
       FROM governance_decisions
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as GovernanceRecord[];
}

export function getGovernanceStats(
  db: BetterSqlite3.Database,
  days: number = 7,
): GovernanceStats {
  const rows = db
    .prepare(
      `SELECT model_tier, COUNT(*) as count
       FROM governance_decisions
       WHERE created_at >= datetime('now', ?)
       GROUP BY model_tier`,
    )
    .all(`-${days} days`) as ReadonlyArray<{ model_tier: string; count: number }>;

  let economyCount = 0;
  let standardCount = 0;
  let premiumCount = 0;

  for (const row of rows) {
    if (row.model_tier === "economy") economyCount = row.count;
    else if (row.model_tier === "standard") standardCount = row.count;
    else if (row.model_tier === "premium") premiumCount = row.count;
  }

  const totalDecisions = economyCount + standardCount + premiumCount;

  const nexusRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM governance_decisions
       WHERE nexus_pre_research = 1
         AND created_at >= datetime('now', ?)`,
    )
    .get(`-${days} days`) as { count: number };

  const mismatchRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM governance_decisions
       WHERE post_validation_status IN ('mismatch', 'escalation_needed')
         AND created_at >= datetime('now', ?)`,
    )
    .get(`-${days} days`) as { count: number };

  const tokensRow = db
    .prepare(
      `SELECT SUM(tokens_used) as total FROM governance_decisions
       WHERE created_at >= datetime('now', ?)
         AND tokens_used IS NOT NULL`,
    )
    .get(`-${days} days`) as { total: number | null };

  const actualTokens = tokensRow.total ?? 0;
  const premiumEstimate = totalDecisions * 600;
  const estimatedTokensSaved = Math.max(0, premiumEstimate - actualTokens);

  return {
    totalDecisions,
    economyCount,
    standardCount,
    premiumCount,
    nexusPreResearchCount: nexusRow.count,
    mismatchCount: mismatchRow.count,
    estimatedTokensSaved,
  };
}
