import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../../config/budget.js";
import { logger } from "../../config/logger.js";
import { logAudit, hashContent } from "../../state/auditLog.js";
import { incrementUsedTokens } from "../../state/budgets.js";
import { recordTokenUsage } from "../../state/tokenUsage.js";
import type { ForgeAgentContext } from "./forgeTypes.js";
import { CHARS_PER_TOKEN_ESTIMATE } from "./forgeTypes.js";
import { callOpenClaw } from "../shared/openclawClient.js";
import type { TokenUsageInfo, OpenClawResult } from "../shared/openclawClient.js";

export interface LlmCallResult {
  readonly text: string;
  readonly tokensUsed: number;
}

export type LlmCallOutcome =
  | { readonly status: "success"; readonly result: LlmCallResult }
  | { readonly status: "infra_failure"; readonly message: string }
  | { readonly status: "request_failure"; readonly message: string };

export async function callLlmWithAudit(
  ctx: ForgeAgentContext,
  systemPrompt: string,
  userPrompt: string,
  actionLabel: string,
): Promise<LlmCallResult | null> {
  const outcome = await callLlmClassified(ctx, systemPrompt, userPrompt, actionLabel);

  if (outcome.status === "infra_failure") {
    logger.error({ message: outcome.message, traceId: ctx.traceId }, "LLM call failed (infra)");
    return null;
  }

  if (outcome.status === "request_failure") {
    logger.warn({ message: outcome.message, traceId: ctx.traceId }, "LLM call failed (request)");
    return null;
  }

  return outcome.result;
}

export async function callLlmClassified(
  ctx: ForgeAgentContext,
  systemPrompt: string,
  userPrompt: string,
  actionLabel: string,
): Promise<LlmCallOutcome> {
  const openClawResult: OpenClawResult = await callOpenClaw({
    agentId: "forge",
    prompt: userPrompt,
    systemPrompt,
    traceId: ctx.traceId,
  });

  if (!openClawResult.ok) {
    const { kind, message } = openClawResult.error;

    if (kind === "infra" || kind === "auth") {
      return { status: "infra_failure", message };
    }

    logAudit(ctx.db, {
      agent: "forge",
      action: `${actionLabel}: ${ctx.delegation.task.slice(0, 80)}`,
      inputHash: hashContent(userPrompt),
      outputHash: null,
      sanitizerWarnings: [`openclaw_request_error: ${message}`],
      runtime: "openclaw",
    });

    return { status: "request_failure", message };
  }

  const response = openClawResult.response;

  if (response.status === "failed") {
    return { status: "request_failure", message: "OpenClaw returned status: failed" };
  }

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

  return {
    status: "success",
    result: { text: response.text, tokensUsed: usage.totalTokens },
  };
}

function resolveUsage(
  usage: TokenUsageInfo | undefined,
  responseText: string,
  prompt: string,
): TokenUsageInfo {
  if (usage && usage.totalTokens > 0) return usage;

  logger.warn("OpenClaw did not return valid token usage, using estimate");
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
