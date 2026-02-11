import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../config/logger.js";
import { sanitizeWorkspacePath } from "./projectSecurity.js";
import type { FileChange } from "./projectSecurity.js";

export type { ValidationConfig } from "./forgeValidation.js";
export { runLintCheck } from "./forgeValidation.js";

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

const MAX_SNIPPET_CHARS = 1500;

function buildFileSnippetForError(fileContent: string, failedSearch: string): string {
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
