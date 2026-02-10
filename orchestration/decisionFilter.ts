import type BetterSqlite3 from "better-sqlite3";
import type { BudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { normalizeTaskType } from "../state/agentFeedback.js";
import { computeAdjustment } from "./feedbackAdjuster.js";
import { computeMarketingAdjustment } from "./marketingFeedbackAdjuster.js";
import type { KairosDelegation, FilteredDelegations, RejectedDelegation } from "./types.js";

const MAX_APPROVED_PER_CYCLE = 3;

export interface FilterResult {
  readonly delegations: FilteredDelegations;
  readonly adjustmentsApplied: number;
}

export function filterDelegations(
  delegations: readonly KairosDelegation[],
  db: BetterSqlite3.Database,
  budgetConfig: BudgetConfig,
): FilterResult {
  const rejected: RejectedDelegation[] = [];
  const needsApproval: KairosDelegation[] = [];
  const candidates: KairosDelegation[] = [];
  let adjustmentsApplied = 0;

  for (const delegation of delegations) {
    const adjusted = applyFeedbackAdjustment(delegation, db, budgetConfig);
    if (adjusted.wasAdjusted) {
      adjustmentsApplied++;
    }

    const { impact, cost, risk } = adjusted.metrics;

    if (impact <= 2 && cost >= impact) {
      rejected.push({ delegation, reason: "Low impact, high relative cost" });
      continue;
    }

    if (risk >= 4 || cost >= 4) {
      needsApproval.push(delegation);
      continue;
    }

    candidates.push(delegation);
  }

  const sorted = [...candidates].sort((a, b) => {
    const impactDiff = b.decision_metrics.impact - a.decision_metrics.impact;
    if (impactDiff !== 0) return impactDiff;
    return a.decision_metrics.cost - b.decision_metrics.cost;
  });

  const approved = sorted.slice(0, MAX_APPROVED_PER_CYCLE);
  const overflow = sorted.slice(MAX_APPROVED_PER_CYCLE);

  for (const delegation of overflow) {
    rejected.push({ delegation, reason: "Exceeded max delegations per cycle" });
  }

  return {
    delegations: { approved, needsApproval, rejected },
    adjustmentsApplied,
  };
}

interface AdjustedMetrics {
  readonly metrics: { readonly impact: number; readonly cost: number; readonly risk: number };
  readonly wasAdjusted: boolean;
}

function applyFeedbackAdjustment(
  delegation: KairosDelegation,
  db: BetterSqlite3.Database,
  budgetConfig: BudgetConfig,
): AdjustedMetrics {
  const taskType = normalizeTaskType(delegation.task);
  const executionAdj = computeAdjustment(db, delegation.agent, taskType, budgetConfig);

  let totalImpactDelta = executionAdj.impactDelta;
  let totalCostDelta = executionAdj.costDelta;
  let totalRiskDelta = executionAdj.riskDelta;

  if (delegation.agent === "vector") {
    const marketingAdj = computeMarketingAdjustment(db, taskType);
    totalImpactDelta += marketingAdj.impactDelta;
    totalCostDelta += marketingAdj.costDelta;
    totalRiskDelta += marketingAdj.riskDelta;
  }

  const wasAdjusted = totalImpactDelta !== 0 || totalCostDelta !== 0 || totalRiskDelta !== 0;

  if (wasAdjusted) {
    logger.info(
      { agent: delegation.agent, taskType, totalImpactDelta, totalCostDelta, totalRiskDelta },
      "Feedback adjustment applied to delegation",
    );
  }

  const impact = clamp(delegation.decision_metrics.impact + totalImpactDelta, 1, 5);
  const cost = clamp(delegation.decision_metrics.cost + totalCostDelta, 1, 5);
  const risk = clamp(delegation.decision_metrics.risk + totalRiskDelta, 1, 5);

  return { metrics: { impact, cost, risk }, wasAdjusted };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
