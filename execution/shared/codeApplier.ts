import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import { updateCodeChangeStatus, getCodeChangeById } from "../../state/codeChanges.js";
import {
  buildBranchName,
  createBranch,
  switchToBaseBranch,
  stageFiles,
  commitChanges,
  getBranchDiff,
  getBranchCommits,
  deleteBranch,
} from "./gitManager.js";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = process.cwd();
const LINT_TIMEOUT_MS = 30_000;

const ALLOWED_DIRECTORIES: readonly string[] = [
  "src/",
  "orchestration/",
  "execution/",
  "evaluation/",
  "services/",
  "state/",
  "config/",
  "interfaces/",
];

const FORBIDDEN_FILES: readonly string[] = [
  "agents/kairos/",
  "orchestration/decisionFilter.ts",
  "orchestration/feedbackAdjuster.ts",
  "orchestration/marketingFeedbackAdjuster.ts",
  "config/budget.ts",
  "execution/budgetGate.ts",
  "execution/permissions.ts",
  ".env",
];

const PROTECTED_FILES: ReadonlySet<string> = new Set(["state/schema.sql"]);

const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json", ".sql", ".md"]);

const WHITELISTED_COMMANDS: readonly string[] = ["npx"];
const WHITELISTED_ARGS: readonly string[] = ["eslint", "tsc"];

export interface FileChange {
  readonly path: string;
  readonly action: "create" | "modify";
  readonly content: string;
}

export interface FileBackup {
  readonly path: string;
  readonly existed: boolean;
  readonly originalContent: string | null;
}

export interface LintResult {
  readonly success: boolean;
  readonly output: string;
}

export interface ApplyResult {
  readonly success: boolean;
  readonly diff: string;
  readonly lintOutput: string;
  readonly error?: string;
}

export function validateFilePaths(files: readonly FileChange[]): {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly requiresApproval: boolean;
} {
  const errors: string[] = [];
  let requiresApproval = false;

  for (const file of files) {
    const normalized = path.normalize(file.path);

    if (path.isAbsolute(normalized)) {
      errors.push(`Absolute path not allowed: ${file.path}`);
      continue;
    }

    if (normalized.includes("..")) {
      errors.push(`Path traversal detected: ${file.path}`);
      continue;
    }

    const ext = path.extname(normalized);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      errors.push(`File extension not allowed: ${ext} (${file.path})`);
      continue;
    }

    const isForbidden = FORBIDDEN_FILES.some(
      (forbidden) => normalized === forbidden || normalized.startsWith(forbidden),
    );
    if (isForbidden) {
      errors.push(`Forbidden file: ${file.path}`);
      continue;
    }

    const isAllowed = ALLOWED_DIRECTORIES.some((dir) => normalized.startsWith(dir));
    if (!isAllowed) {
      errors.push(`File outside allowed directories: ${file.path}`);
      continue;
    }

    const isProtected = PROTECTED_FILES.has(normalized);
    if (isProtected) {
      requiresApproval = true;
    }
  }

  return { valid: errors.length === 0, errors, requiresApproval };
}

export function calculateRisk(files: readonly FileChange[], pathsRequireApproval: boolean): number {
  let risk = 1;

  if (files.length > 2) {
    risk += 1;
  }

  const hasModifications = files.some((f) => f.action === "modify");
  if (hasModifications) {
    risk += 1;
  }

  if (pathsRequireApproval) {
    risk = Math.max(risk, 3);
  }

  return Math.min(risk, 5);
}

async function backupFiles(files: readonly FileChange[]): Promise<readonly FileBackup[]> {
  const backups: FileBackup[] = [];

  for (const file of files) {
    const fullPath = path.resolve(PROJECT_ROOT, file.path);

    try {
      const content = await fs.readFile(fullPath, "utf-8");
      backups.push({ path: file.path, existed: true, originalContent: content });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        backups.push({ path: file.path, existed: false, originalContent: null });
      } else {
        throw error;
      }
    }
  }

  return backups;
}

async function writeFiles(files: readonly FileChange[]): Promise<void> {
  for (const file of files) {
    const fullPath = path.resolve(PROJECT_ROOT, file.path);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, file.content, "utf-8");
    logger.info({ path: file.path, action: file.action }, "Code file written");
  }
}

