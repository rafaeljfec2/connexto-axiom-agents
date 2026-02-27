import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { evaluateExecution } from "../evaluation/forgeEvaluator.js";
import { evaluateNexusExecution } from "../evaluation/nexusEvaluator.js";
import { checkBudget } from "../execution/shared/budgetGate.js";
import { executeForge } from "../execution/forge/forgeExecutor.js";
import { executeNexus } from "../execution/nexus/nexusExecutor.js";
import type { ExecutionResult } from "../execution/shared/types.js";
import { executeVector } from "../execution/vector/vectorExecutor.js";
import type { LLMUsage } from "../llm/client.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import { saveFeedback, normalizeTaskType, getFeedbackSummary } from "../state/agentFeedback.js";
import { getPendingArtifacts, getApprovedArtifacts } from "../state/artifacts.js";
import {
  getAverageEngagement7d,
  getMarketingPerformanceSummary,
} from "../state/marketingFeedback.js";
import { isGitHubConfigured } from "../execution/shared/githubClient.js";
import { syncOpenPRsStatus } from "../services/mergeReadinessService.js";
import { getCodeChangeStats7d, getBranchStats7d } from "../state/codeChanges.js";
import { getResearchStats7d, getResearchByGoalId } from "../state/nexusResearch.js";
import { getPRStats7d } from "../state/pullRequests.js";
import { getPublicationCount7d } from "../state/publications.js";
import { getCurrentBudget, incrementUsedTokens } from "../state/budgets.js";
import { saveDecision, loadRecentDecisions } from "../state/decisions.js";
import { getAverageTokensPerDecision7d } from "../state/efficiencyMetrics.js";
import { loadGoals, loadGoalsByProject } from "../state/goals.js";
import { saveOutcome } from "../state/outcomes.js";
import { recordTokenUsage } from "../state/tokenUsage.js";
import {
  getAgentSummary,
  getRecurrentFailurePatterns,
  getFrequentFiles,
} from "../state/executionHistory.js";
import { callKairosLLM } from "./kairosLLM.js";
import { formatDailyBriefing } from "./dailyBriefing.js";
import { filterDelegations } from "./decisionFilter.js";
import {
  classifyGovernance,
  selectGovernancePolicy,
  postValidateGovernance,
  loadGovernanceInputData,
  resolveNexusPreResearchContext,
} from "./decisionGovernance.js";
import { saveGovernanceDecision } from "../state/governanceLog.js";
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
  HistoricalPatternInfo,
  GovernanceInfo,
} from "./types.js";
import { validateKairosOutput } from "./validateKairos.js";
import { createEventEmitter } from "../execution/shared/executionEventEmitter.js";
import type { ExecutionEventEmitter } from "../execution/shared/executionEventEmitter.js";
import { cleanupOldEvents } from "../state/executionEvents.js";

