import type { ExecutionResult } from "../execution/types.js";

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

export interface EfficiencyInfo {
  readonly cycleInputTokens: number;
  readonly cycleOutputTokens: number;
  readonly cycleTotalTokens: number;
  readonly tokensPerDecision: number;
  readonly avg7dTokensPerDecision: number;
}

export interface FeedbackInfo {
  readonly forgeSuccessRate7d: number;
  readonly forgeTotalExecutions7d: number;
  readonly vectorSuccessRate7d: number;
  readonly vectorTotalExecutions7d: number;
  readonly nexusSuccessRate7d: number;
  readonly nexusTotalExecutions7d: number;
  readonly problematicTasks: readonly string[];
  readonly adjustmentsApplied: number;
}

export interface VectorInfo {
  readonly executionResults: readonly ExecutionResult[];
  readonly pendingDraftsCount: number;
  readonly approvedDraftsCount: number;
  readonly publishedCount7d: number;
  readonly avgEngagement7d: number;
  readonly strongMessageTypes: readonly string[];
  readonly weakMessageTypes: readonly string[];
}

export interface ForgeCodeInfo {
  readonly appliedCount7d: number;
  readonly pendingApprovalCount: number;
  readonly failedCount7d: number;
  readonly totalRisk7d: number;
  readonly activeBranches: number;
  readonly totalCommits7d: number;
  readonly pendingReviewBranches: number;
  readonly openPRs: number;
  readonly pendingApprovalPRs: number;
  readonly closedPRs7d: number;
  readonly mergedPRs7d: number;
  readonly readyForMergePRs: number;
  readonly stalePRs: number;
}

export interface NexusInfo {
  readonly executionResults: readonly ExecutionResult[];
  readonly researchCount7d: number;
  readonly recentTopics: readonly string[];
  readonly identifiedRisks: readonly string[];
}

export interface HistoricalPatternInfo {
  readonly forgeSuccessRate7d: number;
  readonly forgeTotalExecutions7d: number;
  readonly persistentFailures: readonly string[];
  readonly frequentFiles: readonly string[];
  readonly historicalContextUsed: boolean;
}

export interface GovernanceInfo {
  readonly selectedModel: string;
  readonly modelTier: string;
  readonly complexity: number;
  readonly risk: number;
  readonly cost: number;
  readonly historicalStability: string;
  readonly nexusPreResearchTriggered: boolean;
  readonly postValidationStatus: string;
  readonly postValidationNotes: string;
  readonly reasons: readonly string[];
}
