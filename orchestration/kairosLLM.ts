import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { config as kairosAgentConfig } from "../agents/kairos/config.js";
import { callLLM, createLLMConfig } from "../llm/client.js";
import type { LLMUsage } from "../llm/client.js";
import type { Goal } from "../state/goals.js";
import type { RecentDecision } from "../state/decisions.js";
import { compressState } from "./stateCompressor.js";
import { buildHistoricalContext } from "./historicalContext.js";
import type { KairosOutput } from "./types.js";

const SYSTEM_PROMPT_PATH = resolve("agents/kairos/SYSTEM.md");
const CHARS_PER_TOKEN_ESTIMATE = 4;

let cachedSystemPrompt: string | null = null;

export interface KairosLLMResult {
  readonly output: KairosOutput;
  readonly usage: LLMUsage;
}

function loadSystemPrompt(): string {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  }
  return cachedSystemPrompt;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export interface KairosLLMOptions {
  readonly modelOverride?: string;
  readonly nexusPreContext?: string;
  readonly governanceContext?: string;
}

export async function callKairosLLM(
  goals: readonly Goal[],
  recentDecisions: readonly RecentDecision[],
  db: BetterSqlite3.Database,
  options?: KairosLLMOptions,
): Promise<KairosLLMResult> {
  const systemPrompt = loadSystemPrompt();
  logger.info({ chars: systemPrompt.length }, "System prompt loaded");

  const compressed = compressState(goals, recentDecisions, options?.governanceContext);
  const historicalBlock = buildHistoricalContext(db, "forge");
  let userMessage = injectHistoricalContext(compressed.inputText, historicalBlock);

  if (options?.nexusPreContext && options.nexusPreContext.length > 0) {
    userMessage = injectNexusPreContext(userMessage, options.nexusPreContext);
  }

  logger.info(
    {
      goalsCount: goals.length,
      decisionsCount: recentDecisions.length,
      historicalChars: historicalBlock.length,
      nexusPreContextChars: options?.nexusPreContext?.length ?? 0,
      modelOverride: options?.modelOverride ?? "none",
    },
    "Prompt built with context",
  );

  const budgetConfig = loadBudgetConfig();
  const estimatedInputTokens = estimateTokens(systemPrompt + userMessage);

  if (estimatedInputTokens > budgetConfig.kairosMaxInputTokens) {
    throw new Error(
      `Input token estimate (${estimatedInputTokens}) exceeds limit (${budgetConfig.kairosMaxInputTokens})`,
    );
  }

  logger.info({ estimatedInputTokens }, "Token estimate within limit");

  const config = createKairosLLMConfig(options?.modelOverride);
  const response = await callLLM(config, {
    system: systemPrompt,
    userMessage,
    maxOutputTokens: budgetConfig.kairosMaxOutputTokens,
  });

  const output = parseJSON(response.text);

  return { output, usage: response.usage };
}

function createKairosLLMConfig(modelOverride?: string): ReturnType<typeof createLLMConfig> {
  const baseConfig = createLLMConfig();
  const model = modelOverride ?? kairosAgentConfig.llmModel;

  if (model === "placeholder" || model.length === 0) return baseConfig;

  logger.info({ model, overridden: !!modelOverride }, "Using KAIROS LLM model");

  return { ...baseConfig, model };
}

function injectNexusPreContext(inputText: string, nexusContext: string): string {
  if (nexusContext.length === 0) return inputText;

  return inputText.replace("CONSTRAINTS:", `${nexusContext}\n\nCONSTRAINTS:`);
}

function injectHistoricalContext(inputText: string, historicalBlock: string): string {
  if (historicalBlock.length === 0) return inputText;

  return inputText.replace("CONSTRAINTS:", `${historicalBlock}\n\nCONSTRAINTS:`);
}

function parseJSON(text: string): KairosOutput {
  const trimmed = text.trim();

  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`LLM response is not valid JSON: ${trimmed.slice(0, 100)}`);
  }

  const jsonString = trimmed.slice(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(jsonString) as KairosOutput;
  } catch {
    throw new Error(`Failed to parse LLM JSON: ${jsonString.slice(0, 100)}`);
  }
}
