import fs from "node:fs/promises";
import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../../config/budget.js";
import { logger } from "../../config/logger.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import { logAudit, hashContent } from "../../state/auditLog.js";
import { saveArtifact } from "../../state/artifacts.js";
import type { ArtifactType } from "../../state/artifacts.js";
import { incrementUsedTokens } from "../../state/budgets.js";
import { recordTokenUsage } from "../../state/tokenUsage.js";
import type { ExecutionResult } from "../shared/types.js";
import { callOpenClaw } from "../shared/openclawClient.js";
import type { TokenUsageInfo, OpenClawResult } from "../shared/openclawClient.js";
import { sanitizeOutput } from "../shared/outputSanitizer.js";
import {
  ensureAgentSandbox,
  resolveAgentSandboxPath,
  validateAgentSandboxLimits,
} from "../shared/sandbox.js";

const AGENT_ID = "vector";

export async function executeVectorViaOpenClaw(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
): Promise<ExecutionResult> {
  const { task, goal_id, expected_output } = delegation;

  const startTime = performance.now();

  try {
    const artifactType = detectArtifactType(task);
    const prompt = buildPrompt(task, expected_output, goal_id, artifactType);

    const openClawResult: OpenClawResult = await callOpenClaw({
      agentId: AGENT_ID,
      prompt,
      systemPrompt: VECTOR_INSTRUCTIONS,
    });

    if (!openClawResult.ok) {
      const executionTimeMs = Math.round(performance.now() - startTime);
      const isInfra = openClawResult.error.kind === "infra" || openClawResult.error.kind === "auth";
      if (isInfra) {
        return {
          agent: AGENT_ID,
          task,
          status: "infra_unavailable" as const,
          output: "",
          error: openClawResult.error.message,
          executionTimeMs,
        };
      }
      logFailedAudit(db, task, prompt);
      return { ...buildFailedResult(task, openClawResult.error.message), executionTimeMs };
    }

    const response = openClawResult.response;

    if (response.status === "failed") {
      const executionTimeMs = Math.round(performance.now() - startTime);
      logFailedAudit(db, task, prompt);
      return { ...buildFailedResult(task, "OpenClaw returned status: failed"), executionTimeMs };
    }

    const usage = resolveUsage(response.usage, response.text, prompt);

    const budgetConfig = loadBudgetConfig();
    if (usage.totalTokens > budgetConfig.perTaskTokenLimit) {
      const executionTimeMs = Math.round(performance.now() - startTime);
      logger.error(
        { totalTokens: usage.totalTokens, limit: budgetConfig.perTaskTokenLimit },
        "Vector per-task token limit exceeded",
      );
      logAudit(db, {
        agent: AGENT_ID,
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

    recordUsage(db, goal_id, usage);

    const sanitized = sanitizeOutput(response.text);

    if (sanitized.warnings.length > 0) {
      logger.warn({ warnings: sanitized.warnings }, "Output sanitizer applied corrections");
    }

    await ensureAgentSandbox(AGENT_ID);
    await validateAgentSandboxLimits(AGENT_ID);

    const filename = slugify(task) + ".md";
    const filePath = resolveAgentSandboxPath(AGENT_ID, filename);
    await fs.writeFile(filePath, sanitized.content, "utf-8");

    const artifactId = saveArtifact(db, {
      agentId: AGENT_ID,
      type: artifactType,
      title: task,
      content: sanitized.content,
      metadata: JSON.stringify({ goalId: goal_id, filePath }),
    });

    const executionTimeMs = Math.round(performance.now() - startTime);
    const artifactSizeBytes = Buffer.byteLength(sanitized.content, "utf-8");

    logger.info(
      { file: filePath, artifactId, artifactType, executionTimeMs, artifactSizeBytes },
      "Vector (OpenClaw) created draft",
    );

    logAudit(db, {
      agent: AGENT_ID,
      action: task,
      inputHash: hashContent(prompt),
      outputHash: hashContent(sanitized.content),
      sanitizerWarnings: sanitized.warnings,
      runtime: "openclaw",
    });

    return {
      agent: AGENT_ID,
      task,
      status: "success",
      output: `draft:${artifactId} -> ${filePath}`,
      tokensUsed: usage.totalTokens,
      executionTimeMs,
      artifactSizeBytes,
    };
  } catch (error) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task, executionTimeMs }, "Vector (OpenClaw) execution failed");

    logAudit(db, {
      agent: AGENT_ID,
      action: task,
      inputHash: hashContent(task),
      outputHash: null,
      sanitizerWarnings: [`execution_error: ${message}`],
      runtime: "openclaw",
    });

    return { ...buildFailedResult(task, message), executionTimeMs };
  }
}

