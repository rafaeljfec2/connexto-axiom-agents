import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../config/logger.js";
import { sanitizeWorkspacePath } from "./projectSecurity.js";
import type { FileChange } from "./projectSecurity.js";

export interface ApplyResult {
  readonly success: boolean;
  readonly error?: string;
}

export async function applyEditsToWorkspace(
  files: readonly FileChange[],
  workspacePath: string,
): Promise<ApplyResult> {
  try {
    for (const file of files) {
      const fullPath = sanitizeWorkspacePath(workspacePath, file.path);
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });

      if (file.action === "modify" && file.edits && file.edits.length > 0) {
        let content = await fs.readFile(fullPath, "utf-8");

        for (const edit of file.edits) {
          const result = applyOneEdit(content, edit.search, edit.replace, file.path);
          if (result === null) {
            const snippet = buildFileSnippetForError(content, edit.search);
            return {
              success: false,
              error: [
                `Search string not found in ${file.path}: "${edit.search.slice(0, 100)}..."`,
                snippet,
              ].join("\n"),
            };
          }
          content = result;
        }

        await fs.writeFile(fullPath, content, "utf-8");
      } else {
        await fs.writeFile(fullPath, file.content, "utf-8");
      }
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

function buildFileSnippetForError(fileContent: string, failedSearch: string): string {
  const MAX_SNIPPET_CHARS = 1500;
  const lines = fileContent.split("\n");

  const searchFirstLine = failedSearch.split("\n")[0].trim().toLowerCase();
  let bestLineIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].trim().toLowerCase();
    if (lineLower.length === 0) continue;

    const words = searchFirstLine.split(/\s+/).filter((w) => w.length > 2);
    const matchCount = words.filter((w) => lineLower.includes(w)).length;

    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestLineIdx = i;
    }
  }

  if (bestLineIdx >= 0 && bestScore >= 2) {
    const start = Math.max(0, bestLineIdx - 5);
    const end = Math.min(lines.length, bestLineIdx + 15);
    const snippet = lines
      .slice(start, end)
      .map((l, idx) => `${start + idx + 1}| ${l}`)
      .join("\n");
    return `TRECHO RELEVANTE DO ARQUIVO (linhas ${start + 1}-${end}):\n${snippet.slice(0, MAX_SNIPPET_CHARS)}`;
  }

  const snippet = lines
    .slice(0, 40)
    .map((l, idx) => `${idx + 1}| ${l}`)
    .join("\n");
  return `INICIO DO ARQUIVO (primeiras 40 linhas):\n${snippet.slice(0, MAX_SNIPPET_CHARS)}`;
}

export async function restoreWorkspaceFiles(
  files: readonly FileChange[],
  workspacePath: string,
): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    const filePaths = files.map((f) => f.path);
    await execFileAsync("git", ["checkout", "--", ...filePaths], { cwd: workspacePath });
    logger.debug({ fileCount: filePaths.length }, "Workspace files restored via git checkout");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error: message }, "git checkout restore failed, attempting manual restore");
  }
}

export async function runLintCheck(
  filePaths: readonly string[],
  workspacePath: string,
): Promise<{ readonly success: boolean; readonly output: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const LINT_TIMEOUT_MS = 60_000;
  const lintableFiles = filePaths.filter(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx"),
  );

  if (lintableFiles.length > 0) {
    await runEslintFix(execFileAsync, lintableFiles, workspacePath, LINT_TIMEOUT_MS);

    const firstLint = await runEslintCheck(execFileAsync, lintableFiles, workspacePath, LINT_TIMEOUT_MS);

    if (!firstLint.success) {
      const fixed = await fixUnusedImportsFromLint(filePaths, workspacePath, firstLint.output);
      if (fixed) {
        await runEslintFix(execFileAsync, lintableFiles, workspacePath, LINT_TIMEOUT_MS);
      }
    }
  }

  const outputs: string[] = [];
  let allSuccess = true;

  if (lintableFiles.length > 0) {
    const eslintResult = await runEslintCheck(execFileAsync, lintableFiles, workspacePath, LINT_TIMEOUT_MS);
    outputs.push(eslintResult.output);
    if (!eslintResult.success) allSuccess = false;
  }

  const tscResult = await runTscCheck(execFileAsync, workspacePath, LINT_TIMEOUT_MS);
  outputs.push(tscResult.output);
  if (!tscResult.success) allSuccess = false;

  return { success: allSuccess, output: outputs.join("\n") };
}

