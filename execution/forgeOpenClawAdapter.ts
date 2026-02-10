import fs from "node:fs/promises";
import { logger } from "../config/logger.js";
import type { KairosDelegation } from "../orchestration/types.js";
import type { ExecutionResult } from "./types.js";
import { callOpenClaw, extractTextFromResponse } from "./openclawClient.js";
import { ensureSandbox, resolveSandboxPath } from "./sandbox.js";

export async function executeForgeViaOpenClaw(
  delegation: KairosDelegation,
): Promise<ExecutionResult> {
  const { task, goal_id, expected_output } = delegation;

  try {
    const model = process.env.OPENCLAW_MODEL ?? "gpt-4o-mini";
    const prompt = buildPrompt(task, expected_output, goal_id);

    const response = await callOpenClaw({
      model,
      input: prompt,
      instructions: FORGE_INSTRUCTIONS,
    });

    if (response.status === "failed") {
      return buildFailedResult(task, "OpenClaw returned status: failed");
    }

    const generatedContent = extractTextFromResponse(response);

    await ensureSandbox();
    const filename = slugify(task) + ".md";
    const filePath = resolveSandboxPath(filename);
    await fs.writeFile(filePath, generatedContent, "utf-8");

    logger.info({ file: filePath }, "Forge (OpenClaw) created file");

    return {
      agent: "forge",
      task,
      status: "success",
      output: filePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task }, "Forge (OpenClaw) execution failed");
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
