import type BetterSqlite3 from "better-sqlite3";
import { getResearchByGoalId } from "../../state/nexusResearch.js";
import { getGoalById } from "../../state/goals.js";
import type { NexusResearchContext, GoalContext } from "../forge/forgeTypes.js";
import type { ExecutionResult } from "../shared/types.js";

const IMPLEMENTATION_TASK_PATTERNS: ReadonlySet<string> = new Set([
  "implementar", "implement", "criar", "create", "adicionar", "add",
  "alterar", "change", "modificar", "modify", "aplicar", "apply",
  "override", "substituir", "replace", "trocar", "swap",
]);

export function isImplementationTask(task: string): boolean {
  const normalized = task.toLowerCase();
  for (const pattern of IMPLEMENTATION_TASK_PATTERNS) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

export function loadNexusResearchForGoal(
  db: BetterSqlite3.Database,
  goalId: string,
): readonly NexusResearchContext[] {
  const research = getResearchByGoalId(db, goalId);
  if (research.length === 0) return [];
  return research.map((r) => ({
    question: r.question,
    recommendation: r.recommendation,
    rawOutput: r.raw_output,
  }));
}

export function loadGoalContext(
  db: BetterSqlite3.Database,
  goalId: string,
): GoalContext | undefined {
  const goal = getGoalById(db, goalId);
  if (!goal) return undefined;
  return { title: goal.title, description: goal.description };
}

export function buildResult(
  task: string,
  status: "success" | "failed" | "infra_unavailable",
  output: string,
  error?: string,
  executionTimeMs?: number,
  tokensUsed?: number,
): ExecutionResult {
  const effectiveTokens = tokensUsed && tokensUsed > 0 ? tokensUsed : undefined;
  return { agent: "forge", task, status, output, error, executionTimeMs, tokensUsed: effectiveTokens };
}
