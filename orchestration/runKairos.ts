import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { evaluateForgeExecution } from "../evaluation/forgeEvaluator.js";
import { checkBudget } from "../execution/budgetGate.js";
import { executeForge } from "../execution/forgeExecutor.js";
import type { ExecutionResult } from "../execution/types.js";
import type { LLMUsage } from "../llm/client.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import { saveFeedback, normalizeTaskType, getFeedbackSummary } from "../state/agentFeedback.js";
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
} from "./types.js";
import { validateKairosOutput } from "./validateKairos.js";

export async function runKairos(db: BetterSqlite3.Database): Promise<void> {
  logger.info("Starting cycle...");

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

  const { results: forgeResults, blocked: blockedTasks } = await executeApprovedForge(
    db,
    filtered.approved,
  );

  evaluateAndRecordFeedback(db, forgeResults, filtered.approved, budgetConfig);

  const budgetInfo = buildBudgetInfo(db, blockedTasks);
  const efficiencyInfo = buildEfficiencyInfo(db, kairosUsage, output);
  const feedbackInfo = buildFeedbackInfo(db, filterResult.adjustmentsApplied);

  const briefingText = formatDailyBriefing(
    output,
    filtered,
    forgeResults,
    budgetInfo,
    efficiencyInfo,
    feedbackInfo,
  );
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

interface ForgeExecutionOutput {
  readonly results: readonly ExecutionResult[];
  readonly blocked: readonly BlockedTask[];
}

async function executeApprovedForge(
  db: BetterSqlite3.Database,
  approved: readonly KairosDelegation[],
): Promise<ForgeExecutionOutput> {
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
    const evaluation = evaluateForgeExecution(result, budgetConfig);
    const delegation = approved.find((d) => d.task === result.task);
    const taskType = normalizeTaskType(delegation?.task ?? result.task);

    saveFeedback(db, {
      agentId: result.agent,
      taskType,
      grade: evaluation.grade,
      reasons: evaluation.reasons,
    });

    logger.info(
      { task: result.task, grade: evaluation.grade, reasons: evaluation.reasons },
      "Forge execution evaluated and feedback recorded",
    );
  }
}

function buildFeedbackInfo(db: BetterSqlite3.Database, adjustmentsApplied: number): FeedbackInfo {
  const summary = getFeedbackSummary(db, "forge", 7);

  const problematicTasks = findProblematicTasks(db);

  return {
    successRate7d: summary.successRate,
    totalExecutions7d: summary.total,
    problematicTasks,
    adjustmentsApplied,
  };
}

function findProblematicTasks(db: BetterSqlite3.Database): readonly string[] {
  const rows = db
    .prepare(
      `SELECT task_type, COUNT(*) as failure_count
       FROM agent_feedback
       WHERE agent_id = 'forge'
         AND grade = 'FAILURE'
         AND created_at >= datetime('now', '-7 days')
       GROUP BY task_type
       HAVING failure_count >= 2
       ORDER BY failure_count DESC`,
    )
    .all() as ReadonlyArray<{ task_type: string; failure_count: number }>;

  return rows.map((r) => `${r.task_type} (${r.failure_count} falhas)`);
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
