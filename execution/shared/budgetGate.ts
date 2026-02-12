import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../../config/budget.js";
import { logger } from "../../config/logger.js";
import { getCurrentBudget, isBudgetExhausted } from "../../state/budgets.js";
import { getAgentUsageMonth, getTaskCountToday } from "../../state/tokenUsage.js";

export interface BudgetCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

const BUDGET_ALLOWED: BudgetCheckResult = { allowed: true };

export function checkBudget(db: BetterSqlite3.Database, agentId: string): BudgetCheckResult {
  const config = loadBudgetConfig();

  if (isBudgetExhausted(db)) {
    logger.error({ agentId }, "KILL SWITCH: budget exhausted");
    return {
      allowed: false,
      reason: "Orcamento mensal esgotado (kill switch ativo)",
    };
  }

  const budget = getCurrentBudget(db);
  if (budget && budget.used_tokens >= config.monthlyTokenLimit) {
    logger.warn({ agentId, usedTokens: budget.used_tokens }, "Monthly token limit reached");
    return {
      allowed: false,
      reason: `Limite mensal de tokens excedido (${budget.used_tokens}/${config.monthlyTokenLimit})`,
    };
  }

  const agentMonthlyUsage = getAgentUsageMonth(db, agentId);
  if (agentMonthlyUsage >= config.perAgentMonthlyLimit) {
    logger.warn({ agentId, agentMonthlyUsage }, "Per-agent monthly limit reached");
    return {
      allowed: false,
      reason: `Limite mensal do agente excedido (${agentMonthlyUsage}/${config.perAgentMonthlyLimit})`,
    };
  }

  const taskCountToday = getTaskCountToday(db, agentId);
  if (taskCountToday >= config.maxTasksPerDay) {
    logger.warn({ agentId, taskCountToday }, "Daily task limit reached");
    return {
      allowed: false,
      reason: `Limite diario de tasks excedido (${taskCountToday}/${config.maxTasksPerDay})`,
    };
  }

  return BUDGET_ALLOWED;
}
