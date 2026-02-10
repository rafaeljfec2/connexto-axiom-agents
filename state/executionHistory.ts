import type BetterSqlite3 from "better-sqlite3";

const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 10;
const MAX_ERROR_LENGTH = 60;
const MAX_FILES_RETURNED = 5;
const RECURRENT_FAILURE_THRESHOLD = 2;

export interface TaskTypeAggregate {
  readonly taskType: string;
  readonly totalExecutions: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly successRate: number;
  readonly avgRisk: number;
  readonly lastStatus: string;
  readonly recurrentErrors: readonly string[];
}

export interface RecentExecution {
  readonly task: string;
  readonly status: string;
  readonly error: string | null;
  readonly tokensUsed: number | null;
  readonly executionTimeMs: number | null;
  readonly createdAt: string;
}

export interface ExecutionHistorySummary {
  readonly successRate: number;
  readonly totalExecutions: number;
}

export interface ExecutionHistoryContext {
  readonly agentSummary: ExecutionHistorySummary;
  readonly taskAggregates: readonly TaskTypeAggregate[];
  readonly frequentFiles: readonly string[];
  readonly recentExecutions: readonly RecentExecution[];
}

export function getExecutionHistory(
  db: BetterSqlite3.Database,
  agentId: string,
  days: number = DEFAULT_DAYS,
  limit: number = DEFAULT_LIMIT,
): readonly RecentExecution[] {
  const rows = db
    .prepare(
      `SELECT task, status, error, tokens_used, execution_time_ms, created_at
       FROM outcomes
       WHERE agent_id = ? AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(agentId, `-${days} days`, limit) as ReadonlyArray<{
    task: string;
    status: string;
    error: string | null;
    tokens_used: number | null;
    execution_time_ms: number | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    task: row.task,
    status: row.status,
    error: row.error ? truncateText(row.error, MAX_ERROR_LENGTH) : null,
    tokensUsed: row.tokens_used,
    executionTimeMs: row.execution_time_ms,
    createdAt: row.created_at,
  }));
}

export function getAgentSummary(
  db: BetterSqlite3.Database,
  agentId: string,
  days: number = DEFAULT_DAYS,
): ExecutionHistorySummary {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN grade = 'SUCCESS' THEN 1 ELSE 0 END) as success_count
       FROM agent_feedback
       WHERE agent_id = ? AND created_at >= datetime('now', ?)`,
    )
    .get(agentId, `-${days} days`) as { total: number; success_count: number };

  const total = row.total;
  const successRate = total > 0 ? (row.success_count / total) * 100 : 0;

  return { successRate, totalExecutions: total };
}

export function getTaskTypeAggregates(
  db: BetterSqlite3.Database,
  agentId: string,
  days: number = DEFAULT_DAYS,
): readonly TaskTypeAggregate[] {
  const rows = db
    .prepare(
      `SELECT
         task_type,
         COUNT(*) as total,
         SUM(CASE WHEN grade = 'SUCCESS' THEN 1 ELSE 0 END) as success_count,
         SUM(CASE WHEN grade = 'FAILURE' THEN 1 ELSE 0 END) as failure_count
       FROM agent_feedback
       WHERE agent_id = ? AND created_at >= datetime('now', ?)
       GROUP BY task_type
       ORDER BY total DESC`,
    )
    .all(agentId, `-${days} days`) as ReadonlyArray<{
    task_type: string;
    total: number;
    success_count: number;
    failure_count: number;
  }>;

  return rows.map((row) => {
    const lastStatus = getLastStatusForTaskType(db, agentId, row.task_type);
    const avgRisk = getAverageRiskForTaskType(db, row.task_type, days);
    const recurrentErrors = getRecurrentErrorsForTaskType(db, agentId, row.task_type, days);

    return {
      taskType: row.task_type,
      totalExecutions: row.total,
      successCount: row.success_count,
      failureCount: row.failure_count,
      successRate: row.total > 0 ? (row.success_count / row.total) * 100 : 0,
      avgRisk,
      lastStatus,
      recurrentErrors,
    };
  });
}

