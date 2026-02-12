import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";
import type { StructuredError } from "./forgeErrorParser.js";

const MODULE_NOT_FOUND_CODE = "TS2307";
const INSTALL_TIMEOUT_MS = 60_000;

const BUILTIN_MODULES = new Set([
  "node:fs", "node:path", "node:child_process", "node:util", "node:crypto",
  "node:os", "node:url", "node:http", "node:https", "node:stream",
  "node:events", "node:buffer", "node:net", "node:tls", "node:dns",
  "node:assert", "node:test", "node:worker_threads", "node:cluster",
  "fs", "path", "child_process", "util", "crypto", "os", "url",
  "http", "https", "stream", "events", "buffer", "net", "tls",
]);

export function detectMissingImports(
  errors: readonly StructuredError[],
): readonly string[] {
  const packages = new Set<string>();
  const moduleRegex = /Cannot find module '([^']+)'/;

  for (const err of errors) {
    if (err.code !== MODULE_NOT_FOUND_CODE) continue;

    const match = moduleRegex.exec(err.message);
    if (!match) continue;

    const moduleName = match[1];
    if (isRelativeImport(moduleName)) continue;
    if (BUILTIN_MODULES.has(moduleName)) continue;

    const packageName = extractPackageName(moduleName);
    if (packageName) packages.add(packageName);
  }

  return [...packages];
}

function isRelativeImport(moduleName: string): boolean {
  return moduleName.startsWith(".") || moduleName.startsWith("/");
}

function extractPackageName(moduleName: string): string | null {
  if (moduleName.startsWith("@")) {
    const parts = moduleName.split("/");
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return null;
  }

  const parts = moduleName.split("/");
  return parts[0];
}

export async function installMissingPackages(
  packages: readonly string[],
  workspacePath: string,
  packageManager: string,
): Promise<{ readonly success: boolean; readonly output: string }> {
  if (packages.length === 0) {
    return { success: true, output: "" };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const safePackages = packages.filter(isValidPackageName);
  if (safePackages.length === 0) {
    return { success: false, output: "No valid package names to install" };
  }

  const installCmd = buildInstallCommand(packageManager, safePackages);

  logger.info(
    { packages: safePackages, packageManager },
    "Auto-installing missing dependencies",
  );

  try {
    const { stdout, stderr } = await execFileAsync(
      installCmd.command,
      installCmd.args,
      { cwd: workspacePath, timeout: INSTALL_TIMEOUT_MS },
    );
    const output = `${stdout}${stderr}`.trim();
    logger.info({ packages: safePackages }, "Dependencies installed successfully");
    return { success: true, output };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${execError.stdout ?? ""}${execError.stderr ?? execError.message ?? ""}`.trim();
    logger.warn({ packages: safePackages, error: output.slice(0, 200) }, "Dependency installation failed");
    return { success: false, output };
  }
}

function isValidPackageName(name: string): boolean {
  if (name.length === 0 || name.length > 214) return false;
  if (/[;&|`$]/.test(name)) return false;
  return /^(@[\w.-]+\/)?[\w.-]+$/.test(name);
}

function buildInstallCommand(
  packageManager: string,
  packages: readonly string[],
): { readonly command: string; readonly args: readonly string[] } {
  switch (packageManager) {
    case "pnpm":
      return { command: "pnpm", args: ["add", ...packages] };
    case "yarn":
      return { command: "yarn", args: ["add", ...packages] };
    default:
      return { command: "npm", args: ["install", "--save", ...packages] };
  }
}

export async function detectPackageManager(workspacePath: string): Promise<string> {
  try {
    await fs.access(path.join(workspacePath, "pnpm-lock.yaml"));
    return "pnpm";
  } catch { /* not pnpm */ }

  try {
    await fs.access(path.join(workspacePath, "yarn.lock"));
    return "yarn";
  } catch { /* not yarn */ }

  return "npm";
}
