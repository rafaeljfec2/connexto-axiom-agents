import type BetterSqlite3 from "better-sqlite3";
import { loadGoals } from "../state/goals.js";
import { saveDecision } from "../state/decisions.js";
import { callKairosLLM } from "./kairosLLM.js";
import { validateKairosOutput } from "./validateKairos.js";

export function runKairos(db: BetterSqlite3.Database): void {
  console.log("[kairos] Starting cycle...");

  const goals = loadGoals(db);
  console.log(`[kairos] Loaded ${goals.length} active goal(s)`);

  if (goals.length === 0) {
    console.log("[kairos] No active goals found. Ending cycle.");
    return;
  }

  const rawOutput = callKairosLLM(goals);
  const output = validateKairosOutput(rawOutput);
  console.log("[kairos] Output validated successfully");

  saveDecision(db, output);
  console.log("[kairos] Decision persisted to database");

  console.log("[kairos] Cycle complete.");
}
