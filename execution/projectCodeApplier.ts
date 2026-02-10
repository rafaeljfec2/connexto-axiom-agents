import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { updateCodeChangeStatus, getCodeChangeById } from "../state/codeChanges.js";
import {
  buildBranchName,
  createBranch,
  switchToMain,
  stageFiles,
  commitChanges,
  getBranchDiff,
  getBranchCommits,
  deleteBranch,
} from "./projectGitManager.js";
import {
  validateProjectFilePaths,
  sanitizeWorkspacePath,
  type FileChange,
  type FileEdit,
} from "./projectSecurity.js";

const execFileAsync = promisify(execFile);

const LINT_TIMEOUT_MS = 60_000;

export interface FileBackup {
  readonly path: string;
  readonly existed: boolean;
  readonly originalContent: string | null;
}

export interface LintResult {
  readonly success: boolean;
  readonly output: string;
}

export interface ProjectApplyResult {
  readonly success: boolean;
  readonly diff: string;
  readonly lintOutput: string;
  readonly error?: string;
}

export function validateAndCalculateRisk(
  files: readonly FileChange[],
  workspacePath: string,
): { readonly valid: boolean; readonly errors: readonly string[]; readonly risk: number } {
  const validation = validateProjectFilePaths(files, workspacePath);
  if (!validation.valid) {
    return { valid: false, errors: validation.errors, risk: 5 };
  }

  let risk = 1;
  if (files.length > 2) risk += 1;
  if (files.some((f) => f.action === "modify")) risk += 1;
  if (validation.requiresApproval) risk = Math.max(risk, 3);

  return { valid: true, errors: [], risk: Math.min(risk, 5) };
}

export async function applyProjectCodeChange(
  db: BetterSqlite3.Database,
  changeId: string,
  files: readonly FileChange[],
  workspacePath: string,
): Promise<ProjectApplyResult> {
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
    await switchToMain(workspacePath);
    await createBranch(branchName, workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ changeId, branchName, error: message }, "Failed to create git branch in workspace");
    return {
      success: false,
      diff: "",
      lintOutput: "",
      error: `Git branch creation failed: ${message}`,
    };
  }

  const backups = await backupFiles(files, workspacePath);

  try {
    await writeFiles(files, workspacePath);

    const filePaths = files.map((f) => f.path);

    await runEslintFix(filePaths, workspacePath);

    const lintResult = await runLint(filePaths, workspacePath);

    if (lintResult.success) {
      await stageFiles(filePaths, workspacePath);
      const commitMessage = `forge: ${change.description.slice(0, 120)}`;
      const hash = await commitChanges(commitMessage, workspacePath);

      const diff = await getBranchDiff(branchName, workspacePath);
      const commits = await getBranchCommits(branchName, workspacePath);
      const commitsJson = JSON.stringify(commits);

      await switchToMain(workspacePath);

      updateCodeChangeStatus(db, changeId, {
        status: "applied",
        diff,
        testOutput: lintResult.output,
        appliedAt: new Date().toISOString(),
        branchName,
        commits: commitsJson,
      });

      logger.info(
        { changeId, branchName, commitHash: hash, workspacePath },
        "Project code change applied with branch",
      );

      return { success: true, diff, lintOutput: lintResult.output };
    }

    logger.warn(
      { changeId, branchName, lintOutput: lintResult.output },
      "Lint failed in project workspace, rolling back",
    );
    await restoreBackups(backups, workspacePath);
    await switchToMain(workspacePath);
    await deleteBranch(branchName, workspacePath);

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
      "Project code change failed, rolling back",
    );

    await restoreBackups(backups, workspacePath);

    try {
      await switchToMain(workspacePath);
      await deleteBranch(branchName, workspacePath);
    } catch (cleanupError) {
      const cleanupMsg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      logger.error({ branchName, error: cleanupMsg }, "Failed to cleanup branch after error");
    }

    return { success: false, diff: "", lintOutput: "", error: message };
  }
}

async function backupFiles(
  files: readonly FileChange[],
  workspacePath: string,
): Promise<readonly FileBackup[]> {
  const backups: FileBackup[] = [];

  for (const file of files) {
    const fullPath = sanitizeWorkspacePath(workspacePath, file.path);

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

async function writeFiles(
  files: readonly FileChange[],
  workspacePath: string,
): Promise<void> {
  for (const file of files) {
    const fullPath = sanitizeWorkspacePath(workspacePath, file.path);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });

    if (file.action === "modify" && file.edits && file.edits.length > 0) {
      await applySearchReplaceEdits(fullPath, file.path, file.edits);
    } else {
      await fs.writeFile(fullPath, file.content, "utf-8");
    }

    logger.info({ path: file.path, action: file.action, workspacePath }, "Project file written");
  }
}

