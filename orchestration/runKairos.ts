import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { evaluateExecution } from "../evaluation/forgeEvaluator.js";
import { evaluateNexusExecution } from "../evaluation/nexusEvaluator.js";
import { checkBudget } from "../execution/budgetGate.js";
import { executeForge } from "../execution/forgeExecutor.js";
import { executeNexus } from "../execution/nexusExecutor.js";
import type { ExecutionResult } from "../execution/types.js";
import { executeVector } from "../execution/vectorExecutor.js";
import type { LLMUsage } from "../llm/client.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import { saveFeedback, normalizeTaskType, getFeedbackSummary } from "../state/agentFeedback.js";
import { getPendingArtifacts, getApprovedArtifacts } from "../state/artifacts.js";
import {
  getAverageEngagement7d,
  getMarketingPerformanceSummary,
} from "../state/marketingFeedback.js";
import { isGitHubConfigured } from "../execution/githubClient.js";
import { syncOpenPRsStatus } from "../services/mergeReadinessService.js";
import { getCodeChangeStats7d, getBranchStats7d } from "../state/codeChanges.js";
import { getResearchStats7d } from "../state/nexusResearch.js";
import { getPRStats7d } from "../state/pullRequests.js";
import { getPublicationCount7d } from "../state/publications.js";
import { getCurrentBudget, incrementUsedTokens } from "../state/budgets.js";
import { saveDecision, loadRecentDecisions } from "../state/decisions.js";
import { getAverageTokensPerDecision7d } from "../state/efficiencyMetrics.js";
import { loadGoals } from "../state/goals.js";
import { saveOutcome } from "../state/outcomes.js";
import { recordTokenUsage } from "../state/tokenUsage.js";
import { callKairosLLM } from "./kairosLLM.js";
import { formatDailyBriefing } from "./dailyBriefing.js";
import { filterDelegations } from "./decisionFilter.js";
import type {
  KairosOutput,
  KairosDelegation,
  BlockedTask,
  BudgetInfo,
  EfficiencyInfo,
  FeedbackInfo,
  VectorInfo,
  ForgeCodeInfo,
  NexusInfo,
} from "./types.js";
import { validateKairosOutput } from "./validateKairos.js";

export async function runKairos(db: BetterSqlite3.Database): Promise<void> {
  logger.info("Starting cycle...");

  await trySyncPRs(db);

  const goals = loadGoals(db);
  logger.info({ goalsCount: goals.length }, "Active goals loaded");

  if (goals.length === 0) {
    logger.warn("No active goals found. Ending cycle.");
    return;
  }

  const recentDecisions = loadRecentDecisions(db, 3);
  logger.info({ decisionsCount: recentDecisions.length }, "Recent decisions loaded");

  let output: KairosOutput;
  let kairosUsage: LLMUsage | null = null;

  try {
    const result = await callKairosLLM(goals, recentDecisions);
    output = validateKairosOutput(result.output);
    kairosUsage = result.usage;
    logger.info("Output validated successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Kairos LLM failed");
    output = buildFallbackOutput(message);
  }

  if (kairosUsage) {
    recordKairosTokenUsage(db, kairosUsage);
  }

  saveDecision(db, output);
  logger.info("Decision persisted to database");

  const budgetConfig = loadBudgetConfig();
  const filterResult = filterDelegations(output.delegations, db, budgetConfig);
  const filtered = filterResult.delegations;
  logger.info(
    {
      approved: filtered.approved.length,
      needsApproval: filtered.needsApproval.length,
      rejected: filtered.rejected.length,
      adjustmentsApplied: filterResult.adjustmentsApplied,
    },
    "Delegations filtered",
  );

  const nexusOutput = await executeApprovedNexus(db, filtered.approved);
  const forgeOutput = await executeApprovedForge(db, filtered.approved);
  const vectorOutput = await executeApprovedVector(db, filtered.approved);

  const allResults = [...nexusOutput.results, ...forgeOutput.results, ...vectorOutput.results];
  const allBlocked = [...nexusOutput.blocked, ...forgeOutput.blocked, ...vectorOutput.blocked];

  evaluateAndRecordFeedback(db, allResults, filtered.approved, budgetConfig);

  const budgetInfo = buildBudgetInfo(db, allBlocked);
  const efficiencyInfo = buildEfficiencyInfo(db, kairosUsage, output);
  const feedbackInfo = buildFeedbackInfo(db, filterResult.adjustmentsApplied);
  const vectorInfo = buildVectorInfo(db, vectorOutput.results);
  const forgeCodeInfo = buildForgeCodeInfo(db);
  const nexusInfo = buildNexusInfo(db, nexusOutput.results);

  const briefingText = formatDailyBriefing({
    output,
    filtered,
    forgeExecutions: forgeOutput.results,
    budgetInfo,
    efficiencyInfo,
    feedbackInfo,
    vectorInfo,
    forgeCodeInfo,
    nexusInfo,
  });
  await sendTelegramMessage(briefingText);
  logger.info("Daily briefing sent");

  logger.info("Cycle complete.");
}

function recordKairosTokenUsage(db: BetterSqlite3.Database, usage: LLMUsage): void {
  recordTokenUsage(db, {
    agentId: "kairos",
    taskId: "cycle",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  });

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  incrementUsedTokens(db, `${year}-${month}`, usage.totalTokens);

  logger.info(
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    },
    "Kairos token usage recorded",
  );
}

