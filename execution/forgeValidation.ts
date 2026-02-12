import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../config/logger.js";
import {
  parseTscErrors,
  parseEslintErrors,
  separateErrorsAndWarnings,
} from "./forgeErrorParser.js";
import type { StructuredError } from "./forgeErrorParser.js";
import { applyAutoFixes } from "./forgeAutoFix.js";
import type { AutoFixResult } from "./forgeAutoFix.js";
import { detectMissingImports, installMissingPackages, detectPackageManager } from "./forgeDependencyInstaller.js";
import { findRelatedTestFiles, runRelatedTests } from "./forgeTestRunner.js";
import type { TestResult } from "./forgeTestRunner.js";

export interface ValidationConfig {
  readonly runBuild: boolean;
  readonly buildTimeout: number;
  readonly enableAutoFix: boolean;
  readonly enableStructuredErrors: boolean;
  readonly enableTestExecution: boolean;
  readonly testTimeout: number;
}

export interface ValidationResult {
  readonly success: boolean;
  readonly output: string;
  readonly errors: readonly StructuredError[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly autoFixResult?: AutoFixResult;
  readonly testResult?: TestResult;
}

type ExecFileAsync = (
  file: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeout: number },
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

const ESLINT_CONFIG_ERROR_PATTERNS = [
  "Oops! Something went wrong!",
  "Error while loading rule",
  "You have used a rule which requires",
  "Error: Failed to load",
  "Cannot read config file",
  "ESLintrc configuration is no longer supported",
] as const;

const LINT_TIMEOUT_MS = 60_000;

export async function runLintCheck(
  filePaths: readonly string[],
  workspacePath: string,
  validationConfig?: ValidationConfig,
): Promise<ValidationResult> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const lintableFiles = filePaths.filter(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx"),
  );

  await runPreFixPass(execFileAsync, lintableFiles, filePaths, workspacePath);

  const coreResult = await runCoreValidation(execFileAsync, lintableFiles, workspacePath, validationConfig);

  if (!coreResult.allSuccess && validationConfig?.enableAutoFix) {
    const autoFixResult = await tryAutoFixAndRevalidate(
      execFileAsync, coreResult.allErrors, lintableFiles, workspacePath, validationConfig,
    );
    if (autoFixResult) return autoFixResult;
  }

  return buildFinalResult(coreResult, filePaths, workspacePath, validationConfig);
}

async function runPreFixPass(
  execFileAsync: ExecFileAsync,
  lintableFiles: readonly string[],
  filePaths: readonly string[],
  workspacePath: string,
): Promise<void> {
  if (lintableFiles.length === 0) return;

  await runEslintFix(execFileAsync, lintableFiles, workspacePath, LINT_TIMEOUT_MS);
  const firstLint = await runEslintCheck(execFileAsync, lintableFiles, workspacePath, LINT_TIMEOUT_MS);
  if (firstLint.success) return;

  const fixed = await fixUnusedImportsFromLint(filePaths, workspacePath, firstLint.output);
  if (fixed) {
    await runEslintFix(execFileAsync, lintableFiles, workspacePath, LINT_TIMEOUT_MS);
  }
}

interface CoreValidationResult {
  readonly outputs: readonly string[];
  readonly allSuccess: boolean;
  readonly allErrors: readonly StructuredError[];
}

async function runCoreValidation(
  execFileAsync: ExecFileAsync,
  lintableFiles: readonly string[],
  workspacePath: string,
  validationConfig?: ValidationConfig,
): Promise<CoreValidationResult> {
  const outputs: string[] = [];
  let allSuccess = true;
  let allErrors: StructuredError[] = [];

  if (lintableFiles.length > 0) {
    const eslintResult = await runEslintCheck(execFileAsync, lintableFiles, workspacePath, LINT_TIMEOUT_MS);
    outputs.push(eslintResult.output);
    if (!eslintResult.success) allSuccess = false;

    if (validationConfig?.enableStructuredErrors) {
      allErrors = [...allErrors, ...parseEslintErrors(eslintResult.output)];
    }
  }

  const tscResult = await runTscCheck(execFileAsync, workspacePath, LINT_TIMEOUT_MS);
  outputs.push(tscResult.output);
  if (!tscResult.success) allSuccess = false;

  if (validationConfig?.enableStructuredErrors) {
    allErrors = [...allErrors, ...parseTscErrors(tscResult.output)];
  }

  if (allSuccess && validationConfig?.runBuild) {
    const buildResult = await runBuildCheck(execFileAsync, workspacePath, validationConfig.buildTimeout);
    outputs.push(buildResult.output);
    if (!buildResult.success) allSuccess = false;
  }

  return { outputs, allSuccess, allErrors };
}

