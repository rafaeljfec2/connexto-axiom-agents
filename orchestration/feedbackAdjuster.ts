import type BetterSqlite3 from "better-sqlite3";
import type { BudgetConfig } from "../config/budget.js";
import type { EvaluationGrade } from "../evaluation/forgeEvaluator.js";

export interface MetricsAdjustment {
  readonly impactDelta: number;
  readonly costDelta: number;
  readonly riskDelta: number;
}

const FEEDBACK_WINDOW_DAYS = 7;
const RECURRENT_FAILURE_THRESHOLD = 2;
const CONSISTENT_SUCCESS_THRESHOLD = 3;
const HIGH_TOKEN_COST_RATIO = 0.7;

const NEUTRAL_ADJUSTMENT: MetricsAdjustment = {
  impactDelta: 0,
  costDelta: 0,
  riskDelta: 0,
};

export function computeAdjustment(
  db: BetterSqlite3.Database,
  agentId: string,
  taskType: string,
  budgetConfig: BudgetConfig,
): MetricsAdjustment {
  const recentGrades = queryRecentGrades(db, agentId, taskType);

  if (recentGrades.length === 0) {
    return NEUTRAL_ADJUSTMENT;
  }

  let impactDelta = 0;
  let costDelta = 0;
  let riskDelta = 0;

  const failureCount = recentGrades.filter((g) => g === "FAILURE").length;
  if (failureCount >= RECURRENT_FAILURE_THRESHOLD) {
    impactDelta = -1;
    riskDelta = 1;
  }

  const hasNoFailures = failureCount === 0;
  const successCount = recentGrades.filter((g) => g === "SUCCESS").length;
  if (hasNoFailures && successCount >= CONSISTENT_SUCCESS_THRESHOLD) {
    riskDelta = -1;
  }

  if (isAverageTokenCostHigh(db, agentId, taskType, budgetConfig.perTaskTokenLimit)) {
    costDelta = 1;
  }

  return { impactDelta, costDelta, riskDelta };
}

function queryRecentGrades(
  db: BetterSqlite3.Database,
  agentId: string,
  taskType: string,
): readonly EvaluationGrade[] {
  const rows = db
    .prepare(
      `SELECT grade FROM agent_feedback
       WHERE agent_id = ? AND task_type = ? AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC`,
    )
    .all(agentId, taskType, `-${FEEDBACK_WINDOW_DAYS} days`) as ReadonlyArray<{
    grade: EvaluationGrade;
  }>;

  return rows.map((r) => r.grade);
}

function isAverageTokenCostHigh(
  db: BetterSqlite3.Database,
  agentId: string,
  taskType: string,
  perTaskTokenLimit: number,
): boolean {
  const row = db
    .prepare(
      `SELECT AVG(o.tokens_used) as avg_tokens
       FROM outcomes o
       INNER JOIN agent_feedback af
         ON o.agent_id = af.agent_id
         AND af.task_type = ?
         AND af.created_at >= datetime('now', ?)
       WHERE o.agent_id = ?
         AND o.tokens_used IS NOT NULL
         AND o.created_at >= datetime('now', ?)`,
    )
    .get(taskType, `-${FEEDBACK_WINDOW_DAYS} days`, agentId, `-${FEEDBACK_WINDOW_DAYS} days`) as {
    avg_tokens: number | null;
  };

  if (row.avg_tokens === null) {
    return false;
  }

  return row.avg_tokens > perTaskTokenLimit * HIGH_TOKEN_COST_RATIO;
}
