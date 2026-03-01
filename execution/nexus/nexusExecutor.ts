import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../../config/budget.js";
import { logger } from "../../config/logger.js";
import { callLLM, createLLMConfig } from "../../llm/client.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import { logAudit, hashContent } from "../../state/auditLog.js";
import { incrementUsedTokens } from "../../state/budgets.js";
import { saveResearch, findSimilarResearch } from "../../state/nexusResearch.js";
import { recordTokenUsage } from "../../state/tokenUsage.js";
import { validateNexusOutput, NexusValidationError } from "./nexusValidator.js";
import { sanitizeOutput } from "../shared/outputSanitizer.js";
import type { ExecutionResult } from "../shared/types.js";

const SYSTEM_PROMPT_PATH = resolve("agents/nexus/SYSTEM.md");

let cachedSystemPrompt: string | null = null;

function loadSystemPrompt(): string {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  }
  return cachedSystemPrompt;
}

export async function executeNexus(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
): Promise<ExecutionResult> {
  if (delegation.agent !== "nexus") {
    return buildFailedResult(delegation.task, `Agent "${delegation.agent}" is not nexus`);
  }

  const startTime = performance.now();
  const budgetConfig = loadBudgetConfig();

  const existing = findSimilarResearch(db, delegation.task, delegation.goal_id);
  if (existing) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    logger.info(
      { existingId: existing.id, question: existing.question, task: delegation.task },
      "NEXUS dedup: reusing existing similar research (skipping LLM call)",
    );
    return {
      agent: "nexus",
      task: delegation.task,
      status: "success",
      output: `[DEDUP] Reused research (${existing.id}): ${existing.recommendation}`,
      tokensUsed: 0,
      executionTimeMs,
    };
  }

  try {
    const systemPrompt = loadSystemPrompt();
    const userMessage = buildResearchPrompt(delegation);

    logger.info({ task: delegation.task, goalId: delegation.goal_id }, "NEXUS research starting");

    const config = createLLMConfig();
    const response = await callLLM(config, {
      system: systemPrompt,
      userMessage,
      maxOutputTokens: budgetConfig.nexusMaxOutputTokens,
    });

    recordNexusTokenUsage(db, delegation.goal_id, response.usage);

    const sanitized = sanitizeOutput(response.text);

    if (sanitized.warnings.length > 0) {
      logger.warn({ warnings: sanitized.warnings }, "NEXUS output sanitizer warnings");
    }

    const validated = validateNexusOutput(sanitized.content);

    const researchId = saveResearch(db, {
      goalId: delegation.goal_id,
      question: delegation.task,
      options: validated.options,
      prosCons: validated.prosCons,
      riskAnalysis: validated.riskAnalysis,
      recommendation: validated.recommendation,
      rawOutput: sanitized.content,
      tokensUsed: response.usage.totalTokens,
    });

    const executionTimeMs = Math.round(performance.now() - startTime);

    logAudit(db, {
      agent: "nexus",
      action: delegation.task,
      inputHash: hashContent(userMessage),
      outputHash: hashContent(sanitized.content),
      sanitizerWarnings: sanitized.warnings,
      runtime: "local",
    });

    logger.info(
      {
        researchId,
        executionTimeMs,
        tokensUsed: response.usage.totalTokens,
      },
      "NEXUS research completed",
    );

    return {
      agent: "nexus",
      task: delegation.task,
      status: "success",
      output: `Research saved (${researchId}): ${validated.recommendation}`,
      tokensUsed: response.usage.totalTokens,
      executionTimeMs,
    };
  } catch (error) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    const isValidationError = error instanceof NexusValidationError;

    logger.error(
      { error: message, task: delegation.task, isValidationError, executionTimeMs },
      "NEXUS research failed",
    );

    logAudit(db, {
      agent: "nexus",
      action: delegation.task,
      inputHash: hashContent(delegation.task),
      outputHash: null,
      sanitizerWarnings: [`execution_error: ${message}`],
      runtime: "local",
    });

    return { ...buildFailedResult(delegation.task, message), executionTimeMs };
  }
}

function buildResearchPrompt(delegation: KairosDelegation): string {
  const lines = [
    `Pergunta de pesquisa: ${delegation.task}`,
    `Contexto (goal): ${delegation.goal_id}`,
    `Resultado esperado: ${delegation.expected_output}`,
    "",
    "Responda EXATAMENTE no formato obrigatorio definido no system prompt.",
    "Inclua pelo menos 2 opcoes com pros/contras, risco e recomendacao.",
  ];

  return lines.join("\n");
}

function recordNexusTokenUsage(
  db: BetterSqlite3.Database,
  task: string,
  usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  },
): void {
  recordTokenUsage(db, {
    agentId: "nexus",
    taskId: task,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  });

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  incrementUsedTokens(db, `${year}-${month}`, usage.totalTokens);

  logger.info(
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    },
    "NEXUS token usage recorded",
  );
}

function buildFailedResult(task: string, error: string): ExecutionResult {
  return {
    agent: "nexus",
    task,
    status: "failed",
    output: "",
    error,
  };
}
