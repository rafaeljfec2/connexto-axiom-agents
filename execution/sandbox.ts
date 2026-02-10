import path from "node:path";
import fs from "node:fs/promises";

const PROJECT_ROOT = process.cwd();
const SANDBOX_DIR = path.resolve(PROJECT_ROOT, "sandbox", "forge");

const MAX_FILENAME_LENGTH = 200;
const MAX_SANDBOX_FILES = 100;
const SAFE_FILENAME_REGEX = /^[a-z0-9][a-z0-9./-]*$/;
const SAFE_AGENT_ID_REGEX = /^[a-z][a-z0-9-]*$/;

export async function ensureSandbox(): Promise<void> {
  await fs.mkdir(SANDBOX_DIR, { recursive: true });
}

export function resolveSandboxPath(filename: string): string {
  validateFilename(filename);

  const resolved = path.resolve(SANDBOX_DIR, filename);
  const relative = path.relative(SANDBOX_DIR, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError(`Path traversal detected: "${filename}" resolves outside sandbox`);
  }

  return resolved;
}

function resolveAgentSandboxDir(agentId: string): string {
  if (!SAFE_AGENT_ID_REGEX.test(agentId)) {
    throw new TypeError(`Invalid agent ID for sandbox: "${agentId}"`);
  }
  return path.resolve(PROJECT_ROOT, "sandbox", agentId);
}

export async function ensureAgentSandbox(agentId: string): Promise<void> {
  const dir = resolveAgentSandboxDir(agentId);
  await fs.mkdir(dir, { recursive: true });
}

export function resolveAgentSandboxPath(agentId: string, filename: string): string {
  validateFilename(filename);

  const dir = resolveAgentSandboxDir(agentId);
  const resolved = path.resolve(dir, filename);
  const relative = path.relative(dir, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError(`Path traversal detected: "${filename}" resolves outside sandbox`);
  }

  return resolved;
}

export async function validateAgentSandboxLimits(agentId: string): Promise<void> {
  const dir = resolveAgentSandboxDir(agentId);
  try {
    const entries = await fs.readdir(dir);
    if (entries.length >= MAX_SANDBOX_FILES) {
      throw new Error(
        `Sandbox file limit reached for ${agentId}: ${entries.length}/${MAX_SANDBOX_FILES}. Remove old files before creating new ones`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export function validateFilename(filename: string): void {
  if (!filename || filename.length === 0) {
    throw new TypeError("Filename must not be empty");
  }

  if (filename.length > MAX_FILENAME_LENGTH) {
    throw new TypeError(`Filename exceeds ${MAX_FILENAME_LENGTH} characters: ${filename.length}`);
  }

  if (!SAFE_FILENAME_REGEX.test(filename)) {
    throw new TypeError(
      `Filename contains invalid characters: "${filename}". Only a-z, 0-9, dots and hyphens are allowed`,
    );
  }

  if (filename.includes("..")) {
    throw new TypeError(`Filename must not contain "..": "${filename}"`);
  }
}

export async function validateSandboxLimits(): Promise<void> {
  try {
    const entries = await fs.readdir(SANDBOX_DIR);
    if (entries.length >= MAX_SANDBOX_FILES) {
      throw new Error(
        `Sandbox file limit reached: ${entries.length}/${MAX_SANDBOX_FILES}. Remove old files before creating new ones`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}
