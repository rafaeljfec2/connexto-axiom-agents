import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { loadGoals } from "../state/goals.js";
import { saveDecision } from "../state/decisions.js";
import { callKairosLLM } from "./kairosLLM.js";
import { validateKairosOutput } from "./validateKairos.js";

export function runKairos(db: BetterSqlite3.Database): void {
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

  logger.info("Cycle complete.");
}
