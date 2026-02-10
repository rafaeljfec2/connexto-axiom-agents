import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { runKairos } from "../orchestration/runKairos.js";
import { ensureCurrentBudget } from "../state/budgets.js";
import { openDatabase } from "../state/db.js";

logger.info("connexto-axiom initializing...");

const db = openDatabase();
try {
  const budgetConfig = loadBudgetConfig();
  ensureCurrentBudget(db, budgetConfig.monthlyTokenLimit);
  logger.info(
    { monthlyLimit: budgetConfig.monthlyTokenLimit, maxTasksPerDay: budgetConfig.maxTasksPerDay },
    "Budget initialized",
  );

  await runKairos(db);
} finally {
  db.close();
}
