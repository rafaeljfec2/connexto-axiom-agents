import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { startTelegramBot } from "../interfaces/telegramBot.js";
import { ensureCurrentBudget } from "../state/budgets.js";
import { openDatabase } from "../state/db.js";

logger.info("connexto-axiom Telegram bot initializing...");

const db = openDatabase();

const budgetConfig = loadBudgetConfig();
ensureCurrentBudget(db, budgetConfig.monthlyTokenLimit);
logger.info("Database and budget initialized for bot process");

await startTelegramBot(db);
