import type { KairosOutput } from "./types.js";

export function formatDailyBriefing(output: KairosOutput): string {
  const decisions =
    output.decisions_needed.length > 0
      ? output.decisions_needed.map((d) => `- ${d.action}: ${d.reasoning}`).join("\n")
      : "- No pending decisions.";

  const lines = [
    String.raw`*\[KAIROS — Daily Briefing]*`,
    "",
    "*Resumo:*",
    `- ${output.briefing}`,
    "",
    "*Decisoes:*",
    decisions,
    "",
    "*Foco 24h:*",
    `- ${output.next_24h_focus}`,
  ];

  return lines.join("\n");
}
