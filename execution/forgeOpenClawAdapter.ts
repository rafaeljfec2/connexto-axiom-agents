import fs from "node:fs/promises";
import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import type { KairosDelegation } from "../orchestration/types.js";
import { logAudit, hashContent } from "../state/auditLog.js";
import { incrementUsedTokens } from "../state/budgets.js";
import { recordTokenUsage } from "../state/tokenUsage.js";
import type { ExecutionResult } from "./types.js";
import { callOpenClaw } from "./openclawClient.js";
import type { TokenUsageInfo } from "./openclawClient.js";
import { sanitizeOutput } from "./outputSanitizer.js";
import { ensureSandbox, resolveSandboxPath, validateSandboxLimits } from "./sandbox.js";

export async function executeForgeViaOpenClaw(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
): Promise<ExecutionResult> {
  const { task, goal_id, expected_output } = delegation;

  const startTime = performance.now();

  try {
    const prompt = buildPrompt(task, expected_output, goal_id);

    const response = await callOpenClaw({
      agentId: "forge",
      prompt,
      systemPrompt: FORGE_INSTRUCTIONS,
    });

    if (response.status === "failed") {
      const executionTimeMs = Math.round(performance.now() - startTime);
      logAudit(db, {
        agent: "forge",
        action: task,
        inputHash: hashContent(prompt),
        outputHash: null,
        sanitizerWarnings: [],
        runtime: "openclaw",
      });
      return { ...buildFailedResult(task, "OpenClaw returned status: failed"), executionTimeMs };
    }

    const usage = resolveUsage(response.usage, response.text, prompt);

    const budgetConfig = loadBudgetConfig();
    if (usage.totalTokens > budgetConfig.perTaskTokenLimit) {
      const executionTimeMs = Math.round(performance.now() - startTime);
      logger.error(
        { totalTokens: usage.totalTokens, limit: budgetConfig.perTaskTokenLimit },
        "Per-task token limit exceeded",
      );
      logAudit(db, {
        agent: "forge",
        action: task,
        inputHash: hashContent(prompt),
        outputHash: null,
        sanitizerWarnings: [
          `per_task_limit_exceeded: ${usage.totalTokens}/${budgetConfig.perTaskTokenLimit}`,
        ],
        runtime: "openclaw",
      });
      return {
        ...buildFailedResult(
          task,
          `Limite de tokens por task excedido (${usage.totalTokens}/${budgetConfig.perTaskTokenLimit})`,
        ),
        tokensUsed: usage.totalTokens,
        executionTimeMs,
      };
    }

    const currentPeriod = getCurrentPeriod();
    recordTokenUsage(db, {
      agentId: "forge",
      taskId: goal_id,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    });
    incrementUsedTokens(db, currentPeriod, usage.totalTokens);

    logger.info(
      {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      },
      "Token usage recorded",
    );

    const sanitized = sanitizeOutput(response.text);

    if (sanitized.warnings.length > 0) {
      logger.warn({ warnings: sanitized.warnings }, "Output sanitizer applied corrections");
    }

    await ensureSandbox();
    await validateSandboxLimits();

    const filename = slugify(task) + ".md";
    const filePath = resolveSandboxPath(filename);
    await fs.writeFile(filePath, sanitized.content, "utf-8");

    const executionTimeMs = Math.round(performance.now() - startTime);
    const artifactSizeBytes = Buffer.byteLength(sanitized.content, "utf-8");

    logger.info(
      { file: filePath, executionTimeMs, artifactSizeBytes },
      "Forge (OpenClaw) created file",
    );

    logAudit(db, {
      agent: "forge",
      action: task,
      inputHash: hashContent(prompt),
      outputHash: hashContent(sanitized.content),
      sanitizerWarnings: sanitized.warnings,
      runtime: "openclaw",
    });

    return {
      agent: "forge",
      task,
      status: "success",
      output: filePath,
      tokensUsed: usage.totalTokens,
      executionTimeMs,
      artifactSizeBytes,
    };
  } catch (error) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task, executionTimeMs }, "Forge (OpenClaw) execution failed");

    logAudit(db, {
      agent: "forge",
      action: task,
      inputHash: hashContent(task),
      outputHash: null,
      sanitizerWarnings: [`execution_error: ${message}`],
      runtime: "openclaw",
    });

    return { ...buildFailedResult(task, message), executionTimeMs };
  }
}

const FORGE_INSTRUCTIONS = [
  "Voce e o FORGE, um agente executor do sistema connexto-axiom.",
  "Gere um documento Markdown completo e detalhado em portugues brasileiro (pt-BR).",
  "O documento deve ser tecnico, bem estruturado, com secoes claras.",
  "Responda APENAS com o conteudo Markdown do documento, sem explicacoes adicionais.",
].join(" ");

function buildPrompt(task: string, expectedOutput: string, goalId: string): string {
  const timestamp = new Date().toISOString();

  return [
    `Tarefa: ${task}`,
    `Resultado esperado: ${expectedOutput}`,
    `Goal ID: ${goalId}`,
    `Data: ${timestamp}`,
    "",
    "Gere o documento Markdown completo agora.",
  ].join("\n");
}

function buildFailedResult(task: string, error: string): ExecutionResult {
  return {
    agent: "forge",
    task,
    status: "failed",
    output: "",
    error,
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(?:^-+)|(?:-+$)/g, "");
}

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

const CHARS_PER_TOKEN_ESTIMATE = 4;

function resolveUsage(
  usage: TokenUsageInfo | undefined,
  responseText: string,
  prompt: string,
): TokenUsageInfo {
  if (usage) {
    return usage;
  }

  logger.warn("OpenClaw did not return token usage, using character-based estimate");

  const inputTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN_ESTIMATE);
  const outputTokens = Math.ceil(responseText.length / CHARS_PER_TOKEN_ESTIMATE);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}
