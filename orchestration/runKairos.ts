import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import { loadGoals } from "../state/goals.js";
import { saveDecision } from "../state/decisions.js";
import { callKairosLLM } from "./kairosLLM.js";
import { formatDailyBriefing } from "./dailyBriefing.js";
import { validateKairosOutput } from "./validateKairos.js";

export async function runKairos(db: BetterSqlite3.Database): Promise<void> {
  logger.info("Starting cycle...");

  const goals = loadGoals(db);
  logger.info({ goalsCount: goals.length }, "Active goals loaded");

  if (goals.length === 0) {
    logger.warn("No active goals found. Ending cycle.");
    return;
  }

  const rawOutput = callKairosLLM(goals);
  const output = validateKairosOutput(rawOutput);
  logger.info("Output validated successfully");

  saveDecision(db, output);
  logger.info("Decision persisted to database");

  const briefingText = formatDailyBriefing(output);
  await sendTelegramMessage(briefingText);
  logger.info("Daily briefing sent");

  logger.info("Cycle complete.");
}
