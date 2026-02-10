import type { ExecutionResult } from "../execution/types.js";
import type { KairosOutput, FilteredDelegations } from "./types.js";

export function formatDailyBriefing(
  output: KairosOutput,
  filtered: FilteredDelegations,
  executions: readonly ExecutionResult[],
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

  const executionLines =
    executions.length > 0
      ? executions
          .map((e) => {
            const tag = e.status === "success" ? "SUCESSO" : "FALHA";
            const detail = e.status === "success" ? e.output : e.error;
            return `- [${tag}] ${e.task} -> ${detail}`;
          })
          .join("\n")
      : "- Nenhuma.";

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
    executionLines,
    "",
    "*Foco nas proximas 24h:*",
    `- ${output.next_24h_focus}`,
  ];

  return lines.join("\n");
}
