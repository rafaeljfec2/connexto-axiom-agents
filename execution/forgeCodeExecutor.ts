import fs from "node:fs/promises";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import type { KairosDelegation } from "../orchestration/types.js";
import { logAudit, hashContent } from "../state/auditLog.js";
import { incrementUsedTokens } from "../state/budgets.js";
import { saveCodeChange, updateCodeChangeStatus } from "../state/codeChanges.js";
import { recordTokenUsage } from "../state/tokenUsage.js";
import type { FileChange } from "./codeApplier.js";
import { validateFilePaths, calculateRisk, applyCodeChangeWithBranch } from "./codeApplier.js";
import type { ApplyResult } from "./codeApplier.js";
import { callOpenClaw } from "./openclawClient.js";
import type { TokenUsageInfo } from "./openclawClient.js";
import { isGitHubConfigured } from "./githubClient.js";
import type { ExecutionResult } from "./types.js";
import { createPRForCodeChange } from "../services/pullRequestService.js";

const CODING_KEYWORDS: readonly string[] = [
  "implementar",
  "criar arquivo",
  "adicionar teste",
  "refatorar",
  "modificar",
  "code",
  "test",
  "implement",
  "create file",
  "add test",
  "refactor",
  "modify",
  "write code",
  "escrever codigo",
];

const MAX_FILES_PER_CHANGE = 3;
const MAX_CORRECTION_ATTEMPTS = 1;
const MAX_LINT_ERROR_CHARS = 2000;

const FORGE_CODER_SYSTEM_PROMPT = [
  "Voce e o FORGE, agente de codificacao do sistema connexto-axiom.",
  "NAO use tools. NAO tente ler arquivos. O contexto necessario esta no prompt.",
  "Gere APENAS JSON valido. Nenhum texto, nenhum markdown, nenhuma explicacao fora do JSON.",
  "Cada arquivo deve conter codigo TypeScript (ESM) limpo, sem comentarios desnecessarios.",
  "Siga os padroes do projeto: readonly properties, sem tipo any, camelCase, import type.",
  "Maximo de 3 arquivos por mudanca.",
  "Paths devem ser relativos a raiz do projeto.",
  "Extensoes permitidas: .ts, .js, .json, .sql, .md",
  "Diretorios permitidos: src/, orchestration/, execution/, evaluation/, services/, state/, config/, interfaces/",
  "",
  "Formato de saida OBRIGATORIO (JSON puro, sem fences):",
  "{",
  '  "description": "Descricao curta da mudanca (max 200 chars)",',
  '  "risk": <numero 1-5>,',
  '  "rollback": "Instrucao de rollback simples",',
  '  "files": [',
  "    {",
  '      "path": "caminho/relativo/arquivo.ts",',
  '      "action": "create" | "modify",',
  '      "content": "conteudo completo do arquivo"',
  "    }",
  "  ]",
  "}",
].join("\n");

interface ForgeCodeOutput {
  readonly description: string;
  readonly risk: number;
  readonly rollback: string;
  readonly files: readonly FileChange[];
}

export function isCodingTask(delegation: KairosDelegation): boolean {
  const taskLower = delegation.task.toLowerCase();
  return CODING_KEYWORDS.some((keyword) => taskLower.includes(keyword));
}

