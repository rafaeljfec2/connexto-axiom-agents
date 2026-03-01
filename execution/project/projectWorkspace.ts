import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../config/logger.js";
import { getWorkspacesDir } from "../../config/paths.js";
import { cloneRepo, pullLatest, cloneLocal } from "./projectGitManager.js";

const execFileAsync = promisify(execFile);
const BASE_DIR_NAME = ".base";
const PNPM_INSTALL_TIMEOUT_MS = 120_000;

export function getBaseClonePath(projectId: string): string {
  return path.resolve(getWorkspacesDir(), projectId, BASE_DIR_NAME);
}

export function getTaskWorkspacePath(projectId: string, taskId: string): string {
  const shortId = taskId.slice(0, 8).toLowerCase();
  return path.resolve(getWorkspacesDir(), projectId, `task-${shortId}`);
}

export async function ensureBaseClone(
  projectId: string,
  repoSource: string,
): Promise<string> {
  const basePath = getBaseClonePath(projectId);

  if (fs.existsSync(path.join(basePath, ".git"))) {
    logger.info({ projectId, basePath }, "Base clone exists, pulling latest");
    try {
      await pullLatest(basePath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ projectId, error: msg }, "Failed to pull latest, using existing base clone");
    }
    return basePath;
  }

  const parentDir = path.dirname(basePath);
  fs.mkdirSync(parentDir, { recursive: true });

  logger.info({ projectId, repoSource, basePath }, "Creating base clone");
  await cloneRepo(repoSource, basePath);

  return basePath;
}

export async function ensureBaseDependencies(projectId: string): Promise<void> {
  const basePath = getBaseClonePath(projectId);
  const nodeModulesPath = path.join(basePath, "node_modules");

  if (fs.existsSync(nodeModulesPath)) {
    logger.debug({ projectId }, "Base dependencies already installed");
    return;
  }

  logger.info({ projectId, basePath }, "Installing base dependencies");

  const packageManager = detectPackageManager(basePath);

  try {
    await execFileAsync(packageManager, ["install"], {
      cwd: basePath,
      timeout: PNPM_INSTALL_TIMEOUT_MS,
    });
    logger.info({ projectId, packageManager }, "Base dependencies installed");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ projectId, error: msg }, "Failed to install base dependencies");
  }
}

export async function createTaskWorkspace(
  projectId: string,
  taskId: string,
): Promise<string> {
  const basePath = getBaseClonePath(projectId);
  const taskPath = getTaskWorkspacePath(projectId, taskId);

  if (fs.existsSync(taskPath)) {
    logger.info({ projectId, taskId, taskPath }, "Task workspace already exists");
    return taskPath;
  }

  logger.info({ projectId, taskId, taskPath }, "Creating task workspace via local clone");
  await cloneLocal(basePath, taskPath);
  await linkDependencies(projectId, taskId);

  return taskPath;
}

export async function linkDependencies(
  projectId: string,
  taskId: string,
): Promise<void> {
  const basePath = getBaseClonePath(projectId);
  const taskPath = getTaskWorkspacePath(projectId, taskId);

  const baseNodeModules = path.join(basePath, "node_modules");
  const taskNodeModules = path.join(taskPath, "node_modules");

  if (!fs.existsSync(baseNodeModules)) {
    logger.debug({ projectId }, "No base node_modules to link");
    return;
  }

  if (fs.existsSync(taskNodeModules)) {
    return;
  }

  try {
    await fsPromises.symlink(baseNodeModules, taskNodeModules, "dir");
    logger.info({ projectId, taskId }, "Linked node_modules from base to task workspace");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ projectId, taskId, error: msg }, "Failed to link node_modules, copying instead");
  }
}

export async function cleanupTaskWorkspace(
  projectId: string,
  taskId: string,
): Promise<void> {
  const taskPath = getTaskWorkspacePath(projectId, taskId);

  if (!fs.existsSync(taskPath)) return;

  try {
    await fsPromises.rm(taskPath, { recursive: true, force: true });
    logger.info({ projectId, taskId, taskPath }, "Task workspace cleaned up");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ projectId, taskId, error: msg }, "Failed to cleanup task workspace");
  }
}

function detectPackageManager(projectPath: string): string {
  if (fs.existsSync(path.join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectPath, "yarn.lock"))) return "yarn";
  return "npm";
}
