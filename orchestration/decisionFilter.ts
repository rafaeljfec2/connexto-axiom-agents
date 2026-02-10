import type { KairosDelegation, FilteredDelegations, RejectedDelegation } from "./types.js";

const MAX_APPROVED_PER_CYCLE = 3;

export function filterDelegations(delegations: readonly KairosDelegation[]): FilteredDelegations {
  const rejected: RejectedDelegation[] = [];
  const needsApproval: KairosDelegation[] = [];
  const candidates: KairosDelegation[] = [];

  for (const delegation of delegations) {
    const { impact, cost, risk } = delegation.decision_metrics;

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

  return { approved, needsApproval, rejected };
}
