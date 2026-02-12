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
  switchToMain,
  stageFiles,
  commitChanges,
  getBranchDiff,
  getBranchCommits,
  deleteBranch,
  pushBranchToSource,
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

export async function commitVerifiedChanges(
  db: BetterSqlite3.Database,
  changeId: string,
  description: string,
  filePaths: readonly string[],
  workspacePath: string,
  lintOutput: string,
  repoSource?: string,
): Promise<ProjectApplyResult> {
  const branchName = buildBranchName(changeId);

  try {
    await createBranch(branchName, workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ changeId, branchName, error: message }, "Failed to create branch for verified changes");
    return { success: false, diff: "", lintOutput: "", error: `Git branch creation failed: ${message}` };
  }

  try {
    await stageFiles(filePaths, workspacePath);
    const commitMessage = `forge: ${description.slice(0, 120)}`;
    const hash = await commitChanges(commitMessage, workspacePath);

    const diff = await getBranchDiff(branchName, workspacePath);
    const commits = await getBranchCommits(branchName, workspacePath);
    const commitsJson = JSON.stringify(commits);

    if (repoSource) {
      await pushBranchToSource(branchName, repoSource, workspacePath);
    }

    await switchToMain(workspacePath);

    updateCodeChangeStatus(db, changeId, {
      status: "applied",
      diff,
      testOutput: lintOutput,
      appliedAt: new Date().toISOString(),
      branchName,
      commits: commitsJson,
    });

    logger.info(
      { changeId, branchName, commitHash: hash, pushedToSource: !!repoSource },
      "Verified project code change committed",
    );

    return { success: true, diff, lintOutput };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ changeId, branchName, error: message }, "Commit of verified changes failed");

    try {
      await switchToMain(workspacePath);
      await deleteBranch(branchName, workspacePath);
    } catch (cleanupError) {
      const cleanupMsg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      logger.error({ branchName, error: cleanupMsg }, "Failed to cleanup branch after commit error");
    }

    return { success: false, diff: "", lintOutput: "", error: message };
  }
}

export async function applyProjectCodeChange(
  db: BetterSqlite3.Database,
  changeId: string,
  files: readonly FileChange[],
  workspacePath: string,
  repoSource?: string,
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
    const lintResult = await lintAndAutoFix(filePaths, workspacePath);

    if (lintResult.success) {
      return await commitAndFinalize(db, changeId, change.description, filePaths, {
        branchName,
        workspacePath,
        lintResult,
        repoSource,
      });
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

    return { success: false, diff: "", lintOutput: message, error: message };
  }
}

async function lintAndAutoFix(
  filePaths: readonly string[],
  workspacePath: string,
): Promise<LintResult> {
  await runEslintFix(filePaths, workspacePath);

  const preLintResult = await runLint(filePaths, workspacePath);

  if (!preLintResult.success) {
    const unusedImportsFixed = await fixUnusedImports(filePaths, workspacePath, preLintResult.output);
    if (unusedImportsFixed) {
      await runEslintFix(filePaths, workspacePath);
      return runLint(filePaths, workspacePath);
    }
  }

  return preLintResult;
}

interface CommitContext {
  readonly branchName: string;
  readonly workspacePath: string;
  readonly lintResult: LintResult;
  readonly repoSource?: string;
}

async function commitAndFinalize(
  db: BetterSqlite3.Database,
  changeId: string,
  description: string,
  filePaths: readonly string[],
  ctx: CommitContext,
): Promise<ProjectApplyResult> {
  const { branchName, workspacePath, lintResult, repoSource } = ctx;

  await stageFiles(filePaths, workspacePath);
  const commitMessage = `forge: ${description.slice(0, 120)}`;
  const hash = await commitChanges(commitMessage, workspacePath);

  const diff = await getBranchDiff(branchName, workspacePath);
  const commits = await getBranchCommits(branchName, workspacePath);
  const commitsJson = JSON.stringify(commits);

  if (repoSource) {
    await pushBranchToSource(branchName, repoSource, workspacePath);
  }

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
    { changeId, branchName, commitHash: hash, workspacePath, pushedToSource: !!repoSource },
    "Project code change applied with branch",
  );

  return { success: true, diff, lintOutput: lintResult.output };
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
    const result = applyOneEdit(content, edit, relativePath);
    content = result;
  }

  await fs.writeFile(fullPath, content, "utf-8");
}

