import type BetterSqlite3 from "better-sqlite3";
import { type loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { evaluateExecution } from "../evaluation/forgeEvaluator.js";
import { evaluateNexusExecution } from "../evaluation/nexusEvaluator.js";
import { checkBudget } from "../execution/shared/budgetGate.js";
import { executeForge } from "../execution/forge/forgeExecutor.js";
import { executeNexus } from "../execution/nexus/nexusExecutor.js";
import type { ExecutionResult } from "../execution/shared/types.js";
import { executeVector } from "../execution/vector/vectorExecutor.js";
import { saveFeedback, normalizeTaskType } from "../state/agentFeedback.js";
import { markGoalInProgress } from "../state/goals.js";
import { saveOutcome } from "../state/outcomes.js";
import type { KairosDelegation, BlockedTask } from "./types.js";
import type { ExecutionEventEmitter } from "../execution/shared/executionEventEmitter.js";

export interface AgentExecutionOutput {
  readonly results: readonly ExecutionResult[];
  readonly blocked: readonly BlockedTask[];
}

export async function executeApprovedNexus(
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

    if (delegation.goal_id) {
      markGoalInProgress(db, delegation.goal_id);
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

export async function executeApprovedForge(
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

  logger.info(
    { count: forgeDelegations.length, projectId: projectId ?? "none", traceId },
    "Executing forge delegations",
  );

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

    if (delegation.goal_id) {
      markGoalInProgress(db, delegation.goal_id);
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

export async function executeApprovedVector(
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

    if (delegation.goal_id) {
      markGoalInProgress(db, delegation.goal_id);
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

export function evaluateAndRecordFeedback(
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
