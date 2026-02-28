import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../config/budget.js";
import type { ExecutionResult } from "../execution/shared/types.js";
import type { LLMUsage } from "../llm/client.js";
import { getFeedbackSummary } from "../state/agentFeedback.js";
import { getPendingArtifacts, getApprovedArtifacts } from "../state/artifacts.js";
import {
  getAverageEngagement7d,
  getMarketingPerformanceSummary,
} from "../state/marketingFeedback.js";
import { getCodeChangeStats7d, getBranchStats7d } from "../state/codeChanges.js";
import { getResearchStats7d } from "../state/nexusResearch.js";
import { getPRStats7d } from "../state/pullRequests.js";
import { getPublicationCount7d } from "../state/publications.js";
import { getCurrentBudget } from "../state/budgets.js";
import { getAverageTokensPerDecision7d } from "../state/efficiencyMetrics.js";
import {
  getAgentSummary,
  getRecurrentFailurePatterns,
  getFrequentFiles,
} from "../state/executionHistory.js";
import type {
  KairosOutput,
  BlockedTask,
  BudgetInfo,
  EfficiencyInfo,
  FeedbackInfo,
  VectorInfo,
  ForgeCodeInfo,
  NexusInfo,
  HistoricalPatternInfo,
} from "./types.js";

export function buildBudgetInfo(
  db: BetterSqlite3.Database,
  blockedTasks: readonly BlockedTask[],
): BudgetInfo {
  const budget = getCurrentBudget(db);
  const config = loadBudgetConfig();

  const usedTokens = budget?.used_tokens ?? 0;
  const totalTokens = budget?.total_tokens ?? config.monthlyTokenLimit;
  const percentRemaining = totalTokens > 0 ? ((totalTokens - usedTokens) / totalTokens) * 100 : 0;
  const isExhausted = budget ? budget.hard_limit === 1 && usedTokens >= totalTokens : false;

  return {
    usedTokens,
    totalTokens,
    percentRemaining: Math.max(0, percentRemaining),
    isExhausted,
    blockedTasks,
  };
}

export function buildEfficiencyInfo(
  db: BetterSqlite3.Database,
  usage: LLMUsage | null,
  output: KairosOutput,
): EfficiencyInfo {
  const cycleInputTokens = usage?.inputTokens ?? 0;
  const cycleOutputTokens = usage?.outputTokens ?? 0;
  const cycleTotalTokens = usage?.totalTokens ?? 0;

  const decisionCount = output.delegations.length + output.decisions_needed.length;
  const tokensPerDecision = decisionCount > 0 ? Math.round(cycleTotalTokens / decisionCount) : 0;

  const avg7dTokensPerDecision = getAverageTokensPerDecision7d(db, "kairos");

  return {
    cycleInputTokens,
    cycleOutputTokens,
    cycleTotalTokens,
    tokensPerDecision,
    avg7dTokensPerDecision,
  };
}

export function buildFeedbackInfo(db: BetterSqlite3.Database, adjustmentsApplied: number): FeedbackInfo {
  const forgeSummary = getFeedbackSummary(db, "forge", 7);
  const vectorSummary = getFeedbackSummary(db, "vector", 7);
  const nexusSummary = getFeedbackSummary(db, "nexus", 7);

  const problematicTasks = findProblematicTasks(db);

  return {
    forgeSuccessRate7d: forgeSummary.successRate,
    forgeTotalExecutions7d: forgeSummary.total,
    vectorSuccessRate7d: vectorSummary.successRate,
    vectorTotalExecutions7d: vectorSummary.total,
    nexusSuccessRate7d: nexusSummary.successRate,
    nexusTotalExecutions7d: nexusSummary.total,
    problematicTasks,
    adjustmentsApplied,
  };
}

function findProblematicTasks(db: BetterSqlite3.Database): readonly string[] {
  const rows = db
    .prepare(
      `SELECT agent_id, task_type, COUNT(*) as failure_count
       FROM agent_feedback
       WHERE grade = 'FAILURE'
         AND created_at >= datetime('now', '-7 days')
       GROUP BY agent_id, task_type
       HAVING failure_count >= 2
       ORDER BY failure_count DESC`,
    )
    .all() as ReadonlyArray<{ agent_id: string; task_type: string; failure_count: number }>;

  return rows.map((r) => `${r.agent_id}/${r.task_type} (${r.failure_count} falhas)`);
}

export function buildVectorInfo(
  db: BetterSqlite3.Database,
  vectorResults: readonly ExecutionResult[],
): VectorInfo {
  const pendingDrafts = getPendingArtifacts(db, "vector");
  const approvedDrafts = getApprovedArtifacts(db, "vector");
  const publishedCount7d = getPublicationCount7d(db);
  const avgEngagement7d = getAverageEngagement7d(db);

  const performanceSummary = getMarketingPerformanceSummary(db, 7);
  const strongMessageTypes = performanceSummary
    .filter((s) => s.strongCount > s.weakCount)
    .map((s) => s.messageType);
  const weakMessageTypes = performanceSummary
    .filter((s) => s.weakCount > s.strongCount)
    .map((s) => s.messageType);

  return {
    executionResults: vectorResults,
    pendingDraftsCount: pendingDrafts.length,
    approvedDraftsCount: approvedDrafts.length,
    publishedCount7d,
    avgEngagement7d,
    strongMessageTypes,
    weakMessageTypes,
  };
}

export function buildForgeCodeInfo(db: BetterSqlite3.Database): ForgeCodeInfo {
  const stats = getCodeChangeStats7d(db);
  const branchStats = getBranchStats7d(db);
  const prStats = getPRStats7d(db);

  return {
    appliedCount7d: stats.appliedCount,
    pendingApprovalCount: stats.pendingApprovalCount,
    failedCount7d: stats.failedCount,
    totalRisk7d: stats.totalRisk,
    activeBranches: branchStats.activeBranches,
    totalCommits7d: branchStats.totalCommits7d,
    pendingReviewBranches: branchStats.pendingReviewBranches,
    openPRs: prStats.openCount,
    pendingApprovalPRs: prStats.pendingApprovalCount,
    closedPRs7d: prStats.closedCount7d,
    mergedPRs7d: prStats.mergedCount7d,
    readyForMergePRs: prStats.readyForMergeCount,
    stalePRs: prStats.stalePRCount,
  };
}

export function buildNexusInfo(
  db: BetterSqlite3.Database,
  nexusResults: readonly ExecutionResult[],
): NexusInfo {
  const stats = getResearchStats7d(db);

  return {
    executionResults: nexusResults,
    researchCount7d: stats.researchCount,
    recentTopics: stats.recentTopics,
    identifiedRisks: stats.identifiedRisks,
  };
}

export function buildHistoricalInfo(db: BetterSqlite3.Database): HistoricalPatternInfo {
  const summary = getAgentSummary(db, "forge", 7);
  const persistentFailures = getRecurrentFailurePatterns(db, "forge", 7);
  const frequentFiles = getFrequentFiles(db, 7, 5);

  return {
    forgeSuccessRate7d: summary.successRate,
    forgeTotalExecutions7d: summary.totalExecutions,
    persistentFailures,
    frequentFiles,
    historicalContextUsed: summary.totalExecutions > 0,
  };
}