export async function executeForgeCode(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
): Promise<ExecutionResult> {
  const { task, goal_id, expected_output } = delegation;
  const startTime = performance.now();

  try {
    const prompt = await buildCodePrompt(task, expected_output, goal_id);

    const response = await callOpenClaw({
      agentId: "forge",
      prompt,
      systemPrompt: FORGE_CODER_SYSTEM_PROMPT,
    });

    if (response.status === "failed") {
      const executionTimeMs = Math.round(performance.now() - startTime);
      return buildResult(task, "failed", "", "OpenClaw returned status: failed", executionTimeMs);
    }

    const usage = resolveUsage(response.usage, response.text, prompt);
    recordUsage(db, goal_id, usage);

    const parsed = parseCodeOutput(response.text);
    if (!parsed) {
      const executionTimeMs = Math.round(performance.now() - startTime);

      logAudit(db, {
        agent: "forge",
        action: task,
        inputHash: hashContent(prompt),
        outputHash: hashContent(response.text),
        sanitizerWarnings: ["invalid_code_output_json"],
        runtime: "openclaw",
      });

      return buildResult(
        task,
        "failed",
        "",
        "LLM returned invalid JSON for code change",
        executionTimeMs,
        usage.totalTokens,
      );
    }

    if (parsed.files.length > MAX_FILES_PER_CHANGE) {
      const executionTimeMs = Math.round(performance.now() - startTime);
      return buildResult(
        task,
        "failed",
        "",
        `Too many files: ${parsed.files.length} (max ${MAX_FILES_PER_CHANGE})`,
        executionTimeMs,
        usage.totalTokens,
      );
    }

    const validation = validateFilePaths(parsed.files);
    if (!validation.valid) {
      const executionTimeMs = Math.round(performance.now() - startTime);
      return buildResult(
        task,
        "failed",
        "",
        `Path validation failed: ${validation.errors.join("; ")}`,
        executionTimeMs,
        usage.totalTokens,
      );
    }

    const risk = calculateRisk(parsed.files, validation.requiresApproval);
    const effectiveRisk = Math.max(risk, parsed.risk);

    const filePaths = parsed.files.map((f) => f.path);
    const pendingFilesJson = JSON.stringify(
      parsed.files.map((f) => ({ path: f.path, action: f.action, content: f.content })),
    );
    const changeId = saveCodeChange(db, {
      taskId: goal_id,
      description: parsed.description,
      filesChanged: filePaths,
      risk: effectiveRisk,
      pendingFiles: pendingFilesJson,
    });

    logAudit(db, {
      agent: "forge",
      action: task,
      inputHash: hashContent(prompt),
      outputHash: hashContent(JSON.stringify(parsed)),
      sanitizerWarnings: [],
      runtime: "openclaw",
    });

    if (effectiveRisk >= 3) {
      updateCodeChangeStatus(db, changeId, { status: "pending_approval" });

      const approvalMessage = formatApprovalRequest(changeId, parsed, effectiveRisk);
      await sendTelegramMessage(approvalMessage);

      const executionTimeMs = Math.round(performance.now() - startTime);
      logger.info(
        { changeId, risk: effectiveRisk },
        "Code change requires approval, sent to Telegram",
      );

      return buildResult(
        task,
        "success",
        `Aguardando aprovacao (risk=${effectiveRisk}). Change ID: ${changeId.slice(0, 8)}`,
        undefined,
        executionTimeMs,
        usage.totalTokens,
      );
    }

    const applyResult = await applyCodeChangeWithBranch(db, changeId, parsed.files);

    if (applyResult.success) {
      const executionTimeMs = Math.round(performance.now() - startTime);
      logger.info({ changeId, files: filePaths }, "Code change applied automatically (low risk)");

      await tryCreatePR(db, changeId);

      return buildResult(
        task,
        "success",
        `Mudanca aplicada: ${parsed.description}. Files: ${filePaths.join(", ")}`,
        undefined,
        executionTimeMs,
        usage.totalTokens,
      );
    }

    if (applyResult.error === "Lint validation failed" && applyResult.lintOutput) {
      logger.info({ changeId }, "Attempting self-correction via LLM");

      const correctionResult = await attemptLintCorrection(
        db,
        changeId,
        parsed,
        applyResult,
        goal_id,
        usage,
      );

      if (correctionResult) {
        const executionTimeMs = Math.round(performance.now() - startTime);

        await tryCreatePR(db, changeId);

        return buildResult(
          task,
          "success",
          `Mudanca aplicada (apos correcao): ${parsed.description}. Files: ${filePaths.join(", ")}`,
          undefined,
          executionTimeMs,
          correctionResult.totalTokens,
        );
      }
    }

    const executionTimeMs = Math.round(performance.now() - startTime);
    updateCodeChangeStatus(db, changeId, {
      status: "failed",
      testOutput: applyResult.lintOutput,
      error: applyResult.error ?? "Lint validation failed",
    });

    logger.warn(
      { changeId, error: applyResult.error },
      "Code change failed after correction attempt",
    );
    return buildResult(
      task,
      "failed",
      "",
      `Code change failed: ${applyResult.error}`,
      executionTimeMs,
      usage.totalTokens,
    );
  } catch (error) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task }, "Forge code execution failed");

    logAudit(db, {
      agent: "forge",
      action: task,
      inputHash: hashContent(task),
      outputHash: null,
      sanitizerWarnings: [`code_execution_error: ${message}`],
      runtime: "openclaw",
    });

    return buildResult(task, "failed", "", message, executionTimeMs);
  }
}

