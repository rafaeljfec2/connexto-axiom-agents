import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../config/logger.js";

export interface TestResult {
  readonly success: boolean;
  readonly output: string;
  readonly failedTests: readonly string[];
}

const TEST_SUFFIXES = [
  ".test.ts", ".test.tsx", ".test.js", ".test.jsx",
  ".spec.ts", ".spec.tsx", ".spec.js", ".spec.jsx",
] as const;

const TEST_DIR_PATTERNS = [
  "__tests__",
  "tests",
  "test",
] as const;

export async function findRelatedTestFiles(
  changedFiles: readonly string[],
  workspacePath: string,
): Promise<readonly string[]> {
  const testFiles = new Set<string>();

  for (const changedFile of changedFiles) {
    const candidates = generateTestFileCandidates(changedFile);

    for (const candidate of candidates) {
      const fullPath = path.join(workspacePath, candidate);
      try {
        await fs.access(fullPath);
        testFiles.add(candidate);
      } catch {
        continue;
      }
    }
  }

  return [...testFiles];
}

function generateTestFileCandidates(filePath: string): readonly string[] {
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);
  const dir = path.dirname(filePath);
  const candidates: string[] = [];

  for (const suffix of TEST_SUFFIXES) {
    candidates.push(path.join(dir, `${baseName}${suffix}`));
  }

  for (const testDir of TEST_DIR_PATTERNS) {
    for (const suffix of TEST_SUFFIXES) {
      candidates.push(path.join(dir, testDir, `${baseName}${suffix}`));
    }

    const parentDir = path.dirname(dir);
    if (parentDir !== ".") {
      for (const suffix of TEST_SUFFIXES) {
        candidates.push(path.join(parentDir, testDir, `${baseName}${suffix}`));
      }
    }
  }

  return candidates;
}

export async function runRelatedTests(
  testFiles: readonly string[],
  workspacePath: string,
  timeout: number,
): Promise<TestResult> {
  if (testFiles.length === 0) {
    return { success: true, output: "[tests] No related test files found", failedTests: [] };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const runner = await detectTestRunner(workspacePath);

  logger.info(
    { testFiles, runner: runner.name },
    "Running related tests",
  );

  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      [...runner.args, ...testFiles],
      { cwd: workspacePath, timeout },
    );

    const output = `${stdout}${stderr}`.trim();
    return { success: true, output: `[tests] ${output}`, failedTests: [] };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${execError.stdout ?? ""}${execError.stderr ?? execError.message ?? ""}`.trim();
    const failedTests = parseFailedTests(output);

    logger.warn(
      { failedCount: failedTests.length, runner: runner.name },
      "Related tests failed",
    );

    return {
      success: false,
      output: `[tests FAIL] ${output.slice(0, 3000)}`,
      failedTests,
    };
  }
}

interface TestRunnerConfig {
  readonly name: string;
  readonly args: readonly string[];
}

async function detectTestRunner(workspacePath: string): Promise<TestRunnerConfig> {
  try {
    const pkgPath = path.join(workspacePath, "package.json");
    const raw = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps.vitest) {
      return { name: "vitest", args: ["vitest", "run", "--reporter=verbose"] };
    }

    if (allDeps.jest || allDeps["@jest/core"] || allDeps["ts-jest"]) {
      return { name: "jest", args: ["jest", "--verbose", "--no-coverage"] };
    }
  } catch {
    logger.debug("Could not read package.json for test runner detection");
  }

  return { name: "vitest", args: ["vitest", "run", "--reporter=verbose"] };
}

function parseFailedTests(output: string): readonly string[] {
  const failed: string[] = [];
  const failRegex = /(?:FAIL|✗|✘|×)\s+(.+)/g;

  for (const match of output.matchAll(failRegex)) {
    const testName = match[1].trim();
    if (testName.length > 0 && testName.length < 200) {
      failed.push(testName);
    }
  }

  return failed;
}