async function applySearchReplaceEdits(
  fullPath: string,
  relativePath: string,
  edits: readonly FileEdit[],
): Promise<void> {
  let content = await fs.readFile(fullPath, "utf-8");

  for (const edit of edits) {
    const index = content.indexOf(edit.search);
    if (index === -1) {
      const trimmedSearch = edit.search.trim();
      const trimmedIndex = findTrimmedMatch(content, trimmedSearch);

      if (trimmedIndex === -1) {
        logger.error(
          {
            path: relativePath,
            searchPreview: edit.search.slice(0, 100),
            searchLength: edit.search.length,
          },
          "Search string not found in file for edit",
        );
        throw new Error(
          `Search/replace failed: search string not found in ${relativePath}`,
        );
      }

      logger.debug({ path: relativePath }, "Search matched with trimmed whitespace fallback");
      const matchEnd = findTrimmedMatchEnd(content, trimmedSearch, trimmedIndex);
      content = content.slice(0, trimmedIndex) + edit.replace + content.slice(matchEnd);
    } else {
      content = content.slice(0, index) + edit.replace + content.slice(index + edit.search.length);
    }
  }

  await fs.writeFile(fullPath, content, "utf-8");
}

function findTrimmedMatch(content: string, trimmedSearch: string): number {
  const lines = content.split("\n");
  const searchLines = trimmedSearch.split("\n").map((l) => l.trim());

  for (let i = 0; i <= lines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (lines[i + j].trim() !== searchLines[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      let charIndex = 0;
      for (let k = 0; k < i; k++) {
        charIndex += lines[k].length + 1;
      }
      return charIndex;
    }
  }
  return -1;
}

function findTrimmedMatchEnd(content: string, trimmedSearch: string, startIndex: number): number {
  const lines = content.split("\n");
  const searchLines = trimmedSearch.split("\n").map((l) => l.trim());

  let charIndex = 0;
  let lineIndex = 0;
  for (let k = 0; k < lines.length; k++) {
    if (charIndex <= startIndex && startIndex < charIndex + lines[k].length + 1) {
      lineIndex = k;
      break;
    }
    charIndex += lines[k].length + 1;
  }

  let endIndex = 0;
  for (let k = 0; k < lineIndex + searchLines.length; k++) {
    endIndex += lines[k].length + 1;
  }

  return endIndex - 1;
}

async function restoreBackups(
  backups: readonly FileBackup[],
  workspacePath: string,
): Promise<void> {
  for (const backup of backups) {
    const fullPath = sanitizeWorkspacePath(workspacePath, backup.path);

    if (backup.existed && backup.originalContent !== null) {
      await fs.writeFile(fullPath, backup.originalContent, "utf-8");
      logger.info({ path: backup.path }, "Project file restored from backup");
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

async function runEslintFix(
  filePaths: readonly string[],
  workspacePath: string,
): Promise<void> {
  const tsFiles = filePaths.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx"));
  if (tsFiles.length === 0) return;

  try {
    await execFileAsync(
      "npx",
      ["eslint", "--fix", ...tsFiles, "--no-error-on-unmatched-pattern"],
      { cwd: workspacePath, timeout: LINT_TIMEOUT_MS },
    );
    logger.info({ fileCount: tsFiles.length, workspacePath }, "eslint --fix applied in workspace");
  } catch {
    logger.debug("eslint --fix had issues in workspace (will be caught in lint check)");
  }
}

async function runLint(
  filePaths: readonly string[],
  workspacePath: string,
): Promise<LintResult> {
  const outputs: string[] = [];
  let allSuccess = true;

  const lintableFiles = filePaths.filter(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx"),
  );

  if (lintableFiles.length > 0) {
    try {
      const { stdout, stderr } = await execFileAsync(
        "npx",
        ["eslint", ...lintableFiles, "--no-error-on-unmatched-pattern"],
        { cwd: workspacePath, timeout: LINT_TIMEOUT_MS },
      );
      outputs.push(`[eslint] ${stdout}${stderr}`);
    } catch (error) {
      allSuccess = false;
      const execError = error as { stdout?: string; stderr?: string; message?: string };
      outputs.push(
        `[eslint FAIL] ${execError.stdout ?? ""}${execError.stderr ?? execError.message ?? ""}`,
      );
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["tsc", "--noEmit"],
      { cwd: workspacePath, timeout: LINT_TIMEOUT_MS },
    );
    outputs.push(`[tsc] ${stdout}${stderr}`);
  } catch (error) {
    allSuccess = false;
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    outputs.push(
      `[tsc FAIL] ${execError.stdout ?? ""}${execError.stderr ?? execError.message ?? ""}`,
    );
  }

  return { success: allSuccess, output: outputs.join("\n") };
}
