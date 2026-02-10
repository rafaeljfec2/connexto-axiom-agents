import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export type MetricsSource = "stub" | "manual" | "api";

export interface MarketingMetricsEntry {
  readonly artifactId: string;
  readonly channel: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly engagementScore: number;
  readonly source: MetricsSource;
}

export interface MarketingMetrics {
  readonly id: string;
  readonly artifact_id: string;
  readonly channel: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly engagement_score: number;
  readonly source: MetricsSource;
  readonly collected_at: string;
}

const COLUMNS = `id, artifact_id, channel, impressions, clicks, engagement_score, source, collected_at`;

export function saveMarketingMetrics(
  db: BetterSqlite3.Database,
  entry: MarketingMetricsEntry,
): string {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO marketing_metrics (id, artifact_id, channel, impressions, clicks, engagement_score, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.artifactId,
    entry.channel,
    entry.impressions,
    entry.clicks,
    entry.engagementScore,
    entry.source,
  );

  return id;
}

export function getMetricsByArtifact(
  db: BetterSqlite3.Database,
  artifactId: string,
): readonly MarketingMetrics[] {
  return db
    .prepare(
      `SELECT ${COLUMNS}
       FROM marketing_metrics
       WHERE artifact_id = ?
       ORDER BY collected_at DESC`,
    )
    .all(artifactId) as MarketingMetrics[];
}

export function getLatestMetrics(
  db: BetterSqlite3.Database,
  artifactId: string,
): MarketingMetrics | undefined {
  return db
    .prepare(
      `SELECT ${COLUMNS}
       FROM marketing_metrics
       WHERE artifact_id = ?
       ORDER BY collected_at DESC
       LIMIT 1`,
    )
    .get(artifactId) as MarketingMetrics | undefined;
}
