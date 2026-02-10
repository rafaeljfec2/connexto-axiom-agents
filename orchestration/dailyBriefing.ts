import type { ExecutionResult } from "../execution/types.js";
import type {
  KairosOutput,
  FilteredDelegations,
  BudgetInfo,
  EfficiencyInfo,
  FeedbackInfo,
  VectorInfo,
} from "./types.js";

export function formatDailyBriefing(
  output: KairosOutput,
  filtered: FilteredDelegations,
  forgeExecutions: readonly ExecutionResult[],
  budgetInfo: BudgetInfo,
  efficiencyInfo: EfficiencyInfo,
  feedbackInfo: FeedbackInfo,
  vectorInfo: VectorInfo,
): string {
  const decisions =
    output.decisions_needed.length > 0
      ? output.decisions_needed.map((d) => `- ${d.action}: ${d.reasoning}`).join("\n")
      : "- Nenhuma.";

  const approved =
    filtered.approved.length > 0
      ? filtered.approved
          .map((d) => {
            const m = d.decision_metrics;
            return `- ${d.agent}: ${d.task} [I:${m.impact} C:${m.cost} R:${m.risk}]`;
          })
          .join("\n")
      : "- Nenhuma.";

  const pending =
    filtered.needsApproval.length > 0
      ? filtered.needsApproval
          .map((d) => {
            const m = d.decision_metrics;
            return `- ${d.agent}: ${d.task} [R:${m.risk} C:${m.cost}]`;
          })
          .join("\n")
      : "- Nenhuma.";

  const rejected =
    filtered.rejected.length > 0
      ? filtered.rejected.map((r) => `- ${r.delegation.task}: ${r.reason}`).join("\n")
      : "- Nenhuma.";

  const forgeExecutionLines = formatExecutionLines(forgeExecutions);
  const vectorSection = formatVectorSection(vectorInfo);

  const budgetSection = formatBudgetSection(budgetInfo);
  const efficiencySection = formatEfficiencySection(efficiencyInfo);
  const feedbackSection = formatFeedbackSection(feedbackInfo);

  const lines = [
    String.raw`*\[KAIROS — Briefing Diario]*`,
    "",
    "*Resumo:*",
    `- ${output.briefing}`,
    "",
    String.raw`*Decisoes pendentes:*`,
    decisions,
    "",
    String.raw`*Delegacoes aprovadas:*`,
    approved,
    "",
    String.raw`*Aguardando aprovacao:*`,
    pending,
    "",
    "*Descartadas:*",
    rejected,
    "",
    String.raw`*Execucoes FORGE:*`,
    forgeExecutionLines,
    "",
    ...vectorSection,
    "",
    ...budgetSection,
    "",
    ...efficiencySection,
    "",
    ...feedbackSection,
    "",
    "*Foco nas proximas 24h:*",
    `- ${output.next_24h_focus}`,
  ];

  return lines.join("\n");
}

function formatExecutionLines(executions: readonly ExecutionResult[]): string {
  if (executions.length === 0) {
    return "- Nenhuma.";
  }

  return executions
    .map((e) => {
      const tag = e.status === "success" ? "SUCESSO" : "FALHA";
      const detail = e.status === "success" ? e.output : e.error;
      return `- [${tag}] ${e.task} -> ${detail}`;
    })
    .join("\n");
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function getBudgetStatusLine(info: BudgetInfo): string {
  if (info.isExhausted) {
    return "- CRITICO: Kill switch ativo — FORGE em modo read-only";
  }
  if (info.percentRemaining < 20) {
    return "- AVISO: Menos de 20% do orcamento restante";
  }
  return "- Status: OK";
}

function formatBudgetSection(info: BudgetInfo): readonly string[] {
  const tokenLine = `- Tokens usados: ${formatNumber(info.usedTokens)} / ${formatNumber(info.totalTokens)} (${info.percentRemaining.toFixed(1)}% restante)`;
  const statusLine = getBudgetStatusLine(info);

  const header = [String.raw`*Orcamento LLM:*`, tokenLine, statusLine];

  if (info.blockedTasks.length === 0) {
    return header;
  }

  const blockedLines = info.blockedTasks.map((b) => `- ${b.task}: ${b.reason}`);

  return [...header, "", String.raw`*Execucoes bloqueadas:*`, ...blockedLines];
}

function formatEfficiencySection(info: EfficiencyInfo): readonly string[] {
  const cycleLine = `- Tokens neste ciclo: ${formatNumber(info.cycleTotalTokens)} (input: ${formatNumber(info.cycleInputTokens)}, output: ${formatNumber(info.cycleOutputTokens)})`;
  const perDecisionLine = `- Tokens/decisao: ${formatNumber(info.tokensPerDecision)}`;
  const avg7dLine = `- Media 7d: ${formatNumber(info.avg7dTokensPerDecision)} tokens/decisao`;

  return [String.raw`*Eficiencia LLM:*`, cycleLine, perDecisionLine, avg7dLine];
}

function formatVectorSection(info: VectorInfo): readonly string[] {
  const header = String.raw`*Execucoes VECTOR:*`;

  const executionLines =
    info.executionResults.length > 0
      ? info.executionResults
          .map((e) => {
            const tag = e.status === "success" ? "SUCESSO" : "FALHA";
            const detail = e.status === "success" ? e.output : e.error;
            return `- [${tag}] ${e.task} -> ${detail}`;
          })
          .join("\n")
      : "- Nenhuma.";

  const draftsLine = `- Drafts aguardando aprovacao: ${formatNumber(info.pendingDraftsCount)}`;

  return [header, executionLines, draftsLine];
}

function formatFeedbackSection(info: FeedbackInfo): readonly string[] {
  const forgeLine = `- FORGE: ${info.forgeSuccessRate7d.toFixed(1)}% sucesso (${formatNumber(info.forgeTotalExecutions7d)} exec)`;
  const vectorLine = `- VECTOR: ${info.vectorSuccessRate7d.toFixed(1)}% sucesso (${formatNumber(info.vectorTotalExecutions7d)} exec)`;
  const adjustmentsLine = `- Ajustes aplicados: ${formatNumber(info.adjustmentsApplied)}`;

  const lines: string[] = [String.raw`*Feedback (7d):*`, forgeLine, vectorLine, adjustmentsLine];

  if (info.problematicTasks.length > 0) {
    lines.push(`- Tasks problematicas: ${info.problematicTasks.join(", ")}`);
  }

  return lines;
}