const VECTOR_INSTRUCTIONS = [
  "Voce e o VECTOR, agente de comunicacao do sistema connexto-axiom.",
  "Gere conteudo de marketing/comunicacao em portugues brasileiro (pt-BR).",
  "O conteudo deve ser profissional, direto e sem jargao excessivo.",
  "Posts X: max 280 chars. Posts LinkedIn: max 1500 chars.",
  "Newsletters: max 2000 chars. Landing copy: max 3000 chars.",
  "Sem links reais, sem dados inventados, sem promessas exageradas.",
  "Max 2 emojis por texto. Tudo e DRAFT, nunca final.",
  "Responda APENAS com o conteudo solicitado, sem explicacoes adicionais.",
].join(" ");

const ARTIFACT_TYPE_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly type: ArtifactType;
}> = [
  { pattern: /newsletter/i, type: "newsletter" },
  { pattern: /landing/i, type: "landing" },
  { pattern: /calend[aá]rio/i, type: "editorial_calendar" },
  { pattern: /editorial/i, type: "editorial_calendar" },
  { pattern: /an[aá]lis/i, type: "analysis" },
  { pattern: /post/i, type: "post" },
  { pattern: /linkedin/i, type: "post" },
  { pattern: /twitter/i, type: "post" },
];

function detectArtifactType(task: string): ArtifactType {
  for (const { pattern, type } of ARTIFACT_TYPE_PATTERNS) {
    if (pattern.test(task)) {
      return type;
    }
  }
  return "post";
}

function buildPrompt(
  task: string,
  expectedOutput: string,
  goalId: string,
  artifactType: ArtifactType,
): string {
  const timestamp = new Date().toISOString();

  return [
    `Tipo de conteudo: ${artifactType}`,
    `Tarefa: ${task}`,
    `Resultado esperado: ${expectedOutput}`,
    `Goal ID: ${goalId}`,
    `Data: ${timestamp}`,
    "",
    "Gere o conteudo solicitado agora. Lembre-se: tudo e DRAFT.",
  ].join("\n");
}

function buildFailedResult(task: string, error: string): ExecutionResult {
  return {
    agent: AGENT_ID,
    task,
    status: "failed",
    output: "",
    error,
  };
}

function logFailedAudit(db: BetterSqlite3.Database, task: string, prompt: string): void {
  logAudit(db, {
    agent: AGENT_ID,
    action: task,
    inputHash: hashContent(prompt),
    outputHash: null,
    sanitizerWarnings: [],
    runtime: "openclaw",
  });
}

function recordUsage(db: BetterSqlite3.Database, goalId: string, usage: TokenUsageInfo): void {
  const currentPeriod = getCurrentPeriod();
  recordTokenUsage(db, {
    agentId: AGENT_ID,
    taskId: goalId,
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
    "Vector token usage recorded",
  );
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

  logger.warn("OpenClaw did not return token usage for vector, using character-based estimate");

  const inputTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN_ESTIMATE);
  const outputTokens = Math.ceil(responseText.length / CHARS_PER_TOKEN_ESTIMATE);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}