function buildEfficiencyInfo(
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

async function executeApprovedNexus(
  db: BetterSqlite3.Database,
  approved: readonly KairosDelegation[],
): Promise<AgentExecutionOutput> {
  const nexusDelegations = approved.filter((d) => d.agent === "nexus");

  if (nexusDelegations.length === 0) {
    logger.info("No nexus delegations to execute");
    return { results: [], blocked: [] };
  }

  logger.info({ count: nexusDelegations.length }, "Executing nexus delegations");

  const results: ExecutionResult[] = [];
  const blocked: BlockedTask[] = [];

  for (const delegation of nexusDelegations) {
    const budgetCheck = checkBudget(db, delegation.agent);
    if (!budgetCheck.allowed) {
      logger.warn(
        { task: delegation.task, reason: budgetCheck.reason },
        "Budget gate blocked nexus execution",
      );
      blocked.push({
        task: delegation.task,
        reason: budgetCheck.reason ?? "Orcamento insuficiente",
      });
      continue;
    }

    const result = await executeNexus(db, delegation);
    saveOutcome(db, result);
    results.push(result);

    if (result.status === "failed") {
      logger.error(
        { task: delegation.task, error: result.error },
        "Nexus execution failed, aborting remaining",
      );
      break;
    }
  }

  return { results, blocked };
}

async function executeApprovedForge(
  db: BetterSqlite3.Database,
  approved: readonly KairosDelegation[],
): Promise<AgentExecutionOutput> {
  const forgeDelegations = approved.filter((d) => d.agent === "forge");

  if (forgeDelegations.length === 0) {
    logger.info("No forge delegations to execute");
    return { results: [], blocked: [] };
  }

  logger.info({ count: forgeDelegations.length }, "Executing forge delegations");

  const results: ExecutionResult[] = [];
  const blocked: BlockedTask[] = [];

  for (const delegation of forgeDelegations) {
    const budgetCheck = checkBudget(db, delegation.agent);
    if (!budgetCheck.allowed) {
      logger.warn(
        { task: delegation.task, reason: budgetCheck.reason },
        "Budget gate blocked execution",
      );
      blocked.push({
        task: delegation.task,
        reason: budgetCheck.reason ?? "Orcamento insuficiente",
      });
      continue;
    }

    const result = await executeForge(db, delegation);
    saveOutcome(db, result);
    results.push(result);

    if (result.status === "failed") {
      logger.error(
        { task: delegation.task, error: result.error },
        "Forge execution failed, aborting remaining",
      );
      break;
    }
  }

  return { results, blocked };
}

function buildBudgetInfo(
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

function evaluateAndRecordFeedback(
  db: BetterSqlite3.Database,
  results: readonly ExecutionResult[],
  approved: readonly KairosDelegation[],
  budgetConfig: ReturnType<typeof loadBudgetConfig>,
): void {
  for (const result of results) {
    const evaluation =
      result.agent === "nexus"
        ? evaluateNexusExecution(result, budgetConfig)
        : evaluateExecution(result, budgetConfig);
    const delegation = approved.find((d) => d.task === result.task);
    const taskType = normalizeTaskType(delegation?.task ?? result.task);

    saveFeedback(db, {
      agentId: result.agent,
      taskType,
      grade: evaluation.grade,
      reasons: evaluation.reasons,
    });

    logger.info(
      {
        agent: result.agent,
        task: result.task,
        grade: evaluation.grade,
        reasons: evaluation.reasons,
      },
      "Execution evaluated and feedback recorded",
    );
  }
}

interface AgentExecutionOutput {
  readonly results: readonly ExecutionResult[];
  readonly blocked: readonly BlockedTask[];
}

async function executeApprovedVector(
  db: BetterSqlite3.Database,
  approved: readonly KairosDelegation[],
): Promise<AgentExecutionOutput> {
  const vectorDelegations = approved.filter((d) => d.agent === "vector");

  if (vectorDelegations.length === 0) {
    logger.info("No vector delegations to execute");
    return { results: [], blocked: [] };
  }

  logger.info({ count: vectorDelegations.length }, "Executing vector delegations");

  const results: ExecutionResult[] = [];
  const blocked: BlockedTask[] = [];

  for (const delegation of vectorDelegations) {
    const budgetCheck = checkBudget(db, delegation.agent);
    if (!budgetCheck.allowed) {
      logger.warn(
        { task: delegation.task, reason: budgetCheck.reason },
        "Budget gate blocked vector execution",
      );
      blocked.push({
        task: delegation.task,
        reason: budgetCheck.reason ?? "Orcamento insuficiente",
      });
      continue;
    }

    const result = await executeVector(db, delegation);
    saveOutcome(db, result);
    results.push(result);

    if (result.status === "failed") {
      logger.error(
        { task: delegation.task, error: result.error },
        "Vector execution failed, aborting remaining",
      );
      break;
    }
  }

  return { results, blocked };
}

function buildVectorInfo(
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

function buildFeedbackInfo(db: BetterSqlite3.Database, adjustmentsApplied: number): FeedbackInfo {
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

async function trySyncPRs(db: BetterSqlite3.Database): Promise<void> {
  if (!isGitHubConfigured()) return;
  try {
    await syncOpenPRsStatus(db);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to sync PR statuses from GitHub");
  }
}

function buildForgeCodeInfo(db: BetterSqlite3.Database): ForgeCodeInfo {
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

function buildNexusInfo(
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

function buildFallbackOutput(errorMessage: string): KairosOutput {
  return {
    briefing: `Kairos cycle failed: ${errorMessage}`,
    decisions_needed: [],
    delegations: [],
    tasks_killed: [],
    next_24h_focus: "Manual intervention required.",
  };
}