export async function runKairos(
  db: BetterSqlite3.Database,
  projectId?: string,
): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  const emitter = createEventEmitter(db, traceId);
  logger.info({ projectId: projectId ?? "all", traceId }, "Starting cycle...");

  cleanupOldEvents(db);

  emitter.info("kairos", "cycle:start", "Cycle started", {
    phase: "orchestration",
    metadata: { projectId: projectId ?? "all" },
  });

  await trySyncPRs(db);

  const goals = projectId ? loadGoalsByProject(db, projectId) : loadGoals(db);
  logger.info({ goalsCount: goals.length, projectId: projectId ?? "all" }, "Active goals loaded");

  if (goals.length === 0) {
    logger.warn("No active goals found. Ending cycle.");
    return;
  }

  const recentDecisions = loadRecentDecisions(db, 3);
  logger.info({ decisionsCount: recentDecisions.length }, "Recent decisions loaded");

  const governanceData = loadGovernanceInputData(db);
  const classification = classifyGovernance(goals, governanceData);
  const governance = selectGovernancePolicy(classification);

  let nexusPreContext = "";
  if (governance.nexusPreResearchRequired) {
    nexusPreContext = resolveNexusPreResearchContext(db, goals);
    logger.info({ chars: nexusPreContext.length }, "NEXUS pre-research context resolved");
  }

  const governanceContextLine = `- governanca: ${governance.modelTier} C:${classification.complexity} R:${classification.risk}`;

  let output: KairosOutput;
  let kairosUsage: LLMUsage | null = null;

  try {
    const result = await callKairosLLM(goals, recentDecisions, db, {
      modelOverride: governance.selectedModel,
      nexusPreContext: nexusPreContext.length > 0 ? nexusPreContext : undefined,
      governanceContext: governanceContextLine,
    });
    output = validateKairosOutput(result.output);
    kairosUsage = result.usage;
    logger.info({ model: governance.selectedModel }, "Output validated successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Kairos LLM failed");
    output = buildFallbackOutput(message);
  }

  const validation = postValidateGovernance(output, governance);

  const cycleId = crypto.randomUUID();
  saveGovernanceDecision(db, {
    cycleId,
    complexity: classification.complexity,
    risk: classification.risk,
    cost: classification.cost,
    historicalStability: classification.historicalStability,
    selectedModel: governance.selectedModel,
    modelTier: governance.modelTier,
    nexusPreResearch: governance.nexusPreResearchRequired,
    humanApprovalRequired: governance.humanApprovalRequired,
    postValidationStatus: validation.status,
    postValidationNotes: validation.notes,
    reasons: classification.reasons,
    tokensUsed: kairosUsage?.totalTokens,
  });
  logger.info({ cycleId, validation: validation.status }, "Governance decision recorded");

  emitter.info("kairos", "cycle:governance", "Governance policy selected", {
    phase: "governance",
    metadata: {
      model: governance.selectedModel,
      tier: governance.modelTier,
      complexity: classification.complexity,
      risk: classification.risk,
      validation: validation.status,
    },
  });

  if (kairosUsage) {
    recordKairosTokenUsage(db, kairosUsage);
  }

  saveDecision(db, output);
  logger.info("Decision persisted to database");

  const budgetConfig = loadBudgetConfig();
  const filterResult = filterDelegations(output.delegations, db, budgetConfig);
  const filtered = filterResult.delegations;

  const effectiveApproved = resolveNeedsApproval(
    filtered.approved,
    filtered.needsApproval,
    validation.status,
  );

  const goalIds = goals.map((g) => g.id);
  const finalApproved = applyResearchSaturationFilter(db, effectiveApproved, goalIds);

  logger.info(
    {
      approved: finalApproved.length,
      needsApproval: filtered.needsApproval.length,
      rejected: filtered.rejected.length,
      adjustmentsApplied: filterResult.adjustmentsApplied,
      autoApproved: effectiveApproved.length - filtered.approved.length,
      researchFiltered: effectiveApproved.length - finalApproved.length,
    },
    "Delegations filtered",
  );

  emitter.info("kairos", "cycle:delegations_filtered", "Delegations filtered and approved", {
    phase: "filtering",
    metadata: {
      approved: finalApproved.length,
      rejected: filtered.rejected.length,
      agents: finalApproved.map((d) => d.agent),
    },
  });

  const nexusOutput = await executeApprovedNexus(db, finalApproved, traceId, emitter);
  const forgeOutput = await executeApprovedForge(db, finalApproved, projectId, traceId, emitter);
  const vectorOutput = await executeApprovedVector(db, finalApproved, traceId, emitter);

  const allResults = [...nexusOutput.results, ...forgeOutput.results, ...vectorOutput.results];
  const allBlocked = [...nexusOutput.blocked, ...forgeOutput.blocked, ...vectorOutput.blocked];

  evaluateAndRecordFeedback(db, allResults, finalApproved, budgetConfig);

  const budgetInfo = buildBudgetInfo(db, allBlocked);
  const efficiencyInfo = buildEfficiencyInfo(db, kairosUsage, output);
  const feedbackInfo = buildFeedbackInfo(db, filterResult.adjustmentsApplied);
  const vectorInfo = buildVectorInfo(db, vectorOutput.results);
  const forgeCodeInfo = buildForgeCodeInfo(db);
  const nexusInfo = buildNexusInfo(db, nexusOutput.results);
  const historicalInfo = buildHistoricalInfo(db);

  const governanceInfo: GovernanceInfo = {
    selectedModel: governance.selectedModel,
    modelTier: governance.modelTier,
    complexity: classification.complexity,
    risk: classification.risk,
    cost: classification.cost,
    historicalStability: classification.historicalStability,
    nexusPreResearchTriggered: governance.nexusPreResearchRequired,
    postValidationStatus: validation.status,
    postValidationNotes: validation.notes,
    reasons: classification.reasons,
  };

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
    historicalInfo,
    governanceInfo,
    projectId,
  });
  await sendTelegramMessage(briefingText);
  logger.info("Daily briefing sent");

  emitter.info("kairos", "cycle:end", "Cycle completed", {
    phase: "orchestration",
    metadata: {
      totalResults: allResults.length,
      successCount: allResults.filter((r) => r.status === "success").length,
      failedCount: allResults.filter((r) => r.status === "failed").length,
      blockedCount: allBlocked.length,
      kairosTokens: kairosUsage?.totalTokens ?? 0,
    },
  });

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
  traceId?: string,
  emitter?: ExecutionEventEmitter,
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
      emitter?.warn("nexus", "delegation:blocked", "Budget gate blocked execution", {
        phase: "budget_check",
        metadata: { task: delegation.task.slice(0, 120), reason: budgetCheck.reason },
      });
      blocked.push({
        task: delegation.task,
        reason: budgetCheck.reason ?? "Orcamento insuficiente",
      });
      continue;
    }

    emitter?.info("nexus", "delegation:start", "NEXUS research started", {
      phase: "execution",
      metadata: { task: delegation.task.slice(0, 120), goalId: delegation.goal_id },
    });

    const result = await executeNexus(db, delegation);
    saveOutcome(db, result, { traceId });
    results.push(result);

    if (result.status === "failed") {
      emitter?.error("nexus", "delegation:failed", "NEXUS research failed", {
        phase: "execution",
        metadata: { task: delegation.task.slice(0, 120), error: result.error?.slice(0, 200) },
      });
      logger.error(
        { task: delegation.task, error: result.error, traceId },
        "Nexus execution failed, aborting remaining",
      );
      break;
    }

    emitter?.info("nexus", "delegation:complete", "NEXUS research completed", {
      phase: "execution",
      metadata: {
        task: delegation.task.slice(0, 120),
        tokensUsed: result.tokensUsed,
        executionTimeMs: result.executionTimeMs,
      },
    });
  }

  return { results, blocked };
}