type ExecFileAsync = (
  file: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeout: number },
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

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

function stripNpmWarnings(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("npm warn") && !line.startsWith("npm WARN"))
    .join("\n")
    .trim();
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
      ["tsc", "--noEmit"],
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

export async function readModifiedFilesState(
  filePaths: readonly string[],
  workspacePath: string,
): Promise<readonly { readonly path: string; readonly content: string }[]> {
  const results: { readonly path: string; readonly content: string }[] = [];

  for (const filePath of filePaths) {
    const fullPath = path.join(workspacePath, filePath);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      results.push({ path: filePath, content });
    } catch {
      logger.debug({ path: filePath }, "Could not read modified file state");
    }
  }

  return results;
}

function applyOneEdit(
  content: string,
  search: string,
  replace: string,
  filePath: string,
): string | null {
  const exactIndex = content.indexOf(search);
  if (exactIndex !== -1) {
    return content.slice(0, exactIndex) + replace + content.slice(exactIndex + search.length);
  }

  const fuzzyResult = fuzzyLineMatch(content, search);
  if (fuzzyResult) {
    logger.debug({ path: filePath, matchType: fuzzyResult.type }, "Edit matched with fuzzy fallback");
    return content.slice(0, fuzzyResult.start) + replace + content.slice(fuzzyResult.end);
  }

  logger.warn(
    { path: filePath, searchPreview: search.slice(0, 150) },
    "Search string not found (will attempt correction)",
  );
  return null;
}

interface FuzzyMatchResult {
  readonly start: number;
  readonly end: number;
  readonly type: string;
}

function computeLineOffset(lines: readonly string[], upToIndex: number): number {
  let offset = 0;
  for (let k = 0; k < upToIndex; k++) offset += lines[k].length + 1;
  return offset;
}

function matchTrimmedLines(
  contentLines: readonly string[],
  searchLines: readonly string[],
): FuzzyMatchResult | null {
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const allMatch = searchLines.every(
      (sl, j) => contentLines[i + j].trim() === sl,
    );
    if (!allMatch) continue;

    const start = computeLineOffset(contentLines, i);
    let end = start;
    for (let k = 0; k < searchLines.length; k++) end += contentLines[i + k].length + 1;
    return { start, end: end > 0 ? end - 1 : 0, type: "trimmed-lines" };
  }
  return null;
}

function matchSingleLineTrim(
  contentLines: readonly string[],
  searchTrimmed: string,
): FuzzyMatchResult | null {
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== searchTrimmed) continue;
    const start = computeLineOffset(contentLines, i);
    return { start, end: start + contentLines[i].length, type: "single-line-trim" };
  }
  return null;
}

function matchSubstring(
  contentLines: readonly string[],
  searchTrimmed: string,
): FuzzyMatchResult | null {
  for (let i = 0; i < contentLines.length; i++) {
    const col = contentLines[i].indexOf(searchTrimmed);
    if (col === -1) continue;
    const lineStart = computeLineOffset(contentLines, i);
    return {
      start: lineStart + col,
      end: lineStart + col + searchTrimmed.length,
      type: "substring-match",
    };
  }
  return null;
}

function fuzzyLineMatch(content: string, search: string): FuzzyMatchResult | null {
  const contentLines = content.split("\n");
  const searchLines = search.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  if (searchLines.length === 0) return null;

  if (searchLines.length > 1) {
    return matchTrimmedLines(contentLines, searchLines);
  }

  return matchSingleLineTrim(contentLines, searchLines[0])
    ?? matchSubstring(contentLines, searchLines[0]);
}