const PROJECT_ROOT = process.cwd();
const MAX_CONTEXT_CHARS = 8000;

const MODULE_PATTERNS: ReadonlyMap<string, string> = new Map([
  ["budgetgate", "execution/budgetGate.ts"],
  ["budgetgatecheck", "execution/budgetGate.ts"],
  ["checkbudget", "execution/budgetGate.ts"],
  ["sandbox", "execution/sandbox.ts"],
  ["permissions", "execution/permissions.ts"],
  ["auditlog", "state/auditLog.ts"],
  ["outcomes", "state/outcomes.ts"],
  ["goals", "state/goals.ts"],
  ["decisions", "state/decisions.ts"],
  ["artifacts", "state/artifacts.ts"],
  ["publications", "state/publications.ts"],
  ["codechanges", "state/codeChanges.ts"],
  ["tokensusage", "state/tokenUsage.ts"],
  ["tokenusage", "state/tokenUsage.ts"],
  ["budgets", "state/budgets.ts"],
  ["forgeexecutor", "execution/forgeExecutor.ts"],
  ["vectorexecutor", "execution/vectorExecutor.ts"],
  ["publisher", "execution/publisher.ts"],
  ["outputsanitizer", "execution/outputSanitizer.ts"],
  ["dailybriefing", "orchestration/dailyBriefing.ts"],
  ["decisionfilter", "orchestration/decisionFilter.ts"],
  ["feedbackadjuster", "orchestration/feedbackAdjuster.ts"],
  ["forgeevaluator", "evaluation/forgeEvaluator.ts"],
  ["marketingevaluator", "evaluation/marketingEvaluator.ts"],
  ["approvalservice", "services/approvalService.ts"],
  ["metricscollector", "services/metricsCollector.ts"],
  ["telegrambot", "interfaces/telegramBot.ts"],
  ["telegram", "interfaces/telegram.ts"],
  ["budget", "config/budget.ts"],
  ["logger", "config/logger.ts"],
]);

function extractRelevantModules(task: string, expectedOutput: string): readonly string[] {
  const combined = `${task} ${expectedOutput}`.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  const matched: string[] = [];

  for (const [keyword, filePath] of MODULE_PATTERNS) {
    if (combined.includes(keyword) && !matched.includes(filePath)) {
      matched.push(filePath);
    }
  }

  return matched.slice(0, 3);
}

