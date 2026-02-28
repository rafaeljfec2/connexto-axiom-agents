import type { ClaudeCliJsonOutput, ClaudeStreamEvent } from "./claudeCliTypes.js";

export function parseClaudeCliOutput(rawOutput: string): ClaudeCliJsonOutput {
  const trimmed = rawOutput.trim();

  if (!trimmed) {
    return { result: "", is_error: true };
  }

  const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as ClaudeCliJsonOutput;
      if (parsed.type === "result") {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  try {
    return JSON.parse(trimmed) as ClaudeCliJsonOutput;
  } catch {
    return { result: trimmed, is_error: false };
  }
}

export function extractTokensUsed(output: ClaudeCliJsonOutput): number {
  if (output.modelUsage) {
    let total = 0;
    for (const model of Object.values(output.modelUsage)) {
      total += (model.inputTokens ?? 0)
        + (model.outputTokens ?? 0)
        + (model.cacheReadInputTokens ?? 0)
        + (model.cacheCreationInputTokens ?? 0);
    }
    return total;
  }

  if (!output.usage) return 0;
  return (output.usage.input_tokens ?? 0)
    + (output.usage.output_tokens ?? 0)
    + (output.usage.cache_creation_input_tokens ?? 0)
    + (output.usage.cache_read_input_tokens ?? 0);
}

export function extractCostUsd(output: ClaudeCliJsonOutput): number {
  return output.total_cost_usd ?? 0;
}

export function parseStreamLine(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ClaudeStreamEvent;
  } catch {
    return null;
  }
}
