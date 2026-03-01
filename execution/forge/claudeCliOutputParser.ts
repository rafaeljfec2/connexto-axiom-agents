import type { ClaudeCliJsonOutput, ClaudeStreamEvent } from "./claudeCliTypes.js";

export interface TokenUsageBreakdown {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly totalTokens: number;
}

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

export function extractTokenUsageBreakdown(output: ClaudeCliJsonOutput): TokenUsageBreakdown {
  if (output.modelUsage) {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

    for (const model of Object.values(output.modelUsage)) {
      inputTokens += model.inputTokens ?? 0;
      outputTokens += model.outputTokens ?? 0;
      cacheReadTokens += model.cacheReadInputTokens ?? 0;
      cacheCreationTokens += model.cacheCreationInputTokens ?? 0;
    }

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    };
  }

  if (!output.usage) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 };
  }

  const inputTokens = output.usage.input_tokens ?? 0;
  const outputTokens = output.usage.output_tokens ?? 0;
  const cacheReadTokens = output.usage.cache_read_input_tokens ?? 0;
  const cacheCreationTokens = output.usage.cache_creation_input_tokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
  };
}

export function extractTokensUsed(output: ClaudeCliJsonOutput): number {
  return extractTokenUsageBreakdown(output).totalTokens;
}

export function extractCostUsd(output: ClaudeCliJsonOutput): number {
  return output.total_cost_usd ?? 0;
}

export function extractInputOutputTokens(output: ClaudeCliJsonOutput): {
  readonly inputTokens: number;
  readonly outputTokens: number;
} {
  const breakdown = extractTokenUsageBreakdown(output);
  return {
    inputTokens: breakdown.inputTokens + breakdown.cacheReadTokens + breakdown.cacheCreationTokens,
    outputTokens: breakdown.outputTokens,
  };
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
