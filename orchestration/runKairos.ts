import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { executeForge } from "../execution/forgeExecutor.js";
import type { ExecutionResult } from "../execution/types.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import { saveDecision, loadRecentDecisions } from "../state/decisions.js";
import { loadGoals } from "../state/goals.js";
import { saveOutcome } from "../state/outcomes.js";
import { callKairosLLM } from "./kairosLLM.js";
import { formatDailyBriefing } from "./dailyBriefing.js";
import { filterDelegations } from "./decisionFilter.js";
import type { KairosOutput, KairosDelegation } from "./types.js";
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

  const filtered = filterDelegations(output.delegations);
  logger.info(
    {
      approved: filtered.approved.length,
      needsApproval: filtered.needsApproval.length,
      rejected: filtered.rejected.length,
    },
    "Delegations filtered",
  );

  const forgeResults = await executeApprovedForge(db, filtered.approved);

  const briefingText = formatDailyBriefing(output, filtered, forgeResults);
  await sendTelegramMessage(briefingText);
  logger.info("Daily briefing sent");

  logger.info("Cycle complete.");
}

async function executeApprovedForge(
  db: BetterSqlite3.Database,
  approved: readonly KairosDelegation[],
): Promise<readonly ExecutionResult[]> {
  const forgeDelegations = approved.filter((d) => d.agent === "forge");

  if (forgeDelegations.length === 0) {
    logger.info("No forge delegations to execute");
    return [];
  }

  logger.info({ count: forgeDelegations.length }, "Executing forge delegations");

  const results: ExecutionResult[] = [];

  for (const delegation of forgeDelegations) {
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

  return results;
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