function applyOneEdit(content: string, edit: FileEdit, relativePath: string): string {
  const exactIndex = content.indexOf(edit.search);
  if (exactIndex !== -1) {
    return content.slice(0, exactIndex) + edit.replace + content.slice(exactIndex + edit.search.length);
  }

  const fuzzyResult = fuzzyLineMatch(content, edit.search);
  if (fuzzyResult) {
    logger.debug({ path: relativePath, matchType: fuzzyResult.type }, "Search matched with fuzzy fallback");
    return content.slice(0, fuzzyResult.start) + edit.replace + content.slice(fuzzyResult.end);
  }

  logger.error(
    {
      path: relativePath,
      searchPreview: edit.search.slice(0, 150),
      searchLength: edit.search.length,
    },
    "Search string not found in file for edit",
  );
  throw new Error(`Search/replace failed: search string not found in ${relativePath}`);
}

interface FuzzyMatchResult {
  readonly start: number;
  readonly end: number;
  readonly type: string;
}

function fuzzyLineMatch(content: string, search: string): FuzzyMatchResult | null {
  const contentLines = content.split("\n");
  const searchLines = search.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  if (searchLines.length === 0) return null;

  const multiLineResult = findMultiLineTrimMatch(contentLines, searchLines);
  if (multiLineResult) return multiLineResult;

  if (searchLines.length === 1) {
    return findSingleLineMatch(contentLines, searchLines[0]);
  }

  return null;
}

function findMultiLineTrimMatch(
  contentLines: readonly string[],
  searchLines: readonly string[],
): FuzzyMatchResult | null {
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    if (matchesAtPosition(contentLines, searchLines, i)) {
      const start = sumLineLengths(contentLines, 0, i);
      const end = sumLineLengths(contentLines, 0, i + searchLines.length);
      return { start, end: end > 0 ? end - 1 : 0, type: "trimmed-lines" };
    }
  }
  return null;
}

function findSingleLineMatch(
  contentLines: readonly string[],
  singleSearch: string,
): FuzzyMatchResult | null {
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() === singleSearch) {
      const start = sumLineLengths(contentLines, 0, i);
      return { start, end: start + contentLines[i].length, type: "single-line-trim" };
    }
  }

  for (let i = 0; i < contentLines.length; i++) {
    const trimmedLine = contentLines[i].trim();
    if (trimmedLine.includes(singleSearch)) {
      const lineStart = sumLineLengths(contentLines, 0, i);
      const withinLine = contentLines[i].indexOf(singleSearch);
      if (withinLine !== -1) {
        return {
          start: lineStart + withinLine,
          end: lineStart + withinLine + singleSearch.length,
          type: "substring-match",
        };
      }
    }
  }

  return null;
}

function matchesAtPosition(
  contentLines: readonly string[],
  searchLines: readonly string[],
  startIndex: number,
): boolean {
  for (let j = 0; j < searchLines.length; j++) {
    if (contentLines[startIndex + j].trim() !== searchLines[j]) {
      return false;
    }
  }
  return true;
}

function sumLineLengths(lines: readonly string[], from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) {
    sum += lines[i].length + 1;
  }
  return sum;
}

async function fixUnusedImports(
  filePaths: readonly string[],
  workspacePath: string,
  lintOutput: string,
): Promise<boolean> {
  const unusedByFile = parseUnusedImportsFromLint(lintOutput);
  if (unusedByFile.size === 0) return false;

  let anyFixed = false;

  for (const filePath of filePaths) {
    const fixed = await fixUnusedImportsInFile(filePath, workspacePath, unusedByFile);
    if (fixed) anyFixed = true;
  }

  return anyFixed;
}

function parseUnusedImportsFromLint(lintOutput: string): Map<string, string[]> {
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

async function fixUnusedImportsInFile(
  filePath: string,
  workspacePath: string,
  unusedByFile: ReadonlyMap<string, readonly string[]>,
): Promise<boolean> {
  const fullPath = sanitizeWorkspacePath(workspacePath, filePath);
  const matchingKey = [...unusedByFile.keys()].find((k) => k.endsWith(filePath));
  if (!matchingKey) return false;

  const unusedNames = unusedByFile.get(matchingKey);
  if (!unusedNames || unusedNames.length === 0) return false;

  const content = await fs.readFile(fullPath, "utf-8");
  const fixed = removeUnusedImportNames(content, unusedNames);

  if (fixed === content) return false;

  await fs.writeFile(fullPath, fixed, "utf-8");
  logger.info({ path: filePath, removedImports: unusedNames }, "Auto-removed unused imports");
  return true;
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
