import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { REPOSITORIES_DIR, WORKSPACES_DIR } from "../config/paths.js";
import { detectStack } from "./stackDetector.js";
import {
  updateOnboardingStatus,
  updateOnboardingProgress,
  getProjectById,
} from "../state/projects.js";

const execFileAsync = promisify(execFile);
const GIT_CLONE_TIMEOUT_MS = 300_000;

export type OnboardingEventType = "status_change" | "progress" | "error" | "complete";

export interface OnboardingEvent {
  readonly type: OnboardingEventType;
  readonly projectId: string;
  readonly status: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

type EventListener = (event: OnboardingEvent) => void;

const listeners = new Map<string, Set<EventListener>>();

export function subscribeToOnboarding(projectId: string, listener: EventListener): () => void {
  const existing = listeners.get(projectId);
  if (existing) {
    existing.add(listener);
  } else {
    const newSet = new Set<EventListener>([listener]);
    listeners.set(projectId, newSet);
  }

  return () => {
    listeners.get(projectId)?.delete(listener);
    if (listeners.get(projectId)?.size === 0) {
      listeners.delete(projectId);
    }
  };
}

function emitEvent(event: OnboardingEvent): void {
  const projectListeners = listeners.get(event.projectId);
  if (projectListeners) {
    for (const listener of projectListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.warn({ err, projectId: event.projectId }, "SSE listener error");
      }
    }
  }
}

async function cloneRepository(projectId: string, gitUrl: string): Promise<string> {
  const repoPath = path.join(REPOSITORIES_DIR, projectId);

  if (fs.existsSync(path.join(repoPath, ".git"))) {
    logger.info({ projectId, repoPath }, "Repository already exists, skipping clone");
    return repoPath;
  }

  fs.mkdirSync(path.dirname(repoPath), { recursive: true });

  await execFileAsync("git", ["clone", gitUrl, repoPath], {
    timeout: GIT_CLONE_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

  return repoPath;
}

async function copyToWorkspace(projectId: string, repoPath: string): Promise<string> {
  const workspacePath = path.join(WORKSPACES_DIR, projectId, ".base");

  if (fs.existsSync(workspacePath)) {
    logger.info({ projectId, workspacePath }, "Workspace already exists, skipping copy");
    return workspacePath;
  }

  fs.mkdirSync(path.dirname(workspacePath), { recursive: true });

  await execFileAsync("git", ["clone", "--local", repoPath, workspacePath], {
    timeout: GIT_CLONE_TIMEOUT_MS,
  });

  return workspacePath;
}

function generateManifestYaml(
  projectId: string,
  gitUrl: string,
  stack: { language: string; framework: string },
): string {
  return [
    `project_id: ${projectId}`,
    `repo_source: ${gitUrl}`,
    `stack:`,
    `  language: ${stack.language}`,
    `  framework: ${stack.framework}`,
    `risk_profile: medium`,
    `autonomy_level: 1`,
    `token_budget_monthly: 100000`,
    `status: active`,
    `forge_executor: claude-cli`,
    `base_branch: main`,
    `push_enabled: false`,
    "",
  ].join("\n");
}

async function createProjectManifest(
  projectId: string,
  gitUrl: string,
  stack: { language: string; framework: string },
): Promise<void> {
  const projectDir = path.resolve("projects", projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  const manifestPath = path.join(projectDir, "manifest.yaml");
  const manifestContent = generateManifestYaml(projectId, gitUrl, stack);

  await fsPromises.writeFile(manifestPath, manifestContent, "utf-8");
  logger.info({ projectId, manifestPath }, "Project manifest created");
}

async function countProjectFiles(workspacePath: string): Promise<number> {
  let count = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        count++;
      }
    }
  }

  await walk(workspacePath);
  return count;
}