async function buildFinalResult(
  coreResult: CoreValidationResult,
  filePaths: readonly string[],
  workspacePath: string,
  validationConfig?: ValidationConfig,
): Promise<ValidationResult> {
  const { errors, warnings } = separateErrorsAndWarnings(coreResult.allErrors);
  const outputs = [...coreResult.outputs];
  let allSuccess = coreResult.allSuccess;

  let testResult: TestResult | undefined;
  if (allSuccess && validationConfig?.enableTestExecution) {
    const testFiles = await findRelatedTestFiles(filePaths, workspacePath);
    testResult = await runRelatedTests(testFiles, workspacePath, validationConfig.testTimeout);
    outputs.push(testResult.output);
    if (!testResult.success) allSuccess = false;
  }

  return {
    success: allSuccess,
    output: outputs.join("\n"),
    errors: allSuccess ? [] : errors,
    errorCount: errors.length,
    warningCount: warnings.length,
    testResult,
  };
}

async function tryAutoFixAndRevalidate(
  execFileAsync: ExecFileAsync,
  allErrors: readonly StructuredError[],
  lintableFiles: readonly string[],
  workspacePath: string,
  validationConfig: ValidationConfig,
): Promise<ValidationResult | null> {
  const missingPackages = await tryInstallMissingDeps(allErrors, workspacePath);
  const autoFixResult = await applyAutoFixes(allErrors, workspacePath);

  if (autoFixResult.fixedCount === 0 && missingPackages.length === 0) return null;

  logger.info({ fixedCount: autoFixResult.fixedCount }, "Auto-fix applied, re-validating");

  const revalidation = await runCoreValidation(execFileAsync, lintableFiles, workspacePath, validationConfig);
  const { errors, warnings } = separateErrorsAndWarnings(revalidation.allErrors);

  return {
    success: revalidation.allSuccess,
    output: revalidation.outputs.join("\n"),
    errors: revalidation.allSuccess ? [] : errors,
    errorCount: errors.length,
    warningCount: warnings.length,
    autoFixResult,
  };
}

async function tryInstallMissingDeps(
  errors: readonly StructuredError[],
  workspacePath: string,
): Promise<readonly string[]> {
  const missingPackages = detectMissingImports(errors);
  if (missingPackages.length === 0) return [];

  const pm = await detectPackageManager(workspacePath);
  const installResult = await installMissingPackages(missingPackages, workspacePath, pm);
  if (installResult.success) {
    logger.info({ packages: missingPackages }, "Auto-installed missing packages, re-validating");
  }
  return missingPackages;
}

function stripNpmWarnings(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("npm warn") && !line.startsWith("npm WARN"))
    .join("\n")
    .trim();
}

function isEslintConfigError(output: string): boolean {
  return ESLINT_CONFIG_ERROR_PATTERNS.some((pattern) => output.includes(pattern));
}

async function runEslintFix(
  execFileAsync: ExecFileAsync,
  files: readonly string[],
  workspacePath: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await execFileAsync(
      "npx",
      ["eslint", "--fix", ...files, "--no-error-on-unmatched-pattern"],
      { cwd: workspacePath, timeout: timeoutMs },
    );
  } catch {
    // eslint --fix errors are caught in the validation step
  }
}

async function runEslintCheck(
  execFileAsync: ExecFileAsync,
  files: readonly string[],
  workspacePath: string,
  timeoutMs: number,
): Promise<{ readonly success: boolean; readonly output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["eslint", ...files, "--no-error-on-unmatched-pattern"],
      { cwd: workspacePath, timeout: timeoutMs },
    );
    const cleaned = stripNpmWarnings(`${stdout}${stderr}`);
    return { success: true, output: `[eslint] ${cleaned}` };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const raw = `${execError.stdout ?? ""}${execError.stderr ?? execError.message ?? ""}`;
    const cleaned = stripNpmWarnings(raw);
    if (cleaned.length === 0) {
      return { success: true, output: "[eslint] OK (warnings only)" };
    }
    if (isEslintConfigError(cleaned)) {
      logger.warn("ESLint config/environment error detected, skipping eslint validation");
      return { success: true, output: "[eslint] SKIPPED (config error in target project)" };
    }
    return { success: false, output: `[eslint FAIL] ${cleaned}` };
  }
}

async function runTscCheck(
  execFileAsync: ExecFileAsync,
  workspacePath: string,
  timeoutMs: number,
): Promise<{ readonly success: boolean; readonly output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["tsc", "--noEmit", "--incremental"],
      { cwd: workspacePath, timeout: timeoutMs },
    );
    const cleaned = stripNpmWarnings(`${stdout}${stderr}`);
    return { success: true, output: `[tsc] ${cleaned}` };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const raw = `${execError.stdout ?? ""}${execError.stderr ?? execError.message ?? ""}`;
    const cleaned = stripNpmWarnings(raw);
    if (cleaned.length === 0) {
      return { success: true, output: "[tsc] OK (warnings only)" };
    }
    return { success: false, output: `[tsc FAIL] ${cleaned}` };
  }
}

async function detectBuildScript(workspacePath: string): Promise<string | null> {
  try {
    const pkgPath = path.join(workspacePath, "package.json");
    const raw = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return pkg.scripts?.build ?? null;
  } catch {
    return null;
  }
}