async function restoreBackups(backups: readonly FileBackup[]): Promise<void> {
  for (const backup of backups) {
    const fullPath = path.resolve(PROJECT_ROOT, backup.path);

    if (backup.existed && backup.originalContent !== null) {
      await fs.writeFile(fullPath, backup.originalContent, "utf-8");
      logger.info({ path: backup.path }, "File restored from backup");
    } else if (!backup.existed) {
      try {
        await fs.unlink(fullPath);
        logger.info({ path: backup.path }, "Created file removed during rollback");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.error({ path: backup.path, error }, "Failed to remove file during rollback");
        }
      }
    }
  }
}

function buildDiff(files: readonly FileChange[], backups: readonly FileBackup[]): string {
  const diffEntries: Array<{
    readonly path: string;
    readonly action: string;
    readonly before: string | null;
    readonly after: string;
  }> = [];

  for (const file of files) {
    const backup = backups.find((b) => b.path === file.path);
    diffEntries.push({
      path: file.path,
      action: file.action,
      before: backup?.originalContent ?? null,
      after: file.content,
    });
  }

  return JSON.stringify(diffEntries);
}

async function runEslintFix(filePaths: readonly string[]): Promise<void> {
  const tsFiles = filePaths.filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
  if (tsFiles.length === 0) return;

  try {
    await execFileAsync(
      WHITELISTED_COMMANDS[0],
      [WHITELISTED_ARGS[0], "--fix", ...tsFiles, "--no-error-on-unmatched-pattern"],
      { cwd: PROJECT_ROOT, timeout: LINT_TIMEOUT_MS },
    );
    logger.info({ fileCount: tsFiles.length }, "eslint --fix applied successfully");
  } catch {
    logger.debug("eslint --fix had issues (will be caught in lint check)");
  }
}

async function reReadFiles(files: readonly FileChange[]): Promise<readonly FileChange[]> {
  const updated: FileChange[] = [];

  for (const file of files) {
    const fullPath = path.resolve(PROJECT_ROOT, file.path);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      updated.push({ path: file.path, action: file.action, content });
    } catch {
      updated.push(file);
    }
  }

  return updated;
}

async function runLint(filePaths: readonly string[]): Promise<LintResult> {
  const outputs: string[] = [];
  let allSuccess = true;

  try {
    const { stdout: eslintOut, stderr: eslintErr } = await execFileAsync(
      WHITELISTED_COMMANDS[0],
      [
        WHITELISTED_ARGS[0],
        ...filePaths.filter((f) => f.endsWith(".ts") || f.endsWith(".js")),
        "--no-error-on-unmatched-pattern",
      ],
      { cwd: PROJECT_ROOT, timeout: LINT_TIMEOUT_MS },
    );
    outputs.push(`[eslint] ${eslintOut}${eslintErr}`);
  } catch (error) {
    allSuccess = false;
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    outputs.push(
      `[eslint FAIL] ${execError.stdout ?? ""}${execError.stderr ?? execError.message ?? ""}`,
    );
  }

  try {
    const { stdout: tscOut, stderr: tscErr } = await execFileAsync(
      WHITELISTED_COMMANDS[0],
      [WHITELISTED_ARGS[1], "--noEmit"],
      { cwd: PROJECT_ROOT, timeout: LINT_TIMEOUT_MS },
    );
    outputs.push(`[tsc] ${tscOut}${tscErr}`);
  } catch (error) {
    allSuccess = false;
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    outputs.push(
      `[tsc FAIL] ${execError.stdout ?? ""}${execError.stderr ?? execError.message ?? ""}`,
    );
  }

  return { success: allSuccess, output: outputs.join("\n") };
}

