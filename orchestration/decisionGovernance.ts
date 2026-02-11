import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import type { Goal } from "../state/goals.js";
import type { FeedbackSummary } from "../state/agentFeedback.js";
import { getFeedbackSummary } from "../state/agentFeedback.js";
import { getRecurrentFailurePatterns, getAgentSummary } from "../state/executionHistory.js";
import { getCurrentBudget } from "../state/budgets.js";
import { getRecentResearch, getResearchByGoalId } from "../state/nexusResearch.js";
import type { NexusResearch } from "../state/nexusResearch.js";
import { loadBudgetConfig } from "../config/budget.js";
import type { KairosOutput } from "./types.js";

export type HistoricalStability = "stable" | "moderate" | "unstable";
export type ModelTier = "economy" | "standard" | "premium";

const ECONOMY_MODEL = "gpt-4o-mini";
const STANDARD_MODEL = "gpt-4o";
const PREMIUM_MODEL = "gpt-5.2";

const ARCHITECTURAL_KEYWORDS = [
  "migrar",
  "redesign",
  "infraestrutura",
  "arquitetura",
  "refatorar",
  "migration",
  "architecture",
  "refactor",
  "database",
  "schema",
  "breaking",
] as const;

const STABLE_SUCCESS_RATE_THRESHOLD = 70;
const UNSTABLE_SUCCESS_RATE_THRESHOLD = 50;
const RECURRENT_FAILURE_THRESHOLD = 2;
const BUDGET_HIGH_USAGE_PERCENT = 80;
const HIGH_PRIORITY_THRESHOLD = 8;
const CRITICAL_RISK_THRESHOLD = 5;
const HIGH_RISK_THRESHOLD = 4;
const HIGH_COMPLEXITY_THRESHOLD = 4;

const NEXUS_RESEARCH_RECENT_DAYS = 7;
const MAX_NEXUS_CONTEXT_CHARS = 400;

export interface GovernanceClassification {
  readonly complexity: number;
  readonly risk: number;
  readonly cost: number;
  readonly historicalStability: HistoricalStability;
  readonly reasons: readonly string[];
}

export interface GovernanceDecision {
  readonly classification: GovernanceClassification;
  readonly selectedModel: string;
  readonly modelTier: ModelTier;
  readonly nexusPreResearchRequired: boolean;
  readonly humanApprovalRequired: boolean;
  readonly approvalRiskThreshold: number;
}

export interface GovernanceValidation {
  readonly status: "match" | "mismatch" | "escalation_needed";
  readonly notes: string;
  readonly maxDelegationRisk: number;
  readonly maxDelegationComplexity: number;
}

interface GovernanceInputData {
  readonly forgeFeedback: FeedbackSummary;
  readonly recurrentFailures: readonly string[];
  readonly avgRisk: number;
  readonly budgetUsedPercent: number;
  readonly avgTokensPerExecution: number;
}

export function classifyGovernance(
  goals: readonly Goal[],
  data: GovernanceInputData,
): GovernanceClassification {
  const reasons: string[] = [];

  const complexity = computeComplexity(goals, reasons);
  const risk = computeRisk(data, reasons);
  const cost = computeCost(data, reasons);
  const historicalStability = computeStability(data, reasons);

  logger.info(
    { complexity, risk, cost, historicalStability },
    "Governance classification computed",
  );

  return { complexity, risk, cost, historicalStability, reasons };
}

export function selectGovernancePolicy(
  classification: GovernanceClassification,
): GovernanceDecision {
  const { complexity, risk, historicalStability } = classification;

  let selectedModel: string;
  let modelTier: ModelTier;
  let nexusPreResearchRequired: boolean;
  let humanApprovalRequired: boolean;
  let approvalRiskThreshold: number;

  if (risk >= CRITICAL_RISK_THRESHOLD) {
    selectedModel = PREMIUM_MODEL;
    modelTier = "premium";
    nexusPreResearchRequired = true;
    humanApprovalRequired = true;
    approvalRiskThreshold = 3;
  } else if (
    complexity >= HIGH_COMPLEXITY_THRESHOLD ||
    risk >= HIGH_RISK_THRESHOLD ||
    historicalStability === "unstable"
  ) {
    selectedModel = PREMIUM_MODEL;
    modelTier = "premium";
    nexusPreResearchRequired = true;
    humanApprovalRequired = risk >= HIGH_RISK_THRESHOLD;
    approvalRiskThreshold = 3;
  } else if (complexity <= 2 && risk <= 2 && historicalStability === "stable") {
    selectedModel = ECONOMY_MODEL;
    modelTier = "economy";
    nexusPreResearchRequired = false;
    humanApprovalRequired = false;
    approvalRiskThreshold = 4;
  } else {
    selectedModel = STANDARD_MODEL;
    modelTier = "standard";
    nexusPreResearchRequired = false;
    humanApprovalRequired = false;
    approvalRiskThreshold = 4;
  }

  logger.info(
    { selectedModel, modelTier, nexusPreResearchRequired, humanApprovalRequired },
    "Governance policy selected",
  );

  return {
    classification,
    selectedModel,
    modelTier,
    nexusPreResearchRequired,
    humanApprovalRequired,
    approvalRiskThreshold,
  };
}

