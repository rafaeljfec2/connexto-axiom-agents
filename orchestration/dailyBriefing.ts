import type { KairosOutput, FilteredDelegations } from "./types.js";

export function formatDailyBriefing(output: KairosOutput, filtered: FilteredDelegations): string {
  const decisions =
    output.decisions_needed.length > 0
      ? output.decisions_needed.map((d) => `- ${d.action}: ${d.reasoning}`).join("\n")
      : "- None.";

  const approved =
    filtered.approved.length > 0
      ? filtered.approved
          .map((d) => {
            const m = d.decision_metrics;
            return `- ${d.agent}: ${d.task} [I:${m.impact} C:${m.cost} R:${m.risk}]`;
          })
          .join("\n")
      : "- None.";

  const pending =
    filtered.needsApproval.length > 0
      ? filtered.needsApproval
          .map((d) => {
            const m = d.decision_metrics;
            return `- ${d.agent}: ${d.task} [R:${m.risk} C:${m.cost}]`;
          })
          .join("\n")
      : "- None.";

  const rejected =
    filtered.rejected.length > 0
      ? filtered.rejected.map((r) => `- ${r.delegation.task}: ${r.reason}`).join("\n")
      : "- None.";

  const lines = [
    String.raw`*\[KAIROS — Daily Briefing]*`,
    "",
    "*Resumo:*",
    `- ${output.briefing}`,
    "",
    "*Decisoes:*",
    decisions,
    "",
    "*Delegacoes aprovadas:*",
    approved,
    "",
    "*Aguardando aprovacao:*",
    pending,
    "",
    "*Descartadas:*",
    rejected,
    "",
    "*Foco 24h:*",
    `- ${output.next_24h_focus}`,
  ];

  return lines.join("\n");
}
