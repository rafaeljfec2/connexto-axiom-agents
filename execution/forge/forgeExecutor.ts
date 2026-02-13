import fs from "node:fs/promises";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import { logAudit, hashContent } from "../../state/auditLog.js";
import type { ExecutionResult } from "../shared/types.js";
import { isCodingTask, executeForgeCode } from "./forgeCodeExecutor.js";
import { executeForgeViaOpenClaw } from "./forgeOpenClawAdapter.js";
import { hasPermission } from "../shared/permissions.js";
import { executeProjectCode } from "../project/projectCodeExecutor.js";
import { checkOpenClawHealth } from "../shared/openclawClient.js";
import { ensureSandbox, resolveSandboxPath, validateSandboxLimits } from "../shared/sandbox.js";

export async function executeForge(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  projectId?: string,
  traceId?: string,
): Promise<ExecutionResult> {
  if (delegation.agent !== "forge") {
    return buildFailedResult(delegation.task, `Agent "${delegation.agent}" is not forge`);
  }

  const useOpenClaw = process.env.USE_OPENCLAW === "true";

  if (useOpenClaw) {
    const healthy = await checkOpenClawHealth();
    if (!healthy) {
      logger.error(
        { task: delegation.task, traceId },
        "OpenClaw healthcheck failed — aborting execution",
      );
      return {
        agent: "forge",
        task: delegation.task,
        status: "infra_unavailable",
        output: "",
        error: "OpenClaw unavailable (healthcheck failed)",
      };
    }
  }

  if (projectId && useOpenClaw) {
    logger.info(
      { task: delegation.task, projectId, traceId },
      "Routing to project code executor (project-aware task)",
    );
    return executeProjectCode(db, delegation, projectId, traceId);
  }

  if (useOpenClaw && isCodingTask(delegation)) {
    logger.info({ task: delegation.task, traceId }, "Routing to Forge code executor (coding task)");
    return executeForgeCode(db, delegation);
  }

  if (useOpenClaw) {
    logger.info({ task: delegation.task, traceId }, "Routing to OpenClaw runtime");
    return executeForgeViaOpenClaw(db, delegation);
  }

  logger.info({ task: delegation.task, traceId }, "Routing to local executor");
  return executeForgeLocal(db, delegation);
}

async function executeForgeLocal(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
): Promise<ExecutionResult> {
  const { task, goal_id, expected_output } = delegation;

  if (!hasPermission("forge", "fs.write")) {
    return buildFailedResult(task, "forge does not have fs.write permission");
  }

  const startTime = performance.now();

  try {
    await ensureSandbox();
    await validateSandboxLimits();

    const filename = slugify(task) + ".md";
    const filePath = resolveSandboxPath(filename);

    const content = buildMarkdownContent(task, expected_output, goal_id);
    await fs.writeFile(filePath, content, "utf-8");

    const executionTimeMs = Math.round(performance.now() - startTime);
    const artifactSizeBytes = Buffer.byteLength(content, "utf-8");

    logger.info(
      { file: filePath, executionTimeMs, artifactSizeBytes },
      "Forge (local) created file",
    );

    logAudit(db, {
      agent: "forge",
      action: task,
      inputHash: hashContent(task),
      outputHash: hashContent(content),
      sanitizerWarnings: [],
      runtime: "local",
    });

    return {
      agent: "forge",
      task,
      status: "success",
      output: filePath,
      executionTimeMs,
      artifactSizeBytes,
    };
  } catch (error) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task, executionTimeMs }, "Forge (local) execution failed");

    logAudit(db, {
      agent: "forge",
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
