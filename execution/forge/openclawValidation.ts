import { execFile } from "node:child_process";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "../../config/logger.js";

const execFileAsync = promisify(execFile);

const VALIDATION_TIMEOUT_MS = 90_000;

export type ValidationStepResult = "ok" | "fail" | "skipped";

export type ExecutionStatus = "SUCCESS" | "PARTIAL_SUCCESS" | "FAILURE";

export interface ValidationResults {
  readonly install: ValidationStepResult;
  readonly lint: ValidationStepResult;
  readonly build: ValidationStepResult;
  readonly tests: ValidationStepResult;
}

export interface ValidationCycleResult {
  readonly passed: boolean;
  readonly results: ValidationResults;
  readonly errorOutput: string;
}

export const DEFAULT_VALIDATIONS: ValidationResults = {
  install: "skipped",
  lint: "skipped",
  build: "skipped",
  tests: "skipped",
};

async function runValidationStep(
  cmd: string,
  args: readonly string[],
  cwd: string,
): Promise<{ readonly ok: boolean; readonly output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, [...args], {
      cwd,
      timeout: VALIDATION_TIMEOUT_MS,
    });
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${execError.stdout ?? ""}${execError.stderr ?? execError.message ?? ""}`.trim();
    return { ok: false, output };
  }
}

async function hasPackageJson(workspacePath: string): Promise<boolean> {
  try {
    await fsPromises.access(path.join(workspacePath, "package.json"));
    return true;
  } catch {
    return false;
  }
}

async function hasTestScript(workspacePath: string): Promise<boolean> {
  try {
    const content = await fsPromises.readFile(path.join(workspacePath, "package.json"), "utf-8");
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> };
    return Boolean(pkg.scripts?.["test"]);
  } catch {
    return false;
  }
}

async function unlinkSymlinkedNodeModules(workspacePath: string): Promise<void> {
  const nmPath = path.join(workspacePath, "node_modules");
  try {
    const stat = await fsPromises.lstat(nmPath);
    if (stat.isSymbolicLink()) {
      await fsPromises.unlink(nmPath);
      logger.info("Removed symlinked node_modules before install validation");
    }
  } catch {
    // node_modules doesn't exist — nothing to do
  }
}

async function validateInstall(
  workspacePath: string,
  errors: string[],
): Promise<ValidationStepResult> {
  logger.info({ step: "install" }, "Validation step starting: pnpm install");

  await unlinkSymlinkedNodeModules(workspacePath);

  const frozen = await runValidationStep("pnpm", ["install", "--frozen-lockfile"], workspacePath);
  if (frozen.ok) return "ok";

  const fallback = await runValidationStep("pnpm", ["install"], workspacePath);
  if (fallback.ok) return "ok";

  errors.push(`[install FAIL] ${fallback.output}`);
  return "fail";
}

async function validateLint(
  workspacePath: string,
  changedFiles: readonly string[],
  errors: string[],
): Promise<ValidationStepResult> {
  const lintableFiles = changedFiles.filter(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx"),
  );
  if (lintableFiles.length === 0) return "skipped";

  logger.info({ step: "lint", fileCount: lintableFiles.length }, "Validation step starting: eslint");
  const result = await runValidationStep(
    "npx", ["eslint", ...lintableFiles, "--no-error-on-unmatched-pattern"], workspacePath,
  );
  if (!result.ok) errors.push(`[lint FAIL] ${result.output}`);
  return result.ok ? "ok" : "fail";
}

async function validateBuild(
  workspacePath: string,
  errors: string[],
): Promise<ValidationStepResult> {
  logger.info({ step: "build" }, "Validation step starting: tsc --noEmit");
  const result = await runValidationStep("npx", ["tsc", "--noEmit"], workspacePath);
  if (!result.ok) errors.push(`[build FAIL] ${result.output}`);
  return result.ok ? "ok" : "fail";
}

async function validateTests(
  workspacePath: string,
  errors: string[],
): Promise<ValidationStepResult> {
  const hasTests = await hasTestScript(workspacePath);
  if (!hasTests) return "skipped";

  logger.info({ step: "tests" }, "Validation step starting: pnpm test");
  const result = await runValidationStep("pnpm", ["test", "--", "--run"], workspacePath);
  if (!result.ok) errors.push(`[tests FAIL] ${result.output}`);
  return result.ok ? "ok" : "fail";
}

export interface ValidationCycleOptions {
  readonly skipBuild?: boolean;
}

export async function runValidationCycle(
  workspacePath: string,
  changedFiles: readonly string[],
  options?: ValidationCycleOptions,
): Promise<ValidationCycleResult> {
  const errors: string[] = [];
  const hasPkg = await hasPackageJson(workspacePath);

  logger.info({ changedFiles: changedFiles.length, hasPkg, skipBuild: options?.skipBuild ?? false }, "Starting validation cycle");

  const install = hasPkg ? await validateInstall(workspacePath, errors) : "skipped" as ValidationStepResult;
  const lint = await validateLint(workspacePath, changedFiles, errors);

  let build: ValidationStepResult;
  if (options?.skipBuild) {
    logger.info("Skipping build validation (baseline build pre-failed)");
    build = "skipped" as ValidationStepResult;
  } else {
    build = hasPkg ? await validateBuild(workspacePath, errors) : "skipped" as ValidationStepResult;
  }

  const tests = hasPkg ? await validateTests(workspacePath, errors) : "skipped" as ValidationStepResult;

  const results: ValidationResults = { install, lint, build, tests };
  const passed = errors.length === 0;

  logger.info({ passed, results, errorCount: errors.length }, "Validation cycle completed");

  return { passed, results, errorOutput: errors.join("\n\n") };
}
