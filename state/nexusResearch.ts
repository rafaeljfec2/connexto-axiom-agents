import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export interface NexusResearchEntry {
  readonly goalId: string;
  readonly question: string;
  readonly options: string;
  readonly prosCons: string;
  readonly riskAnalysis: string;
  readonly recommendation: string;
  readonly rawOutput: string;
  readonly tokensUsed?: number;
}

export interface NexusResearch {
  readonly id: string;
  readonly goal_id: string;
  readonly question: string;
  readonly options: string;
  readonly pros_cons: string;
  readonly risk_analysis: string;
  readonly recommendation: string;
  readonly raw_output: string;
  readonly tokens_used: number | null;
  readonly created_at: string;
}

const COLUMNS = `id, goal_id, question, options, pros_cons, risk_analysis, recommendation, raw_output, tokens_used, created_at`;

export function saveResearch(db: BetterSqlite3.Database, entry: NexusResearchEntry): string {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO nexus_research (id, goal_id, question, options, pros_cons, risk_analysis, recommendation, raw_output, tokens_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.goalId,
    entry.question,
    entry.options,
    entry.prosCons,
    entry.riskAnalysis,
    entry.recommendation,
    entry.rawOutput,
    entry.tokensUsed ?? null,
  );

  return id;
}

export function getRecentResearch(
  db: BetterSqlite3.Database,
  days: number,
): readonly NexusResearch[] {
  return db
    .prepare(
      `SELECT ${COLUMNS}
       FROM nexus_research
       WHERE created_at >= datetime('now', ?)
       ORDER BY created_at DESC`,
    )
    .all(`-${days} days`) as NexusResearch[];
}

export function getResearchByGoalId(
  db: BetterSqlite3.Database,
  goalId: string,
): readonly NexusResearch[] {
  return db
    .prepare(
      `SELECT ${COLUMNS}
       FROM nexus_research
       WHERE goal_id = ?
       ORDER BY created_at DESC`,
    )
    .all(goalId) as NexusResearch[];
}

export function getResearchStats7d(db: BetterSqlite3.Database): {
  readonly researchCount: number;
  readonly recentTopics: readonly string[];
  readonly identifiedRisks: readonly string[];
} {
  const countResult = db
    .prepare(
      `SELECT COUNT(*) as count FROM nexus_research
       WHERE created_at >= datetime('now', '-7 days')`,
    )
    .get() as { count: number };

  const topicsResult = db
    .prepare(
      `SELECT question FROM nexus_research
       WHERE created_at >= datetime('now', '-7 days')
       ORDER BY created_at DESC
       LIMIT 10`,
    )
    .all() as ReadonlyArray<{ question: string }>;

  const risksResult = db
    .prepare(
      `SELECT risk_analysis FROM nexus_research
       WHERE created_at >= datetime('now', '-7 days')
       ORDER BY created_at DESC
       LIMIT 10`,
    )
    .all() as ReadonlyArray<{ risk_analysis: string }>;

  const recentTopics = topicsResult.map((r) => truncateTopic(r.question));
  const identifiedRisks = extractHighRisks(risksResult.map((r) => r.risk_analysis));

  return {
    researchCount: countResult.count,
    recentTopics,
    identifiedRisks,
  };
}

function truncateTopic(question: string): string {
  const maxLength = 80;
  if (question.length <= maxLength) return question;
  return `${question.slice(0, maxLength)}...`;
}

function extractHighRisks(riskAnalyses: readonly string[]): readonly string[] {
  const risks: string[] = [];

  for (const analysis of riskAnalyses) {
    const lines = analysis.split("\n");
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.includes("alto") || trimmed.includes("medio")) {
        risks.push(line.trim());
      }
    }
  }

  return risks.slice(0, 5);
}
