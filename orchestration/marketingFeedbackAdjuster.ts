import type BetterSqlite3 from "better-sqlite3";
import type { MarketingGrade } from "../evaluation/marketingEvaluator.js";
import type { MetricsAdjustment } from "./feedbackAdjuster.js";

const FEEDBACK_WINDOW_DAYS = 7;
const MIN_SAMPLES_FOR_ADJUSTMENT = 2;

const NEUTRAL_ADJUSTMENT: MetricsAdjustment = {
  impactDelta: 0,
  costDelta: 0,
  riskDelta: 0,
};

export function computeMarketingAdjustment(
  db: BetterSqlite3.Database,
  messageType: string,
): MetricsAdjustment {
  const recentGrades = queryRecentMarketingGrades(db, messageType);

  if (recentGrades.length < MIN_SAMPLES_FOR_ADJUSTMENT) {
    return NEUTRAL_ADJUSTMENT;
  }

  const strongCount = recentGrades.filter((g) => g === "STRONG").length;
  const weakCount = recentGrades.filter((g) => g === "WEAK").length;
  const total = recentGrades.length;

  const strongRatio = strongCount / total;
  const weakRatio = weakCount / total;

  if (strongRatio > 0.5) {
    return { impactDelta: 1, costDelta: 0, riskDelta: 0 };
  }

  if (weakRatio > 0.5) {
    return { impactDelta: -1, costDelta: 0, riskDelta: 1 };
  }

  return NEUTRAL_ADJUSTMENT;
}

function queryRecentMarketingGrades(
  db: BetterSqlite3.Database,
  messageType: string,
): readonly MarketingGrade[] {
  const rows = db
    .prepare(
      `SELECT grade FROM marketing_feedback
       WHERE message_type = ? AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC`,
    )
    .all(messageType, `-${FEEDBACK_WINDOW_DAYS} days`) as ReadonlyArray<{
    grade: MarketingGrade;
  }>;

  return rows.map((r) => r.grade);
}
