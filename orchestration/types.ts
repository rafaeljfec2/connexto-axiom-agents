export interface KairosDecision {
  readonly goal_id: string;
  readonly action: string;
  readonly reasoning: string;
}

export interface KairosDelegation {
  readonly agent: string;
  readonly task: string;
  readonly goal_id: string;
}

export interface KairosOutput {
  readonly briefing: string;
  readonly decisions_needed: readonly KairosDecision[];
  readonly delegations: readonly KairosDelegation[];
  readonly tasks_killed: readonly string[];
  readonly next_24h_focus: string;
}
