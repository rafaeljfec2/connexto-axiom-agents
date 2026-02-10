import path from "node:path";
import fs from "node:fs/promises";

const PROJECT_ROOT = process.cwd();
const SANDBOX_DIR = path.resolve(PROJECT_ROOT, "sandbox", "forge");

export async function ensureSandbox(): Promise<void> {
  await fs.mkdir(SANDBOX_DIR, { recursive: true });
}

export function resolveSandboxPath(filename: string): string {
  const resolved = path.resolve(SANDBOX_DIR, filename);
  const relative = path.relative(SANDBOX_DIR, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError(`Path traversal detected: "${filename}" resolves outside sandbox`);
  }

  return resolved;
}