export async function startOnboarding(
  db: BetterSqlite3.Database,
  projectId: string,
): Promise<void> {
  const project = getProjectById(db, projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const repoSource = project.git_repository_url ?? project.repo_source;
  if (!repoSource) {
    throw new Error(`Project ${projectId} has no git_repository_url or repo_source`);
  }

  const isLocalRepo = repoSource.startsWith("/") || repoSource.startsWith(".");

  db.prepare(
    "UPDATE projects SET onboarding_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ?",
  ).run(projectId);

  try {
    let repoPath: string;

    if (isLocalRepo && fs.existsSync(path.join(repoSource, ".git"))) {
      repoPath = repoSource;
      logger.info({ projectId, repoPath }, "Using existing local repository");
      emitEvent({
        type: "status_change",
        projectId,
        status: "cloning",
        message: "Local repository detected, skipping clone...",
      });
    } else {
      updateOnboardingStatus(db, projectId, "cloning");
      emitEvent({
        type: "status_change",
        projectId,
        status: "cloning",
        message: "Cloning repository...",
      });
      repoPath = await cloneRepository(projectId, repoSource);
      logger.info({ projectId, repoPath }, "Repository cloned");
    }

    updateOnboardingStatus(db, projectId, "cloned");
    emitEvent({ type: "status_change", projectId, status: "cloned", message: "Clone completed" });

    emitEvent({
      type: "status_change",
      projectId,
      status: "copying",
      message: "Copying to workspace...",
    });
    const workspacePath = await copyToWorkspace(projectId, repoPath);
    logger.info({ projectId, workspacePath }, "Copied to workspace");

    const stack = detectStack(workspacePath);
    updateOnboardingProgress(db, projectId, {
      stack_detected: `${stack.language}/${stack.framework}`,
    });
    emitEvent({
      type: "progress",
      projectId,
      status: "detecting",
      message: `Detected stack: ${stack.language}/${stack.framework}`,
      data: { stack },
    });

    await createProjectManifest(projectId, repoSource, stack);

    const totalFiles = await countProjectFiles(workspacePath);
    updateOnboardingProgress(db, projectId, { files_total: totalFiles });

    updateOnboardingStatus(db, projectId, "indexing");
    updateOnboardingProgress(db, projectId, { index_status: "in_progress" });
    emitEvent({
      type: "status_change",
      projectId,
      status: "indexing",
      message: "Indexing project files...",
      data: { index_status: "in_progress", files_total: totalFiles },
    });

    try {
      const { runProjectIndexAgent } = await import("../agents/indexing/projectIndexAgent.js");
      await runProjectIndexAgent(db, projectId, workspacePath, (indexed) => {
        updateOnboardingProgress(db, projectId, { files_indexed: indexed });
        emitEvent({
          type: "progress",
          projectId,
          status: "indexing",
          message: `Indexed ${String(indexed)} of ${String(totalFiles)} files`,
          data: { files_indexed: indexed, files_total: totalFiles, index_status: "in_progress" },
        });
      });
      updateOnboardingProgress(db, projectId, {
        files_indexed: totalFiles,
        index_status: "completed",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ projectId, error: msg }, "Indexing failed, continuing...");
      updateOnboardingProgress(db, projectId, { index_status: "error" });
    }

    updateOnboardingStatus(db, projectId, "documenting");
    updateOnboardingProgress(db, projectId, { docs_status: "in_progress" });
    emitEvent({
      type: "status_change",
      projectId,
      status: "documenting",
      message: "Generating documentation...",
      data: { docs_status: "in_progress", files_total: totalFiles },
    });

    try {
      const { runDocumentationAgent } =
        await import("../agents/documentation/documentationAgent.js");
      await runDocumentationAgent(workspacePath, (progress) => {
        emitEvent({ type: "progress", projectId, status: "documenting", message: progress });
      });
      updateOnboardingProgress(db, projectId, { docs_status: "completed" });
      emitEvent({
        type: "progress",
        projectId,
        status: "documenting",
        message: "Documentation completed",
        data: { docs_status: "completed" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ projectId, error: msg }, "Documentation generation failed, continuing...");
      updateOnboardingProgress(db, projectId, { docs_status: "error" });
      emitEvent({
        type: "progress",
        projectId,
        status: "documenting",
        message: `Documentation failed: ${msg}`,
        data: { docs_status: "error" },
      });
    }

    updateOnboardingStatus(db, projectId, "ready");
    db.prepare(
      "UPDATE projects SET onboarding_completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), status = 'active' WHERE project_id = ?",
    ).run(projectId);

    emitEvent({
      type: "complete",
      projectId,
      status: "ready",
      message: "Project onboarding completed",
      data: { docs_status: "completed", index_status: "completed", files_total: totalFiles, files_indexed: totalFiles },
    });
    logger.info({ projectId }, "Project onboarding completed successfully");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ projectId, error: msg }, "Onboarding pipeline failed");
    updateOnboardingStatus(db, projectId, "error", msg);
    emitEvent({ type: "error", projectId, status: "error", message: msg });
  }
}
