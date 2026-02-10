import path from "node:path";
import fs from "node:fs/promises";

const PROJECT_ROOT = process.cwd();
const SANDBOX_DIR = path.resolve(PROJECT_ROOT, "sandbox", "forge");

const MAX_FILENAME_LENGTH = 200;
const MAX_SANDBOX_FILES = 100;
const SAFE_FILENAME_REGEX = /^[a-z0-9][a-z0-9./-]*$/;

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