export async function applyCodeChange(
  db: BetterSqlite3.Database,
  changeId: string,
  files: readonly FileChange[],
): Promise<ApplyResult> {
  const change = getCodeChangeById(db, changeId);
  if (!change) {
    return {
      success: false,
      diff: "",
      lintOutput: "",
      error: `Code change not found: ${changeId}`,
    };
  }

  const backups = await backupFiles(files);
  const diff = buildDiff(files, backups);

  try {
    await writeFiles(files);

    const filePaths = files.map((f) => f.path);

    await runEslintFix(filePaths);

    const lintResult = await runLint(filePaths);

    if (lintResult.success) {
      updateCodeChangeStatus(db, changeId, {
        status: "applied",
        diff,
        testOutput: lintResult.output,
        appliedAt: new Date().toISOString(),
      });

      logger.info({ changeId }, "Code change applied successfully");

      return { success: true, diff, lintOutput: lintResult.output };
    }

    logger.warn({ changeId }, "Lint failed after eslint --fix, rolling back code change");
    await restoreBackups(backups);

    updateCodeChangeStatus(db, changeId, {
      status: "failed",
      diff,
      testOutput: lintResult.output,
      error: "Lint validation failed",
    });

    return {
      success: false,
      diff,
      lintOutput: lintResult.output,
      error: "Lint validation failed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ changeId, error: message }, "Code change application failed, rolling back");

    await restoreBackups(backups);

    updateCodeChangeStatus(db, changeId, {
      status: "failed",
      diff,
      error: message,
    });

    return { success: false, diff, lintOutput: "", error: message };
  }
}

export async function applyCodeChangeWithBranch(
  db: BetterSqlite3.Database,
  changeId: string,
  files: readonly FileChange[],
): Promise<ApplyResult> {
  const change = getCodeChangeById(db, changeId);
  if (!change) {
    return {
      success: false,
      diff: "",
      lintOutput: "",
      error: `Code change not found: ${changeId}`,
    };
  }

  const branchName = buildBranchName(changeId);

  try {
    await switchToBaseBranch();
    await createBranch(branchName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ changeId, branchName, error: message }, "Failed to create git branch");
    return {
      success: false,
      diff: "",
      lintOutput: "",
      error: `Git branch creation failed: ${message}`,
    };
  }

  const backups = await backupFiles(files);

  try {
    await writeFiles(files);

    const filePaths = files.map((f) => f.path);

    await runEslintFix(filePaths);
    const fixedFiles = await reReadFiles(files);

    const lintResult = await runLint(filePaths);

    if (lintResult.success) {
      await stageFiles(filePaths);
      const commitMessage = `forge: ${change.description.slice(0, 120)}`;
      const hash = await commitChanges(commitMessage);

      const diff = await getBranchDiff(branchName);
      const commits = await getBranchCommits(branchName);
      const commitsJson = JSON.stringify(commits);

      await switchToBaseBranch();

      updateCodeChangeStatus(db, changeId, {
        status: "applied",
        diff,
        testOutput: lintResult.output,
        appliedAt: new Date().toISOString(),
        branchName,
        commits: commitsJson,
      });

      logger.info(
        { changeId, branchName, commitHash: hash, autoFixed: files !== fixedFiles },
        "Code change applied with branch successfully",
      );

      return { success: true, diff, lintOutput: lintResult.output };
    }

    logger.warn({ changeId, branchName }, "Lint failed after eslint --fix, rolling back");
    await restoreBackups(backups);
    await switchToBaseBranch();
    await deleteBranch(branchName);

    return {
      success: false,
      diff: "",
      lintOutput: lintResult.output,
      error: "Lint validation failed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { changeId, branchName, error: message },
      "Branch code change failed, rolling back",
    );

    await restoreBackups(backups);

    try {
      await switchToBaseBranch();
      await deleteBranch(branchName);
    } catch (cleanupError) {
      const cleanupMsg =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      logger.error({ branchName, error: cleanupMsg }, "Failed to cleanup branch after error");
    }

    return { success: false, diff: "", lintOutput: "", error: message };
  }
}

export async function rollbackCodeChange(
  db: BetterSqlite3.Database,
  changeId: string,
): Promise<boolean> {
  const change = getCodeChangeById(db, changeId);
  if (!change?.diff) {
    logger.error({ changeId }, "Cannot rollback: no diff found");
    return false;
  }

  try {
    const diffEntries = JSON.parse(change.diff) as ReadonlyArray<{
      readonly path: string;
      readonly action: string;
      readonly before: string | null;
    }>;

    const backups: FileBackup[] = diffEntries.map((entry) => ({
      path: entry.path,
      existed: entry.before !== null,
      originalContent: entry.before,
    }));

    await restoreBackups(backups);

    updateCodeChangeStatus(db, changeId, { status: "rolled_back" });

    logger.info({ changeId }, "Code change rolled back successfully");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ changeId, error: message }, "Code change rollback failed");
    return false;
  }
}