async function readFileContext(filePath: string): Promise<string | null> {
  try {
    const fullPath = path.resolve(PROJECT_ROOT, filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    if (content.length > MAX_CONTEXT_CHARS) {
      return content.slice(0, MAX_CONTEXT_CHARS) + "\n// ... truncated ...";
    }
    return content;
  } catch {
    return null;
  }
}

async function buildCodePrompt(
  task: string,
  expectedOutput: string,
  goalId: string,
): Promise<string> {
  const relevantModules = extractRelevantModules(task, expectedOutput);

  const contextBlocks: string[] = [];
  for (const modulePath of relevantModules) {
    const content = await readFileContext(modulePath);
    if (content) {
      contextBlocks.push(`--- ${modulePath} ---\n${content}\n--- end ---`);
    }
  }

  const contextSection =
    contextBlocks.length > 0 ? ["", "CODIGO DE REFERENCIA:", ...contextBlocks, ""].join("\n") : "";

  return [
    `Tarefa de codificacao: ${task}`,
    `Resultado esperado: ${expectedOutput}`,
    `Goal ID: ${goalId}`,
    `Data: ${new Date().toISOString()}`,
    contextSection,
    "IMPORTANTE: Responda APENAS com JSON puro, sem markdown, sem explicacoes.",
    "Gere o JSON com as mudancas de codigo necessarias.",
  ].join("\n");
}

function parseCodeOutput(text: string): ForgeCodeOutput | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error("No JSON object found in LLM code output");
      return null;
    }

    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    if (typeof raw.description !== "string" || raw.description.length === 0) {
      logger.error("Missing or invalid description in code output");
      return null;
    }

    if (typeof raw.risk !== "number" || raw.risk < 1 || raw.risk > 5) {
      logger.error({ risk: raw.risk }, "Invalid risk value in code output");
      return null;
    }

    if (!Array.isArray(raw.files) || raw.files.length === 0) {
      logger.error("Missing or empty files array in code output");
      return null;
    }

    const files: FileChange[] = [];
    for (const file of raw.files as ReadonlyArray<Record<string, unknown>>) {
      if (typeof file.path !== "string" || file.path.length === 0) {
        logger.error("Invalid file path in code output");
        return null;
      }
      if (file.action !== "create" && file.action !== "modify") {
        logger.error({ action: file.action }, "Invalid file action in code output");
        return null;
      }
      if (typeof file.content !== "string") {
        logger.error("Invalid file content in code output");
        return null;
      }
      files.push({
        path: file.path,
        action: file.action,
        content: file.content,
      });
    }

    return {
      description: raw.description.slice(0, 200),
      risk: raw.risk,
      rollback: typeof raw.rollback === "string" ? raw.rollback : "",
      files,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Failed to parse LLM code output");
    return null;
  }
}

function formatApprovalRequest(changeId: string, parsed: ForgeCodeOutput, risk: number): string {
  const shortId = changeId.slice(0, 8);
  const filesList = parsed.files.map((f) => `- ${f.action}: ${f.path}`).join("\n");

  return [
    `*[FORGE — Mudanca de Codigo]*`,
    "",
    `*ID:* ${shortId}`,
    `*Risco:* ${risk}/5`,
    `*Descricao:* ${parsed.description}`,
    "",
    `*Arquivos:*`,
    filesList,
    "",
    `*Rollback:* ${parsed.rollback}`,
    "",
    `Use /approve\\_change ${shortId} para aprovar`,
    `Use /reject\\_change ${shortId} para rejeitar`,
  ].join("\n");
}

interface CorrectionSuccess {
  readonly totalTokens: number;
}

async function attemptLintCorrection(
  db: BetterSqlite3.Database,
  changeId: string,
  originalParsed: ForgeCodeOutput,
  failedResult: ApplyResult,
  goalId: string,
  originalUsage: TokenUsageInfo,
): Promise<CorrectionSuccess | null> {
  for (let attempt = 1; attempt <= MAX_CORRECTION_ATTEMPTS; attempt++) {
    logger.info({ changeId, attempt }, "Sending lint errors to LLM for correction");

    const correctionPrompt = buildCorrectionPrompt(originalParsed, failedResult.lintOutput);

    const response = await callOpenClaw({
      agentId: "forge",
      prompt: correctionPrompt,
      systemPrompt: FORGE_CODER_SYSTEM_PROMPT,
    });

    if (response.status === "failed") {
      logger.warn({ changeId, attempt }, "LLM correction call failed");
      return null;
    }

    const correctionUsage = resolveUsage(response.usage, response.text, correctionPrompt);
    recordUsage(db, goalId, correctionUsage);

    const corrected = parseCodeOutput(response.text);
    if (!corrected) {
      logger.warn({ changeId, attempt }, "LLM correction returned invalid JSON");
      return null;
    }

    const validation = validateFilePaths(corrected.files);
    if (!validation.valid) {
      logger.warn({ changeId, attempt }, "Corrected files have invalid paths");
      return null;
    }

    const pendingFilesJson = JSON.stringify(
      corrected.files.map((f) => ({ path: f.path, action: f.action, content: f.content })),
    );
    updateCodeChangeStatus(db, changeId, { status: "pending" });

    const { savePendingFiles } = await import("../state/codeChanges.js");
    savePendingFiles(db, changeId, pendingFilesJson);

    const retryResult = await applyCodeChangeWithBranch(db, changeId, corrected.files);

    if (retryResult.success) {
      const totalTokens = originalUsage.totalTokens + correctionUsage.totalTokens;
      logger.info({ changeId, attempt, totalTokens }, "Code change applied after LLM correction");
      return { totalTokens };
    }

    logger.warn({ changeId, attempt }, "Correction attempt still failed lint");
  }

  return null;
}

