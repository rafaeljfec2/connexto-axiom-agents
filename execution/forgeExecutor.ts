import fs from "node:fs/promises";
import { logger } from "../config/logger.js";
import type { KairosDelegation } from "../orchestration/types.js";
import type { ExecutionResult } from "./types.js";
import { executeForgeViaOpenClaw } from "./forgeOpenClawAdapter.js";
import { hasPermission } from "./permissions.js";
import { ensureSandbox, resolveSandboxPath } from "./sandbox.js";

export async function executeForge(delegation: KairosDelegation): Promise<ExecutionResult> {
  if (delegation.agent !== "forge") {
    return buildFailedResult(delegation.task, `Agent "${delegation.agent}" is not forge`);
  }

  const useOpenClaw = process.env.USE_OPENCLAW === "true";

  if (useOpenClaw) {
    logger.info({ task: delegation.task }, "Routing to OpenClaw runtime");
    return executeForgeViaOpenClaw(delegation);
  }

  logger.info({ task: delegation.task }, "Routing to local executor");
  return executeForgeLocal(delegation);
}

async function executeForgeLocal(delegation: KairosDelegation): Promise<ExecutionResult> {
  const { task, goal_id, expected_output } = delegation;

  if (!hasPermission("forge", "fs.write")) {
    return buildFailedResult(task, "forge does not have fs.write permission");
  }

  try {
    await ensureSandbox();

    const filename = slugify(task) + ".md";
    const filePath = resolveSandboxPath(filename);

    const content = buildMarkdownContent(task, expected_output, goal_id);
    await fs.writeFile(filePath, content, "utf-8");

    logger.info({ file: filePath }, "Forge (local) created file");

    return {
      agent: "forge",
      task,
      status: "success",
      output: filePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task }, "Forge (local) execution failed");
    return buildFailedResult(task, message);
  }
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

function buildMarkdownContent(task: string, expectedOutput: string, goalId: string): string {
  const timestamp = new Date().toISOString();

  const lines = [
    `# ${task}`,
    "",
    `**Goal ID:** ${goalId}`,
    `**Generated at:** ${timestamp}`,
    `**Agent:** forge`,
    "",
    "## Expected Output",
    "",
    expectedOutput,
    "",
  ];

  return lines.join("\n");
}
