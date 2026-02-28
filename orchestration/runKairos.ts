import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import type { LLMUsage } from "../llm/client.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import { isGitHubConfigured } from "../execution/shared/githubClient.js";
import { syncOpenPRsStatus } from "../services/mergeReadinessService.js";
import { getResearchByGoalId } from "../state/nexusResearch.js";
import { incrementUsedTokens } from "../state/budgets.js";
import { saveDecision, loadRecentDecisions } from "../state/decisions.js";
import { loadGoals, loadGoalsByProject } from "../state/goals.js";
import { recordTokenUsage } from "../state/tokenUsage.js";
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
  GovernanceInfo,
} from "./types.js";
import { validateKairosOutput } from "./validateKairos.js";
import { createEventEmitter } from "../execution/shared/executionEventEmitter.js";
import { cleanupOldEvents } from "../state/executionEvents.js";
import type { Goal } from "../state/goals.js";
import {
  executeApprovedNexus,
  executeApprovedForge,
  executeApprovedVector,
  evaluateAndRecordFeedback,
} from "./kairosAgentDispatcher.js";
import {
  buildBudgetInfo,
  buildEfficiencyInfo,
  buildFeedbackInfo,
  buildVectorInfo,
  buildForgeCodeInfo,
  buildNexusInfo,
  buildHistoricalInfo,
} from "./kairosBriefingData.js";

function normalizeDelegationGoalIds(
  delegations: readonly KairosDelegation[],
  goals: readonly Goal[],
): KairosDelegation[] {
  const shortToFull = new Map<string, string>();
  for (const goal of goals) {
    shortToFull.set(goal.id.slice(0, 8), goal.id);
  }

  return delegations.map((d) => {
    if (!d.goal_id) return { ...d };

    const fullId = shortToFull.get(d.goal_id) ?? d.goal_id;
    if (fullId !== d.goal_id) {
      logger.debug({ shortId: d.goal_id, fullId }, "Normalized delegation goal_id");
    }
    return { ...d, goal_id: fullId };
  });
}

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

  const normalizedDelegations = normalizeDelegationGoalIds(output.delegations, goals);
  const normalizedOutput: KairosOutput = { ...output, delegations: normalizedDelegations };

  const budgetConfig = loadBudgetConfig();
  const filterResult = filterDelegations(normalizedOutput.delegations, db, budgetConfig);
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

async function trySyncPRs(db: BetterSqlite3.Database): Promise<void> {
  if (!isGitHubConfigured()) return;
  try {
    await syncOpenPRsStatus(db);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to sync PR statuses from GitHub");
  }
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