export function postValidateGovernance(
  kairosOutput: KairosOutput,
  governance: GovernanceDecision,
): GovernanceValidation {
  const delegations = kairosOutput.delegations;

  if (delegations.length === 0) {
    return {
      status: "match",
      notes: "No delegations to validate",
      maxDelegationRisk: 0,
      maxDelegationComplexity: 0,
    };
  }

  const maxDelegationRisk = Math.max(...delegations.map((d) => d.decision_metrics.risk));
  const maxDelegationComplexity = Math.max(
    ...delegations.map((d) => d.decision_metrics.impact),
  );

  const preRisk = governance.classification.risk;
  const preComplexity = governance.classification.complexity;

  const riskMismatch = maxDelegationRisk >= HIGH_RISK_THRESHOLD && preRisk < HIGH_RISK_THRESHOLD;
  const complexityMismatch =
    maxDelegationComplexity >= HIGH_COMPLEXITY_THRESHOLD && preComplexity < HIGH_COMPLEXITY_THRESHOLD;

  if (riskMismatch || complexityMismatch) {
    const reasons: string[] = [];
    if (riskMismatch) {
      reasons.push(`KAIROS risk=${maxDelegationRisk} but pre-classification risk=${preRisk}`);
    }
    if (complexityMismatch) {
      reasons.push(
        `KAIROS complexity=${maxDelegationComplexity} but pre-classification complexity=${preComplexity}`,
      );
    }

    const needsEscalation =
      maxDelegationRisk >= CRITICAL_RISK_THRESHOLD && governance.modelTier !== "premium";

    logger.warn({ reasons, needsEscalation }, "Governance post-validation mismatch");

    return {
      status: needsEscalation ? "escalation_needed" : "mismatch",
      notes: reasons.join("; "),
      maxDelegationRisk,
      maxDelegationComplexity,
    };
  }

  return {
    status: "match",
    notes: "Pre-classification aligned with KAIROS output",
    maxDelegationRisk,
    maxDelegationComplexity,
  };
}

export function loadGovernanceInputData(db: BetterSqlite3.Database): GovernanceInputData {
  const forgeFeedback = getFeedbackSummary(db, "forge", 7);
  const recurrentFailures = getRecurrentFailurePatterns(db, "forge", 7);
  const summary = getAgentSummary(db, "forge", 7);
  const budget = getCurrentBudget(db);
  const budgetConfig = loadBudgetConfig();

  const totalTokens = budget?.total_tokens ?? budgetConfig.monthlyTokenLimit;
  const usedTokens = budget?.used_tokens ?? 0;
  const budgetUsedPercent = totalTokens > 0 ? (usedTokens / totalTokens) * 100 : 0;

  const avgTokensPerExecution = computeAvgTokensPerExecution(db);

  const avgRisk = computeAvgRiskFromOutcomes(db, summary.totalExecutions);

  return {
    forgeFeedback,
    recurrentFailures,
    avgRisk,
    budgetUsedPercent,
    avgTokensPerExecution,
  };
}

export function resolveNexusPreResearchContext(
  db: BetterSqlite3.Database,
  goals: readonly Goal[],
): string {
  const goalIds = goals.map((g) => g.id);

  for (const goalId of goalIds) {
    const research = getResearchByGoalId(db, goalId);
    if (research.length > 0) {
      const recent = research[0];
      if (recent && isRecentResearch(recent)) {
        return formatNexusPreContext(recent);
      }
    }
  }

  const recentResearch = getRecentResearch(db, NEXUS_RESEARCH_RECENT_DAYS);
  if (recentResearch.length > 0 && recentResearch[0]) {
    return formatNexusPreContext(recentResearch[0]);
  }

  return "";
}

function isRecentResearch(research: NexusResearch): boolean {
  const createdAt = new Date(research.created_at);
  const now = new Date();
  const diffMs = now.getTime() - createdAt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= NEXUS_RESEARCH_RECENT_DAYS;
}

