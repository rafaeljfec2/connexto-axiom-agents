import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";
import { sanitizeWorkspacePath } from "../project/projectSecurity.js";
import type { FileChange, FileEdit } from "../project/projectSecurity.js";

export type { ValidationConfig, ValidationResult } from "./forgeValidation.js";
export { runLintCheck, checkBaselineBuild } from "./forgeValidation.js";

export interface ApplyResult {
  readonly success: boolean;
  readonly error?: string;
  readonly appliedFiles: readonly string[];
  readonly failedFile?: string;
  readonly failedEditIndex?: number;
}

export async function applyEditsToWorkspace(
  files: readonly FileChange[],
  workspacePath: string,
  atomic: boolean = true,
): Promise<ApplyResult> {
  if (atomic) {
    return applyEditsAtomic(files, workspacePath);
  }
  return applyEditsSequential(files, workspacePath);
}

async function applyEditsAtomic(
  files: readonly FileChange[],
  workspacePath: string,
): Promise<ApplyResult> {
  const pendingWrites = new Map<string, string>();
  const appliedFiles: string[] = [];

  for (const file of files) {
    const fullPath = sanitizeWorkspacePath(workspacePath, file.path);

    if (file.action === "create" || !file.edits || file.edits.length === 0) {
      pendingWrites.set(fullPath, file.content);
      appliedFiles.push(file.path);
      continue;
    }

    let content: string;
    try {
      content = await fs.readFile(fullPath, "utf-8");
    } catch {
      return {
        success: false,
        error: `File not found for modify: ${file.path}`,
        appliedFiles: [],
        failedFile: file.path,
        failedEditIndex: 0,
      };
    }

    for (let editIdx = 0; editIdx < file.edits.length; editIdx++) {
      const edit = file.edits[editIdx];
      const result = applyOneEdit(content, edit, file.path);
      if (result === null) {
        return buildSearchNotFoundError(file.path, editIdx, file.edits.length, edit.search, content);
      }
      content = result;
    }

    pendingWrites.set(fullPath, content);
    appliedFiles.push(file.path);
  }

  try {
    for (const [fullPath, content] of pendingWrites) {
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Disk write failed: ${message}`, appliedFiles: [] };
  }

  return { success: true, appliedFiles };
}

async function applyEditsSequential(
  files: readonly FileChange[],
  workspacePath: string,
): Promise<ApplyResult> {
  const appliedFiles: string[] = [];

  try {
    for (const file of files) {
      const fullPath = sanitizeWorkspacePath(workspacePath, file.path);
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });

      if (file.action === "modify" && file.edits && file.edits.length > 0) {
        let content = await fs.readFile(fullPath, "utf-8");

        for (let editIdx = 0; editIdx < file.edits.length; editIdx++) {
          const edit = file.edits[editIdx];
          const result = applyOneEdit(content, edit, file.path);
          if (result === null) {
            return buildSearchNotFoundError(file.path, editIdx, file.edits.length, edit.search, content);
          }
          content = result;
        }

        await fs.writeFile(fullPath, content, "utf-8");
      } else {
        await fs.writeFile(fullPath, file.content, "utf-8");
      }

      appliedFiles.push(file.path);
    }
    return { success: true, appliedFiles };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message, appliedFiles };
  }
}

const MAX_SNIPPET_CHARS = 1500;
const DUPLICATE_MATCH_THRESHOLD = 1;
const MIN_WORD_MATCH_SCORE = 2;

function buildSearchNotFoundError(
  filePath: string,
  editIdx: number,
  totalEdits: number,
  searchPreview: string,
  fileContent: string,
): ApplyResult {
  const snippet = buildFileSnippetForError(fileContent, searchPreview);
  return {
    success: false,
    error: [
      `Search string not found in ${filePath} (edit ${editIdx + 1} of ${totalEdits}): "${searchPreview.slice(0, 100)}..."`,
      snippet,
    ].join("\n"),
    appliedFiles: [],
    failedFile: filePath,
    failedEditIndex: editIdx,
  };
}

function buildFileSnippetForError(fileContent: string, failedSearch: string): string {
  const lines = fileContent.split("\n");
  const searchWords = failedSearch.split("\n")[0].trim().toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  let bestLineIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].trim().toLowerCase();
    if (lineLower.length === 0) continue;

    const matchCount = searchWords.filter((w) => lineLower.includes(w)).length;
    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestLineIdx = i;
    }
  }

  if (bestLineIdx >= 0 && bestScore >= MIN_WORD_MATCH_SCORE) {
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

  const trackedFiles = files.filter((f) => f.action !== "create").map((f) => f.path);
  const createdFiles = files.filter((f) => f.action === "create").map((f) => f.path);

  if (trackedFiles.length > 0) {
    try {
      await execFileAsync("git", ["checkout", "--", ...trackedFiles], { cwd: workspacePath });
      logger.debug({ fileCount: trackedFiles.length }, "Tracked files restored via git checkout");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error: message }, "git checkout restore partially failed, restoring individually");
      await restoreTrackedFilesIndividually(execFileAsync, trackedFiles, workspacePath);
    }
  }

  for (const filePath of createdFiles) {
    const fullPath = path.join(workspacePath, filePath);
    try {
      await fs.unlink(fullPath);
      logger.debug({ path: filePath }, "Created file removed during workspace restore");
    } catch {
      logger.debug({ path: filePath }, "Created file already absent during restore");
    }
  }
}

async function restoreTrackedFilesIndividually(
  execFileAsync: (
    file: string,
    args: readonly string[],
    options: { readonly cwd: string },
  ) => Promise<{ readonly stdout: string; readonly stderr: string }>,
  filePaths: readonly string[],
  workspacePath: string,
): Promise<void> {
  for (const filePath of filePaths) {
    try {
      await execFileAsync("git", ["checkout", "--", filePath], { cwd: workspacePath });
    } catch {
      logger.debug({ path: filePath }, "File not tracked by git, skipping restore");
    }
  }
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
  edit: FileEdit,
  filePath: string,
): string | null {
  if (edit.line !== undefined && edit.endLine !== undefined) {
    const lineResult = applyLineBasedEdit(content, edit.line, edit.endLine, edit.replace);
    if (lineResult !== null) {
      logger.debug({ path: filePath, line: edit.line, endLine: edit.endLine }, "Edit applied via line numbers");
      return lineResult;
    }
  }

  const occurrences = countOccurrences(content, edit.search);
  if (occurrences > DUPLICATE_MATCH_THRESHOLD) {
    logger.warn(
      { path: filePath, occurrences, searchPreview: edit.search.slice(0, 80) },
      "Multiple matches found for search string, attempting disambiguation",
    );
  }

  const exactIndex = content.indexOf(edit.search);
  if (exactIndex !== -1) {
    if (occurrences > DUPLICATE_MATCH_THRESHOLD) {
      const secondIndex = content.indexOf(edit.search, exactIndex + 1);
      if (secondIndex !== -1) {
        logger.debug({ path: filePath, occurrences }, "Applying to first occurrence (multiple found)");
      }
    }
    return content.slice(0, exactIndex) + edit.replace + content.slice(exactIndex + edit.search.length);
  }

  const fuzzyResult = fuzzyLineMatch(content, edit.search);
  if (fuzzyResult) {
    logger.debug({ path: filePath, matchType: fuzzyResult.type }, "Edit matched with fuzzy fallback");
    return content.slice(0, fuzzyResult.start) + edit.replace + content.slice(fuzzyResult.end);
  }

  logger.warn(
    { path: filePath, searchPreview: edit.search.slice(0, 150) },
    "Search string not found (will attempt correction)",
  );
  return null;
}

function applyLineBasedEdit(
  content: string,
  startLine: number,
  endLine: number,
  replace: string,
): string | null {
  const lines = content.split("\n");
  const zeroStart = startLine - 1;
  const zeroEnd = endLine - 1;

  if (zeroStart < 0 || zeroEnd >= lines.length || zeroStart > zeroEnd) {
    logger.debug({ startLine, endLine, totalLines: lines.length }, "Line-based edit out of range");
    return null;
  }

  const before = lines.slice(0, zeroStart);
  const after = lines.slice(zeroEnd + 1);
  const replaced = replace.split("\n");

  return [...before, ...replaced, ...after].join("\n");
}

function countOccurrences(content: string, search: string): number {
  if (search.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = content.indexOf(search, pos);
    if (idx === -1) break;
    count++;
    pos = idx + 1;
  }
  return count;
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