async function executeApprovedForge(
  db: BetterSqlite3.Database,
  approved: readonly KairosDelegation[],
  projectId?: string,
  traceId?: string,
  emitter?: ExecutionEventEmitter,
): Promise<AgentExecutionOutput> {
  const forgeDelegations = approved.filter((d) => d.agent === "forge");

  if (forgeDelegations.length === 0) {
    logger.info("No forge delegations to execute");
    return { results: [], blocked: [] };
  }

  logger.info({ count: forgeDelegations.length, projectId: projectId ?? "none", traceId }, "Executing forge delegations");

  const results: ExecutionResult[] = [];
  const blocked: BlockedTask[] = [];

  for (const delegation of forgeDelegations) {
    const budgetCheck = checkBudget(db, delegation.agent);
    if (!budgetCheck.allowed) {
      logger.warn(
        { task: delegation.task, reason: budgetCheck.reason },
        "Budget gate blocked execution",
      );
      emitter?.warn("forge", "delegation:blocked", "Budget gate blocked execution", {
        phase: "budget_check",
        metadata: { task: delegation.task.slice(0, 120), reason: budgetCheck.reason },
      });
      blocked.push({
        task: delegation.task,
        reason: budgetCheck.reason ?? "Orcamento insuficiente",
      });
      continue;
    }

    emitter?.info("forge", "delegation:start", "FORGE execution started", {
      phase: "execution",
      metadata: {
        task: delegation.task.slice(0, 120),
        goalId: delegation.goal_id,
        projectId: projectId ?? "default",
      },
    });

    const result = await executeForge(db, delegation, projectId, traceId, emitter);

    if (result.status === "infra_unavailable") {
      emitter?.warn("forge", "delegation:infra_unavailable", "Infrastructure unavailable", {
        phase: "execution",
        metadata: { task: delegation.task.slice(0, 120), error: result.error?.slice(0, 200) },
      });
      logger.error(
        { task: delegation.task, error: result.error, traceId },
        "Infra unavailable — skipping outcome (not a FORGE failure)",
      );
      continue;
    }

    saveOutcome(db, result, { traceId });
    results.push(result);

    if (result.status === "failed") {
      emitter?.error("forge", "delegation:failed", "FORGE execution failed", {
        phase: "execution",
        metadata: {
          task: delegation.task.slice(0, 120),
          error: result.error?.slice(0, 200),
          tokensUsed: result.tokensUsed,
          executionTimeMs: result.executionTimeMs,
        },
      });
      logger.error(
        { task: delegation.task, error: result.error, traceId },
        "Forge execution failed, aborting remaining",
      );
      break;
    }

    emitter?.info("forge", "delegation:complete", "FORGE execution completed", {
      phase: "execution",
      metadata: {
        task: delegation.task.slice(0, 120),
        status: result.status,
        tokensUsed: result.tokensUsed,
        executionTimeMs: result.executionTimeMs,
      },
    });
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
  traceId?: string,
  emitter?: ExecutionEventEmitter,
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
      emitter?.warn("vector", "delegation:blocked", "Budget gate blocked execution", {
        phase: "budget_check",
        metadata: { task: delegation.task.slice(0, 120), reason: budgetCheck.reason },
      });
      blocked.push({
        task: delegation.task,
        reason: budgetCheck.reason ?? "Orcamento insuficiente",
      });
      continue;
    }

    emitter?.info("vector", "delegation:start", "VECTOR draft started", {
      phase: "execution",
      metadata: { task: delegation.task.slice(0, 120), goalId: delegation.goal_id },
    });

    const result = await executeVector(db, delegation);
    saveOutcome(db, result, { traceId });
    results.push(result);

    if (result.status === "failed") {
      emitter?.error("vector", "delegation:failed", "VECTOR draft failed", {
        phase: "execution",
        metadata: { task: delegation.task.slice(0, 120), error: result.error?.slice(0, 200) },
      });
      logger.error(
        { task: delegation.task, error: result.error, traceId },
        "Vector execution failed, aborting remaining",
      );
      break;
    }

    emitter?.info("vector", "delegation:complete", "VECTOR draft completed", {
      phase: "execution",
      metadata: {
        task: delegation.task.slice(0, 120),
        tokensUsed: result.tokensUsed,
        executionTimeMs: result.executionTimeMs,
      },
    });
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

function buildHistoricalInfo(db: BetterSqlite3.Database): HistoricalPatternInfo {
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

const RESEARCH_SATURATION_THRESHOLD = 3;

function applyResearchSaturationFilter(
  db: BetterSqlite3.Database,
  delegations: readonly KairosDelegation[],
  goalIds: readonly string[],
): readonly KairosDelegation[] {
  const hasForge = delegations.some((d) => d.agent === "forge");
  if (!hasForge) return delegations;

  const isResearchSaturated = goalIds.some((goalId) => {
    const research = getResearchByGoalId(db, goalId);
    return research.length >= RESEARCH_SATURATION_THRESHOLD;
  });

  return delegations.filter((d) => {
    if (d.agent === "vector") {
      logger.info(
        { agent: d.agent, task: d.task.slice(0, 80) },
        "Skipping VECTOR: FORGE is executing, VECTOR runs after implementation",
      );
      return false;
    }

    if (d.agent === "nexus" && isResearchSaturated) {
      logger.info(
        { agent: d.agent, task: d.task.slice(0, 80) },
        "Skipping NEXUS: research saturated, prioritizing FORGE execution",
      );
      return false;
    }

    return true;
  });
}

function resolveNeedsApproval(
  approved: readonly KairosDelegation[],
  needsApproval: readonly KairosDelegation[],
  validationStatus: "match" | "mismatch" | "escalation_needed",
): readonly KairosDelegation[] {
  if (needsApproval.length === 0) return approved;

  if (validationStatus === "escalation_needed") {
    logger.warn(
      { count: needsApproval.length, agents: needsApproval.map((d) => d.agent) },
      "Delegations blocked: governance requires escalation",
    );
    return approved;
  }

  logger.info(
    {
      autoApproved: needsApproval.length,
      agents: needsApproval.map((d) => d.agent),
      reason: "governance post-validation did not require escalation",
    },
    "Auto-approving needsApproval delegations",
  );

  return [...approved, ...needsApproval];
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
