import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Goal } from "../state/goals.js";
import type { KairosOutput } from "./types.js";

const SYSTEM_PROMPT_PATH = resolve("agents/kairos/SYSTEM.md");

export function callKairosLLM(goals: readonly Goal[]): KairosOutput {
  const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  console.log(`[kairos-llm] System prompt loaded (${systemPrompt.length} chars)`);
  console.log(`[kairos-llm] Evaluating ${goals.length} active goal(s)`);

  const topGoal = goals[0];

  return {
    briefing: `Kairos cycle executed. Evaluated ${goals.length} active goal(s). Top priority: "${topGoal?.title ?? "none"}".`,
    decisions_needed: goals.map((goal) => ({
      goal_id: goal.id,
      action: "evaluate_progress",
      reasoning: `Goal "${goal.title}" requires progress assessment (priority: ${goal.priority}).`,
    })),
    delegations: topGoal
      ? [
          {
            agent: "forge",
            task: `Execute next step for "${topGoal.title}"`,
            goal_id: topGoal.id,
          },
        ]
      : [],
    tasks_killed: [],
    next_24h_focus: topGoal
      ? `Focus on advancing "${topGoal.title}" as top priority.`
      : "No active goals. Awaiting new objectives.",
  };
}
