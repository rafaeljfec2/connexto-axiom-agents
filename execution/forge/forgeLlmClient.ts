import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../../config/budget.js";
import { logger } from "../../config/logger.js";
import { logAudit, hashContent } from "../../state/auditLog.js";
import { incrementUsedTokens } from "../../state/budgets.js";
import { recordTokenUsage } from "../../state/tokenUsage.js";
import type { ForgeAgentContext } from "./forgeTypes.js";
import { CHARS_PER_TOKEN_ESTIMATE } from "./forgeTypes.js";
import { callOpenClaw } from "../shared/openclawClient.js";
import type { TokenUsageInfo } from "../shared/openclawClient.js";

export interface LlmCallResult {
  readonly text: string;
  readonly tokensUsed: number;
}

export async function callLlmWithAudit(
  ctx: ForgeAgentContext,
  systemPrompt: string,
  userPrompt: string,
  actionLabel: string,
): Promise<LlmCallResult | null> {
  const response = await callOpenClaw({
    agentId: "forge",
    prompt: userPrompt,
    systemPrompt,
  });

  if (response.status === "failed") return null;

  const usage = resolveUsage(response.usage, response.text, userPrompt);
  recordForgeUsage(ctx.db, ctx.delegation.goal_id, usage);

  logAudit(ctx.db, {
    agent: "forge",
    action: `${actionLabel}: ${ctx.delegation.task.slice(0, 80)}`,
    inputHash: hashContent(userPrompt),
    outputHash: hashContent(response.text),
    sanitizerWarnings: [],
    runtime: "openclaw",
  });

  return { text: response.text, tokensUsed: usage.totalTokens };
}

function resolveUsage(
  usage: TokenUsageInfo | undefined,
  responseText: string,
  prompt: string,
): TokenUsageInfo {
  if (usage) return usage;

  logger.warn("OpenClaw did not return token usage, using estimate");
  const inputTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN_ESTIMATE);
  const outputTokens = Math.ceil(responseText.length / CHARS_PER_TOKEN_ESTIMATE);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function recordForgeUsage(
  db: BetterSqlite3.Database,
  goalId: string,
  usage: TokenUsageInfo,
): void {
  const budgetConfig = loadBudgetConfig();

  recordTokenUsage(db, {
    agentId: "forge",
    taskId: goalId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  });

  const now = new Date();
  const period = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  incrementUsedTokens(db, period, usage.totalTokens);

  logger.info(
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      perTaskLimit: budgetConfig.perTaskTokenLimit,
    },
    "FORGE agent loop token usage recorded",
  );
}
