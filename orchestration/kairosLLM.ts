import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../config/logger.js";
import { callLLM, createLLMConfig } from "../llm/client.js";
import type { Goal } from "../state/goals.js";
import type { RecentDecision } from "../state/decisions.js";
import type { KairosOutput } from "./types.js";

const SYSTEM_PROMPT_PATH = resolve("agents/kairos/SYSTEM.md");

export async function callKairosLLM(
  goals: readonly Goal[],
  recentDecisions: readonly RecentDecision[],
): Promise<KairosOutput> {
  const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  logger.info({ chars: systemPrompt.length }, "System prompt loaded");

  const userMessage = buildUserMessage(goals, recentDecisions);
  logger.info({ goalsCount: goals.length, decisionsCount: recentDecisions.length }, "Prompt built");

  const config = createLLMConfig();
  const rawText = await callLLM(config, { system: systemPrompt, userMessage });

  return parseJSON(rawText);
}

function buildUserMessage(
  goals: readonly Goal[],
  recentDecisions: readonly RecentDecision[],
): string {
  const goalsBlock = goals.map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    priority: g.priority,
  }));

  const decisionsBlock = recentDecisions.map((d) => ({
    agent: d.agent_id,
    reasoning: d.reasoning,
    created_at: d.created_at,
  }));

  const parts = [`## Active Goals\n${JSON.stringify(goalsBlock, null, 2)}`];

  if (recentDecisions.length > 0) {
    parts.push(`## Recent Decisions\n${JSON.stringify(decisionsBlock, null, 2)}`);
  }

  parts.push("Analyze the goals above and return your JSON decision.");

  return parts.join("\n\n");
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