function formatNexusPreContext(research: NexusResearch): string {
  const lines = [
    "NEXUS_PRE_RESEARCH:",
    `- Pergunta: ${truncate(research.question, 80)}`,
    `- Recomendacao: ${truncate(research.recommendation, 120)}`,
    `- Riscos: ${truncate(research.risk_analysis, 120)}`,
  ];

  const text = lines.join("\n");
  if (text.length > MAX_NEXUS_CONTEXT_CHARS) {
    return text.slice(0, MAX_NEXUS_CONTEXT_CHARS);
  }
  return text;
}

function computeComplexity(goals: readonly Goal[], reasons: string[]): number {
  let score = 1;

  if (goals.length >= 3) {
    score += 1;
    reasons.push(`${goals.length} goals ativos`);
  }

  const maxPriority = goals.reduce((max, g) => Math.max(max, g.priority), 0);
  if (maxPriority >= HIGH_PRIORITY_THRESHOLD) {
    score += 1;
    reasons.push(`Prioridade maxima: ${maxPriority}`);
  }

  const hasArchitectural = goals.some((g) => {
    const text = `${g.title} ${g.description ?? ""}`.toLowerCase();
    return ARCHITECTURAL_KEYWORDS.some((kw) => text.includes(kw));
  });

  if (hasArchitectural) {
    score += 2;
    reasons.push("Goal arquitetural detectado");
  }

  return Math.min(5, score);
}

function computeRisk(data: GovernanceInputData, reasons: string[]): number {
  let score = 1;

  const { forgeFeedback, recurrentFailures, avgRisk } = data;

  if (forgeFeedback.successRate < UNSTABLE_SUCCESS_RATE_THRESHOLD && forgeFeedback.total > 0) {
    score += 2;
    reasons.push(`Taxa de sucesso baixa: ${forgeFeedback.successRate.toFixed(0)}%`);
  } else if (forgeFeedback.successRate < STABLE_SUCCESS_RATE_THRESHOLD && forgeFeedback.total > 0) {
    score += 1;
    reasons.push(`Taxa de sucesso moderada: ${forgeFeedback.successRate.toFixed(0)}%`);
  }

  if (recurrentFailures.length >= RECURRENT_FAILURE_THRESHOLD) {
    score += 1;
    reasons.push(`${recurrentFailures.length} padroes de falha recorrentes`);
  }

  if (avgRisk >= 3) {
    score += 1;
    reasons.push(`Risco medio observado: ${avgRisk.toFixed(1)}`);
  }

  return Math.min(5, score);
}

function computeCost(data: GovernanceInputData, reasons: string[]): number {
  let score = 1;

  if (data.budgetUsedPercent >= BUDGET_HIGH_USAGE_PERCENT) {
    score += 2;
    reasons.push(`Budget usado: ${data.budgetUsedPercent.toFixed(0)}%`);
  } else if (data.budgetUsedPercent >= 50) {
    score += 1;
    reasons.push(`Budget usado: ${data.budgetUsedPercent.toFixed(0)}%`);
  }

  if (data.avgTokensPerExecution > 10_000) {
    score += 1;
    reasons.push(`Media tokens/execucao: ${data.avgTokensPerExecution.toFixed(0)}`);
  }

  return Math.min(5, score);
}

function computeStability(
  data: GovernanceInputData,
  reasons: string[],
): HistoricalStability {
  const { forgeFeedback, recurrentFailures } = data;

  if (forgeFeedback.total === 0) {
    reasons.push("Sem historico de execucoes");
    return "moderate";
  }

  if (
    forgeFeedback.successRate >= STABLE_SUCCESS_RATE_THRESHOLD &&
    recurrentFailures.length === 0
  ) {
    reasons.push("Historico estavel");
    return "stable";
  }

  if (
    forgeFeedback.successRate < UNSTABLE_SUCCESS_RATE_THRESHOLD ||
    recurrentFailures.length >= RECURRENT_FAILURE_THRESHOLD
  ) {
    reasons.push("Historico instavel");
    return "unstable";
  }

  reasons.push("Historico moderado");
  return "moderate";
}

function computeAvgTokensPerExecution(db: BetterSqlite3.Database): number {
  const row = db
    .prepare(
      `SELECT AVG(tokens_used) as avg_tokens
       FROM outcomes
       WHERE tokens_used IS NOT NULL
         AND created_at >= datetime('now', '-7 days')`,
    )
    .get() as { avg_tokens: number | null };

  return row.avg_tokens ?? 0;
}

function computeAvgRiskFromOutcomes(
  db: BetterSqlite3.Database,
  _totalExecutions: number,
): number {
  const row = db
    .prepare(
      `SELECT AVG(risk) as avg_risk
       FROM code_changes
       WHERE created_at >= datetime('now', '-7 days')
         AND status IN ('applied', 'failed', 'rolled_back')`,
    )
    .get() as { avg_risk: number | null };

  return row.avg_risk ?? 0;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}
