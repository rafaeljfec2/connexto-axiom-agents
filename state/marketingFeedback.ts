import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { MarketingGrade } from "../evaluation/marketingEvaluator.js";

export interface MarketingFeedbackEntry {
  readonly artifactId: string;
  readonly messageType: string;
  readonly grade: MarketingGrade;
  readonly engagementScore: number;
}

export interface MarketingFeedbackRecord {
  readonly id: string;
  readonly artifact_id: string;
  readonly message_type: string;
  readonly grade: MarketingGrade;
  readonly engagement_score: number;
  readonly created_at: string;
}

export interface MarketingPerformanceSummary {
  readonly messageType: string;
  readonly strongCount: number;
  readonly averageCount: number;
  readonly weakCount: number;
  readonly total: number;
  readonly avgEngagement: number;
}

const COLUMNS = `id, artifact_id, message_type, grade, engagement_score, created_at`;

export function saveMarketingFeedback(
  db: BetterSqlite3.Database,
  entry: MarketingFeedbackEntry,
): string {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO marketing_feedback (id, artifact_id, message_type, grade, engagement_score)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, entry.artifactId, entry.messageType, entry.grade, entry.engagementScore);

  return id;
}

export function getRecentMarketingFeedback(
  db: BetterSqlite3.Database,
  days: number,
): readonly MarketingFeedbackRecord[] {
  return db
    .prepare(
      `SELECT ${COLUMNS}
       FROM marketing_feedback
       WHERE created_at >= datetime('now', ?)
       ORDER BY created_at DESC`,
    )
    .all(`-${days} days`) as MarketingFeedbackRecord[];
}

export function getMarketingFeedbackByType(
  db: BetterSqlite3.Database,
  messageType: string,
  days: number,
): readonly MarketingFeedbackRecord[] {
  return db
    .prepare(
      `SELECT ${COLUMNS}
       FROM marketing_feedback
       WHERE message_type = ? AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC`,
    )
    .all(messageType, `-${days} days`) as MarketingFeedbackRecord[];
}

export function getMarketingPerformanceSummary(
  db: BetterSqlite3.Database,
  days: number,
): readonly MarketingPerformanceSummary[] {
  const rows = db
    .prepare(
      `SELECT
         message_type,
         SUM(CASE WHEN grade = 'STRONG' THEN 1 ELSE 0 END) as strong_count,
         SUM(CASE WHEN grade = 'AVERAGE' THEN 1 ELSE 0 END) as average_count,
         SUM(CASE WHEN grade = 'WEAK' THEN 1 ELSE 0 END) as weak_count,
         COUNT(*) as total,
         AVG(engagement_score) as avg_engagement
       FROM marketing_feedback
       WHERE created_at >= datetime('now', ?)
       GROUP BY message_type
       ORDER BY total DESC`,
    )
    .all(`-${days} days`) as ReadonlyArray<{
    message_type: string;
    strong_count: number;
    average_count: number;
    weak_count: number;
    total: number;
    avg_engagement: number;
  }>;

  return rows.map((r) => ({
    messageType: r.message_type,
    strongCount: r.strong_count,
    averageCount: r.average_count,
    weakCount: r.weak_count,
    total: r.total,
    avgEngagement: r.avg_engagement,
  }));
}

export function getAverageEngagement7d(db: BetterSqlite3.Database): number {
  const row = db
    .prepare(
      `SELECT AVG(engagement_score) as avg_score
       FROM marketing_feedback
       WHERE created_at >= datetime('now', '-7 days')`,
    )
    .get() as { avg_score: number | null };

  return row.avg_score ?? 0;
}
