import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { EvaluationGrade } from "../evaluation/forgeEvaluator.js";

export interface FeedbackEntry {
  readonly agentId: string;
  readonly taskType: string;
  readonly grade: EvaluationGrade;
  readonly reasons: readonly string[];
}

export interface FeedbackRecord {
  readonly id: string;
  readonly agent_id: string;
  readonly task_type: string;
  readonly grade: EvaluationGrade;
  readonly reasons: string | null;
  readonly created_at: string;
}

export interface FeedbackSummary {
  readonly totalSuccess: number;
  readonly totalPartial: number;
  readonly totalFailure: number;
  readonly total: number;
  readonly successRate: number;
}

export function saveFeedback(db: BetterSqlite3.Database, entry: FeedbackEntry): void {
  db.prepare(
    "INSERT INTO agent_feedback (id, agent_id, task_type, grade, reasons) VALUES (?, ?, ?, ?, ?)",
  ).run(
    crypto.randomUUID(),
    entry.agentId,
    entry.taskType,
    entry.grade,
    entry.reasons.length > 0 ? JSON.stringify(entry.reasons) : null,
  );
}

export function getRecentFeedback(
  db: BetterSqlite3.Database,
  agentId: string,
  days: number,
): readonly FeedbackRecord[] {
  return db
    .prepare(
      `SELECT id, agent_id, task_type, grade, reasons, created_at
       FROM agent_feedback
       WHERE agent_id = ? AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC`,
    )
    .all(agentId, `-${days} days`) as FeedbackRecord[];
}

export function getFeedbackSummary(
  db: BetterSqlite3.Database,
  agentId: string,
  days: number,
): FeedbackSummary {
  const rows = db
    .prepare(
      `SELECT grade, COUNT(*) as count
       FROM agent_feedback
       WHERE agent_id = ? AND created_at >= datetime('now', ?)
       GROUP BY grade`,
    )
    .all(agentId, `-${days} days`) as ReadonlyArray<{ grade: string; count: number }>;

  let totalSuccess = 0;
  let totalPartial = 0;
  let totalFailure = 0;

  for (const row of rows) {
    if (row.grade === "SUCCESS") totalSuccess = row.count;
    else if (row.grade === "PARTIAL") totalPartial = row.count;
    else if (row.grade === "FAILURE") totalFailure = row.count;
  }

  const total = totalSuccess + totalPartial + totalFailure;
  const successRate = total > 0 ? (totalSuccess / total) * 100 : 0;

  return { totalSuccess, totalPartial, totalFailure, total, successRate };
}

export function getTaskTypeFeedback(
  db: BetterSqlite3.Database,
  agentId: string,
  taskType: string,
  limit: number,
): readonly FeedbackRecord[] {
  return db
    .prepare(
      `SELECT id, agent_id, task_type, grade, reasons, created_at
       FROM agent_feedback
       WHERE agent_id = ? AND task_type = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(agentId, taskType, limit) as FeedbackRecord[];
}

export function normalizeTaskType(task: string): string {
  return task
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(?:^-+)|(?:-+$)/g, "");
}