function getLastStatusForTaskType(
  db: BetterSqlite3.Database,
  agentId: string,
  taskType: string,
): string {
  const row = db
    .prepare(
      `SELECT grade FROM agent_feedback
       WHERE agent_id = ? AND task_type = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(agentId, taskType) as { grade: string } | undefined;

  return row?.grade ?? "UNKNOWN";
}

function getAverageRiskForTaskType(
  db: BetterSqlite3.Database,
  taskType: string,
  days: number,
): number {
  const row = db
    .prepare(
      `SELECT AVG(cc.risk) as avg_risk
       FROM code_changes cc
       WHERE cc.task_id LIKE '%' || ? || '%'
         AND cc.created_at >= datetime('now', ?)`,
    )
    .get(taskType, `-${days} days`) as { avg_risk: number | null };

  return row.avg_risk ?? 0;
}

function getRecurrentErrorsForTaskType(
  db: BetterSqlite3.Database,
  agentId: string,
  taskType: string,
  days: number,
): readonly string[] {
  const rows = db
    .prepare(
      `SELECT reasons FROM agent_feedback
       WHERE agent_id = ? AND task_type = ? AND grade = 'FAILURE'
         AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC
       LIMIT 10`,
    )
    .all(agentId, taskType, `-${days} days`) as ReadonlyArray<{ reasons: string | null }>;

  const errorCounts = new Map<string, number>();

  for (const row of rows) {
    if (!row.reasons) continue;
    try {
      const reasons = JSON.parse(row.reasons) as readonly string[];
      for (const reason of reasons) {
        const normalized = truncateText(reason, MAX_ERROR_LENGTH);
        errorCounts.set(normalized, (errorCounts.get(normalized) ?? 0) + 1);
      }
    } catch {
      const normalized = truncateText(row.reasons, MAX_ERROR_LENGTH);
      errorCounts.set(normalized, (errorCounts.get(normalized) ?? 0) + 1);
    }
  }

  return [...errorCounts.entries()]
    .filter(([, count]) => count >= RECURRENT_FAILURE_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([error]) => error);
}

export function getFrequentFiles(
  db: BetterSqlite3.Database,
  days: number = DEFAULT_DAYS,
  limit: number = MAX_FILES_RETURNED,
): readonly string[] {
  const rows = db
    .prepare(
      `SELECT files_changed FROM code_changes
       WHERE created_at >= datetime('now', ?)
         AND status IN ('applied', 'pending_approval')`,
    )
    .all(`-${days} days`) as ReadonlyArray<{ files_changed: string }>;

  const fileCounts = new Map<string, number>();

  for (const row of rows) {
    try {
      const files = JSON.parse(row.files_changed) as readonly string[];
      for (const file of files) {
        fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
      }
    } catch {
      fileCounts.set(row.files_changed, (fileCounts.get(row.files_changed) ?? 0) + 1);
    }
  }

  return [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([file]) => file);
}

export function getRecurrentFailurePatterns(
  db: BetterSqlite3.Database,
  agentId: string,
  days: number = DEFAULT_DAYS,
): readonly string[] {
  const rows = db
    .prepare(
      `SELECT o.error, COUNT(*) as count
       FROM outcomes o
       WHERE o.agent_id = ? AND o.status = 'failed'
         AND o.error IS NOT NULL
         AND o.created_at >= datetime('now', ?)
       GROUP BY o.error
       HAVING count >= ?
       ORDER BY count DESC
       LIMIT 5`,
    )
    .all(agentId, `-${days} days`, RECURRENT_FAILURE_THRESHOLD) as ReadonlyArray<{
    error: string;
    count: number;
  }>;

  return rows.map((r) => `${truncateText(r.error, MAX_ERROR_LENGTH)} (${r.count}x)`);
}

export function getFullExecutionHistoryContext(
  db: BetterSqlite3.Database,
  agentId: string,
  days: number = DEFAULT_DAYS,
): ExecutionHistoryContext {
  return {
    agentSummary: getAgentSummary(db, agentId, days),
    taskAggregates: getTaskTypeAggregates(db, agentId, days),
    frequentFiles: getFrequentFiles(db, days),
    recentExecutions: getExecutionHistory(db, agentId, days),
  };
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}