async function runBuildCheck(
  execFileAsync: ExecFileAsync,
  workspacePath: string,
  timeoutMs: number,
): Promise<{ readonly success: boolean; readonly output: string }> {
  const buildScript = await detectBuildScript(workspacePath);

  if (!buildScript) {
    logger.info("No build script found in package.json, skipping build check");
    return { success: true, output: "[build] SKIPPED (no build script in package.json)" };
  }

  const packageManager = await detectLocalPackageManager(workspacePath);
  logger.info({ buildScript, packageManager }, "Running project build check");

  try {
    const { stdout, stderr } = await execFileAsync(
      packageManager,
      ["run", "build"],
      { cwd: workspacePath, timeout: timeoutMs },
    );
    const cleaned = stripNpmWarnings(`${stdout}${stderr}`);
    return { success: true, output: `[build] ${cleaned}` };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const raw = `${execError.stdout ?? ""}${execError.stderr ?? execError.message ?? ""}`;
    const cleaned = stripNpmWarnings(raw);
    if (cleaned.length === 0) {
      return { success: true, output: "[build] OK (warnings only)" };
    }
    return { success: false, output: `[build FAIL] ${cleaned.slice(0, 3000)}` };
  }
}

async function detectLocalPackageManager(workspacePath: string): Promise<string> {
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

async function fixUnusedImportsFromLint(
  filePaths: readonly string[],
  workspacePath: string,
  lintOutput: string,
): Promise<boolean> {
  const unusedByFile = parseUnusedFromLintOutput(lintOutput);
  if (unusedByFile.size === 0) return false;

  let anyFixed = false;

  for (const filePath of filePaths) {
    const fullPath = path.join(workspacePath, filePath);
    const matchingKey = [...unusedByFile.keys()].find((k) => k.endsWith(filePath));
    if (!matchingKey) continue;

    const unusedNames = unusedByFile.get(matchingKey);
    if (!unusedNames || unusedNames.length === 0) continue;

    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const fixed = removeUnusedImportNames(content, unusedNames);
      if (fixed === content) continue;

      await fs.writeFile(fullPath, fixed, "utf-8");
      logger.info({ path: filePath, removedImports: unusedNames }, "Auto-removed unused imports");
      anyFixed = true;
    } catch {
      logger.debug({ path: filePath }, "Could not fix unused imports");
    }
  }

  return anyFixed;
}

function parseUnusedFromLintOutput(lintOutput: string): Map<string, string[]> {
  const unusedByFile = new Map<string, string[]>();
  let currentFile = "";

  for (const line of lintOutput.split("\n")) {
    const fileMatch = /\/([^/\s]+\.tsx?)$/.exec(line.trim());
    if (fileMatch) {
      currentFile = line.trim();
      continue;
    }

    const unusedMatch = /^\s*\d+:\d+\s+error\s+'(\w+)' is defined but never used/.exec(line);
    if (unusedMatch && currentFile) {
      const existing = unusedByFile.get(currentFile) ?? [];
      existing.push(unusedMatch[1]);
      unusedByFile.set(currentFile, existing);
    }
  }

  return unusedByFile;
}

function removeUnusedImportNames(content: string, unusedNames: readonly string[]): string {
  const lines = content.split("\n");
  const result: string[] = [];
  const unusedSet = new Set(unusedNames);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trimStart().startsWith("import")) {
      result.push(line);
      i++;
      continue;
    }

    let importBlock = line;
    let endIdx = i;
    while (!importBlock.includes("from") && endIdx < lines.length - 1) {
      endIdx++;
      importBlock += "\n" + lines[endIdx];
    }

    const cleaned = cleanImportStatement(importBlock, unusedSet);
    if (cleaned !== null) {
      result.push(cleaned);
    }

    i = endIdx + 1;
  }

  return result.join("\n");
}

function cleanImportStatement(importBlock: string, unusedSet: ReadonlySet<string>): string | null {
  const namedMatch = /\{([^}]+)\}/.exec(importBlock);
  if (!namedMatch) return importBlock;

  const specifiers = namedMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const remaining = specifiers.filter((spec) => {
    const name = spec.includes(" as ") ? spec.split(" as ")[1].trim() : spec.replace("type ", "").trim();
    return !unusedSet.has(name);
  });

  if (remaining.length === specifiers.length) return importBlock;

  if (remaining.length === 0) {
    const hasDefault = /^import\s+\w+\s*,/.test(importBlock.trim());
    if (hasDefault) {
      return importBlock.replace(/,\s*\{[^}]*\}/, "");
    }
    return null;
  }

  const newSpecifiers = remaining.length <= 2
    ? `{ ${remaining.join(", ")} }`
    : `{\n  ${remaining.join(",\n  ")}\n}`;

  return importBlock.replace(/\{[^}]*\}/, newSpecifiers);
}

export { formatErrorsForPrompt } from "./forgeErrorParser.js";
export type { StructuredError } from "./forgeErrorParser.js";
