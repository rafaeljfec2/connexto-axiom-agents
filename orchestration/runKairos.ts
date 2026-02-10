import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import { loadGoals } from "../state/goals.js";
import { saveDecision, loadRecentDecisions } from "../state/decisions.js";
import { callKairosLLM } from "./kairosLLM.js";
import { formatDailyBriefing } from "./dailyBriefing.js";
import type { KairosOutput } from "./types.js";
import { validateKairosOutput } from "./validateKairos.js";

export async function runKairos(db: BetterSqlite3.Database): Promise<void> {
  logger.info("Starting cycle...");

  const goals = loadGoals(db);
  logger.info({ goalsCount: goals.length }, "Active goals loaded");

  if (goals.length === 0) {
    logger.warn("No active goals found. Ending cycle.");
    return;
  }

  const recentDecisions = loadRecentDecisions(db, 5);
  logger.info({ decisionsCount: recentDecisions.length }, "Recent decisions loaded");

  let output: KairosOutput;
  try {
    const rawOutput = await callKairosLLM(goals, recentDecisions);
    output = validateKairosOutput(rawOutput);
    logger.info("Output validated successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Kairos LLM failed");
    output = buildFallbackOutput(message);
  }

  saveDecision(db, output);
  logger.info("Decision persisted to database");

  const briefingText = formatDailyBriefing(output);
  await sendTelegramMessage(briefingText);
  logger.info("Daily briefing sent");

  logger.info("Cycle complete.");
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
