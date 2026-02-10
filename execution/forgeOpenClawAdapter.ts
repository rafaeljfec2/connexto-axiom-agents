import fs from "node:fs/promises";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import type { KairosDelegation } from "../orchestration/types.js";
import { logAudit, hashContent } from "../state/auditLog.js";
import type { ExecutionResult } from "./types.js";
import { callOpenClaw } from "./openclawClient.js";
import { sanitizeOutput } from "./outputSanitizer.js";
import { ensureSandbox, resolveSandboxPath, validateSandboxLimits } from "./sandbox.js";

export async function executeForgeViaOpenClaw(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
): Promise<ExecutionResult> {
  const { task, goal_id, expected_output } = delegation;

  try {
    const prompt = buildPrompt(task, expected_output, goal_id);

    const response = await callOpenClaw({
      agentId: "forge",
      prompt,
      systemPrompt: FORGE_INSTRUCTIONS,
    });

    if (response.status === "failed") {
      logAudit(db, {
        agent: "forge",
        action: task,
        inputHash: hashContent(prompt),
        outputHash: null,
        sanitizerWarnings: [],
        runtime: "openclaw",
      });
      return buildFailedResult(task, "OpenClaw returned status: failed");
    }

    const sanitized = sanitizeOutput(response.text);

    if (sanitized.warnings.length > 0) {
      logger.warn({ warnings: sanitized.warnings }, "Output sanitizer applied corrections");
    }

    await ensureSandbox();
    await validateSandboxLimits();

    const filename = slugify(task) + ".md";
    const filePath = resolveSandboxPath(filename);
    await fs.writeFile(filePath, sanitized.content, "utf-8");

    logger.info({ file: filePath }, "Forge (OpenClaw) created file");

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
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task }, "Forge (OpenClaw) execution failed");

    logAudit(db, {
      agent: "forge",
      action: task,
      inputHash: hashContent(task),
      outputHash: null,
      sanitizerWarnings: [`execution_error: ${message}`],
      runtime: "openclaw",
    });

    return buildFailedResult(task, message);
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
