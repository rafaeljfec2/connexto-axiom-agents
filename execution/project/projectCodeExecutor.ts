import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import { logAudit, hashContent } from "../../state/auditLog.js";
import { getProjectById } from "../../state/projects.js";
import {
  ensureBaseClone,
  ensureBaseDependencies,
  createTaskWorkspace,
  cleanupTaskWorkspace,
} from "./projectWorkspace.js";
import type { ExecutionResult } from "../shared/types.js";
import type { ForgeExecutorMode } from "../../projects/manifest.schema.js";
import type { ExecutionEventEmitter } from "../shared/executionEventEmitter.js";
import { buildResult } from "./projectCodeHelpers.js";
import { executeWithClaudeCliMode, executeWithOpenClawMode, executeWithAgentLoop } from "./projectExecutorModes.js";

interface ExecutorRouteContext {
  readonly executorMode: ForgeExecutorMode;
  readonly db: BetterSqlite3.Database;
  readonly delegation: KairosDelegation;
  readonly projectId: string;
  readonly workspacePath: string;
  readonly project: {
    readonly language: string;
    readonly framework: string;
    readonly repo_source: string;
    readonly forge_executor: string;
    readonly base_branch: string;
    readonly push_enabled: number | null;
    readonly project_id: string;
  };
  readonly startTime: number;
  readonly traceId?: string;
  readonly emitter?: ExecutionEventEmitter;
}

async function routeToExecutor(ctx: ExecutorRouteContext): Promise<ExecutionResult> {
  const { executorMode, db, delegation, projectId, workspacePath, project, startTime, traceId, emitter } = ctx;

  switch (executorMode) {
    case "openclaw":
      return executeWithOpenClawMode(db, delegation, projectId, workspacePath, project, startTime, traceId);
    case "claude-cli":
      return executeWithClaudeCliMode({ db, delegation, projectId, workspacePath, project, startTime, traceId, emitter });
    default:
      return executeWithAgentLoop(db, delegation, projectId, workspacePath, project, startTime, traceId);
  }
}

export async function executeProjectCode(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  projectId: string,
  traceId?: string,
  emitter?: ExecutionEventEmitter,
): Promise<ExecutionResult> {
  const { task, goal_id } = delegation;
  const startTime = performance.now();

  try {
    const project = getProjectById(db, projectId);
    if (!project) {
      return buildResult(task, "failed", "", `Project not found: ${projectId}`, 0);
    }

    logger.info(
      { projectId, repoSource: project.repo_source, task: task.slice(0, 80) },
      "Starting project code execution (agent loop)",
    );

    await ensureBaseClone(projectId, project.repo_source);
    await ensureBaseDependencies(projectId);
    const workspacePath = await createTaskWorkspace(projectId, goal_id);

    try {
      const executorMode = project.forge_executor ?? "legacy";

      emitter?.info("forge", "forge:workspace_created", "Task workspace created", {
        phase: "setup",
        metadata: { projectId, executorMode, workspacePath },
      });

      return await routeToExecutor({
        executorMode,
        db,
        delegation,
        projectId,
        workspacePath,
        project,
        startTime,
        traceId,
        emitter,
      });
    } finally {
      if (process.env.FORGE_KEEP_WORKSPACE === "true") {
        logger.info(
          { projectId, goalId: goal_id, workspacePath },
          "Keeping workspace for inspection (FORGE_KEEP_WORKSPACE=true)",
        );
      } else {
        await cleanupTaskWorkspace(projectId, goal_id);
      }
    }
  } catch (error) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task, projectId }, "Project code execution failed");

    logAudit(db, {
      agent: "forge",
      action: task,
      inputHash: hashContent(task),
      outputHash: null,
      sanitizerWarnings: [`project_code_execution_error: ${message}`],
      runtime: "openclaw",
    });

    return buildResult(task, "failed", "", message, executionTimeMs);
  }
}
