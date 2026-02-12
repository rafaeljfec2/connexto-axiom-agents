import fs from "node:fs/promises";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import { logAudit, hashContent } from "../../state/auditLog.js";
import type { ExecutionResult } from "../shared/types.js";
import { hasPermission } from "../shared/permissions.js";
import { executeVectorViaOpenClaw } from "./vectorOpenClawAdapter.js";
import {
  ensureAgentSandbox,
  resolveAgentSandboxPath,
  validateAgentSandboxLimits,
} from "../shared/sandbox.js";

const AGENT_ID = "vector";

export async function executeVector(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
): Promise<ExecutionResult> {
  if (delegation.agent !== AGENT_ID) {
    return buildFailedResult(delegation.task, `Agent "${delegation.agent}" is not vector`);
  }

  const useOpenClaw = process.env.USE_OPENCLAW === "true";

  if (useOpenClaw) {
    logger.info({ task: delegation.task }, "Routing vector to OpenClaw runtime");
    return executeVectorViaOpenClaw(db, delegation);
  }

  logger.info({ task: delegation.task }, "Routing vector to local executor");
  return executeVectorLocal(db, delegation);
}

async function executeVectorLocal(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
): Promise<ExecutionResult> {
  const { task, goal_id, expected_output } = delegation;

  if (!hasPermission(AGENT_ID, "content.draft")) {
    return buildFailedResult(task, "vector does not have content.draft permission");
  }

  const startTime = performance.now();

  try {
    await ensureAgentSandbox(AGENT_ID);
    await validateAgentSandboxLimits(AGENT_ID);

    const filename = slugify(task) + ".md";
    const filePath = resolveAgentSandboxPath(AGENT_ID, filename);

    const content = buildPlaceholderContent(task, expected_output, goal_id);
    await fs.writeFile(filePath, content, "utf-8");

    const executionTimeMs = Math.round(performance.now() - startTime);
    const artifactSizeBytes = Buffer.byteLength(content, "utf-8");

    logger.info(
      { file: filePath, executionTimeMs, artifactSizeBytes },
      "Vector (local) created file",
    );

    logAudit(db, {
      agent: AGENT_ID,
      action: task,
      inputHash: hashContent(task),
      outputHash: hashContent(content),
      sanitizerWarnings: [],
      runtime: "local",
    });

    return {
      agent: AGENT_ID,
      task,
      status: "success",
      output: filePath,
      executionTimeMs,
      artifactSizeBytes,
    };
  } catch (error) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task, executionTimeMs }, "Vector (local) execution failed");

    logAudit(db, {
      agent: AGENT_ID,
      action: task,
      inputHash: hashContent(task),
      outputHash: null,
      sanitizerWarnings: [`execution_error: ${message}`],
      runtime: "local",
    });

    return { ...buildFailedResult(task, message), executionTimeMs };
  }
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(?:^-+)|(?:-+$)/g, "");
}

function buildPlaceholderContent(task: string, expectedOutput: string, goalId: string): string {
  const timestamp = new Date().toISOString();

  return [
    `# ${task}`,
    "",
    `**Goal ID:** ${goalId}`,
    `**Generated at:** ${timestamp}`,
    `**Agent:** vector`,
    `**Status:** DRAFT`,
    "",
    "## Expected Output",
    "",
    expectedOutput,
    "",
  ].join("\n");
}
