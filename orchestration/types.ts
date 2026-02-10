export interface KairosDecision {
  readonly goal_id: string;
  readonly action: string;
  readonly reasoning: string;
}

export interface DecisionMetrics {
  readonly impact: number;
  readonly cost: number;
  readonly risk: number;
  readonly confidence: number;
}

export interface KairosDelegation {
  readonly agent: string;
  readonly task: string;
  readonly goal_id: string;
  readonly expected_output: string;
  readonly deadline: string;
  readonly decision_metrics: DecisionMetrics;
}

export interface KairosOutput {
  readonly briefing: string;
  readonly decisions_needed: readonly KairosDecision[];
  readonly delegations: readonly KairosDelegation[];
  readonly tasks_killed: readonly string[];
  readonly next_24h_focus: string;
}

export interface RejectedDelegation {
  readonly delegation: KairosDelegation;
  readonly reason: string;
}

export interface FilteredDelegations {
  readonly approved: readonly KairosDelegation[];
  readonly needsApproval: readonly KairosDelegation[];
  readonly rejected: readonly RejectedDelegation[];
}

export interface BlockedTask {
  readonly task: string;
  readonly reason: string;
}

export interface BudgetInfo {
  readonly usedTokens: number;
  readonly totalTokens: number;
  readonly percentRemaining: number;
  readonly isExhausted: boolean;
  readonly blockedTasks: readonly BlockedTask[];
}