function buildCorrectionPrompt(originalParsed: ForgeCodeOutput, lintOutput: string): string {
  const truncatedErrors =
    lintOutput.length > MAX_LINT_ERROR_CHARS
      ? lintOutput.slice(0, MAX_LINT_ERROR_CHARS) + "\n... (truncated)"
      : lintOutput;

  const originalFiles = originalParsed.files
    .map((f) => `--- ${f.path} (${f.action}) ---\n${f.content}\n--- end ---`)
    .join("\n\n");

  return [
    "CORRECAO DE CODIGO: O codigo gerado anteriormente falhou na validacao lint/tsc.",
    "",
    "ERROS ENCONTRADOS:",
    truncatedErrors,
    "",
    "CODIGO ORIGINAL:",
    originalFiles,
    "",
    "INSTRUCOES:",
    "1. Corrija TODOS os erros listados acima",
    "2. Mantenha a mesma estrutura de arquivos e paths",
    "3. Use imports com extensao .js (ESM)",
    "4. Use import type para importacoes de tipo",
    "5. Nao use tipo any",
    "6. Responda APENAS com JSON puro, mesmo formato de saida",
    "",
    "IMPORTANTE: Responda APENAS com JSON puro, sem markdown, sem explicacoes.",
  ].join("\n");
}

function buildResult(
  task: string,
  status: "success" | "failed",
  output: string,
  error?: string,
  executionTimeMs?: number,
  tokensUsed?: number,
): ExecutionResult {
  return {
    agent: "forge",
    task,
    status,
    output,
    error,
    executionTimeMs,
    tokensUsed,
  };
}

const CHARS_PER_TOKEN_ESTIMATE = 4;

function resolveUsage(
  usage: TokenUsageInfo | undefined,
  responseText: string,
  prompt: string,
): TokenUsageInfo {
  if (usage) return usage;

  logger.warn("OpenClaw did not return token usage for code task, using estimate");
  const inputTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN_ESTIMATE);
  const outputTokens = Math.ceil(responseText.length / CHARS_PER_TOKEN_ESTIMATE);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

async function tryCreatePR(db: BetterSqlite3.Database, changeId: string): Promise<void> {
  if (!isGitHubConfigured()) {
    logger.debug({ changeId }, "GitHub not configured, skipping PR creation");
    return;
  }

  try {
    const result = await createPRForCodeChange(db, changeId);
    if (result.success) {
      logger.info({ changeId, message: result.message }, "PR flow triggered after code apply");
    } else {
      logger.warn({ changeId, message: result.message }, "PR flow could not be triggered");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ changeId, error: message }, "Failed to trigger PR flow");
  }
}

function recordUsage(db: BetterSqlite3.Database, goalId: string, usage: TokenUsageInfo): void {
  const budgetConfig = loadBudgetConfig();

  recordTokenUsage(db, {
    agentId: "forge",
    taskId: goalId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  });

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  incrementUsedTokens(db, period, usage.totalTokens);

  logger.info(
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      perTaskLimit: budgetConfig.perTaskTokenLimit,
    },
    "Code task token usage recorded",
  );
}
