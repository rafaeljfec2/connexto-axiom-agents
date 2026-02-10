import type { Goal } from "../state/goals.js";
import type { RecentDecision } from "../state/decisions.js";

const MAX_GOALS = 3;
const MAX_ACTIONS = 3;
const MAX_LINE_LENGTH = 80;
const SHORT_ID_LENGTH = 8;

export interface CompressedState {
  readonly goals: readonly string[];
  readonly recentActions: readonly string[];
  readonly inputText: string;
}

export function compressState(
  goals: readonly Goal[],
  recentDecisions: readonly RecentDecision[],
): CompressedState {
  const compressedGoals = goals.slice(0, MAX_GOALS).map(compressGoal);
  const compressedActions = recentDecisions.slice(0, MAX_ACTIONS).map(compressDecision);

  const inputText = buildInputText(compressedGoals, compressedActions);

  return {
    goals: compressedGoals,
    recentActions: compressedActions,
    inputText,
  };
}

function compressGoal(goal: Goal): string {
  const shortId = goal.id.slice(0, SHORT_ID_LENGTH);
  const line = `[${shortId}] ${goal.title} (P:${goal.priority})`;
  return truncate(line);
}

function compressDecision(decision: RecentDecision): string {
  const daysAgo = computeDaysAgo(decision.created_at);
  const action = extractActionSummary(decision);
  const line = `${decision.agent_id}: ${action} (D-${daysAgo})`;
  return truncate(line);
}

function extractActionSummary(decision: RecentDecision): string {
  const source = decision.reasoning ?? decision.action;
  return truncate(source, 60);
}

function computeDaysAgo(isoDate: string): number {
  const created = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

function truncate(text: string, maxLength: number = MAX_LINE_LENGTH): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function buildInputText(goals: readonly string[], actions: readonly string[]): string {
  const goalsSection = goals.length > 0 ? goals.map((g) => `- ${g}`).join("\n") : "- Nenhum.";

  const stateSection =
    actions.length > 0 ? actions.map((a) => `- ${a}`).join("\n") : "- Nenhuma acao recente.";

  return [
    "GOALS:",
    goalsSection,
    "",
    "STATE:",
    stateSection,
    "",
    "CONSTRAINTS:",
    "- max 3 delegacoes",
    "- custo e risco obrigatorios",
    "- apenas agente forge disponivel",
    "",
    "TASK:",
    "Decida proximas acoes.",
  ].join("\n");
}
