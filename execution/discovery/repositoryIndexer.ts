import path from "node:path";
import { logger } from "../../config/logger.js";
import type { ProjectStructure, ProjectFile } from "./fileDiscovery.js";
import { ripgrepSearch, isRipgrepAvailable } from "./ripgrepSearch.js";
import type { RipgrepResult } from "./ripgrepSearch.js";
import { readFirstLines } from "./fileReadUtils.js";

const INDEXABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".css", ".scss",
]);

const MAX_INDEX_PROMPT_CHARS = 16_000;
const MANUAL_FALLBACK_MAX_FILES = 200;
const MANUAL_FALLBACK_MAX_LINES = 60;

const BONUS_TYPES: ReadonlySet<string> = new Set(["component", "hook", "config", "style"]);
const BONUS_EXPORT_THRESHOLD = 3;

export type FileType =
  | "component"
  | "hook"
  | "util"
  | "type"
  | "config"
  | "test"
  | "style"
  | "other";

export interface FileSymbolIndex {
  readonly path: string;
  readonly exports: readonly string[];
  readonly type: FileType;
  readonly size: number;
}

export interface RepositoryIndex {
  readonly fileIndex: ReadonlyMap<string, FileSymbolIndex>;
  readonly totalFiles: number;
  readonly indexedFiles: number;
}

const NAMED_EXPORT_REGEX = /^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/;
const REEXPORT_REGEX = /^export\s+\{([^}]+)\}/;

const NAMED_EXPORT_PATTERN = String.raw`^export\s+(default\s+)?(async\s+)?(function|const|let|var|class|interface|type|enum)\s+(\w+)`;
const REEXPORT_PATTERN = String.raw`^export\s+\{([^}]+)\}`;

export async function buildRepositoryIndex(
  workspacePath: string,
  structure: ProjectStructure,
): Promise<RepositoryIndex> {
  const indexableFiles = structure.files.filter(
    (f) => !f.isDirectory && INDEXABLE_EXTENSIONS.has(path.extname(f.relativePath)),
  );

  const available = await isRipgrepAvailable();
  const exportsByFile = available
    ? await extractExportsViaRipgrep(workspacePath)
    : await extractExportsManualFallback(workspacePath, indexableFiles);

  const fileIndex = new Map<string, FileSymbolIndex>();

  for (const file of indexableFiles) {
    const exports = exportsByFile.get(file.relativePath) ?? [];
    const fileType = classifyFileType(file.relativePath, exports);

    if (fileType === "test") continue;

    fileIndex.set(file.relativePath, {
      path: file.relativePath,
      exports,
      type: fileType,
      size: file.size,
    });
  }

  logger.info(
    {
      totalFiles: structure.totalFiles,
      indexableFiles: indexableFiles.length,
      indexedFiles: fileIndex.size,
      strategy: available ? "ripgrep" : "manual",
    },
    "Repository index built",
  );

  return {
    fileIndex,
    totalFiles: structure.totalFiles,
    indexedFiles: fileIndex.size,
  };
}

function collectExportsFromResults(
  results: readonly RipgrepResult[],
  parseFn: (line: string) => readonly string[],
  target: Map<string, string[]>,
): void {
  for (const result of results) {
    const existing = target.get(result.path) ?? [];
    for (const line of result.matchLines) {
      const names = parseFn(line);
      for (const name of names) {
        if (!existing.includes(name)) existing.push(name);
      }
    }
    target.set(result.path, existing);
  }
}

async function extractExportsViaRipgrep(
  workspacePath: string,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const exportsByFile = new Map<string, string[]>();
  const searchOptions = { glob: "*.{ts,tsx,js,jsx}", maxResults: 500, caseSensitive: true };

  const [namedResults, reexportResults] = await Promise.all([
    ripgrepSearch(workspacePath, NAMED_EXPORT_PATTERN, searchOptions),
    ripgrepSearch(workspacePath, REEXPORT_PATTERN, searchOptions),
  ]);

  collectExportsFromResults(namedResults, parseNamedExportLine, exportsByFile);
  collectExportsFromResults(reexportResults, parseReexportLine, exportsByFile);

  return exportsByFile;
}

function extractExportsFromFileContent(content: string): readonly string[] {
  const exports: string[] = [];
  for (const line of content.split("\n")) {
    const namedNames = parseNamedExportLine(line);
    for (const name of namedNames) exports.push(name);

    const reexportNames = parseReexportLine(line);
    for (const name of reexportNames) exports.push(name);
  }
  return exports;
}

const CSS_SELECTOR_REGEX = /^([.:][a-zA-Z_-][\w-]*)\s*\{/;
const CSS_VAR_DEF_REGEX = /^\s*(--[\w-]+)\s*:/;

function extractCssSymbols(content: string): readonly string[] {
  const symbols: string[] = [];
  const seen = new Set<string>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    const selectorMatch = CSS_SELECTOR_REGEX.exec(trimmed);
    if (selectorMatch) {
      const selector = selectorMatch[1];
      if (!seen.has(selector)) {
        symbols.push(selector);
        seen.add(selector);
      }
    }

    const varMatch = CSS_VAR_DEF_REGEX.exec(trimmed);
    if (varMatch) {
      const varName = varMatch[1];
      if (!seen.has(varName)) {
        symbols.push(varName);
        seen.add(varName);
      }
    }
  }

  return symbols;
}

function isCssFile(filePath: string): boolean {
  return filePath.endsWith(".css") || filePath.endsWith(".scss");
}

const MANUAL_FALLBACK_BATCH_SIZE = 20;

async function readAndExtractExports(
  workspacePath: string,
  file: ProjectFile,
): Promise<{ readonly relativePath: string; readonly exports: readonly string[] } | null> {
  const fullPath = path.join(workspacePath, file.relativePath);
  try {
    const content = await readFirstLines(fullPath, MANUAL_FALLBACK_MAX_LINES);
    const exports = isCssFile(file.relativePath)
      ? extractCssSymbols(content)
      : extractExportsFromFileContent(content);
    return exports.length > 0 ? { relativePath: file.relativePath, exports } : null;
  } catch {
    return null;
  }
}

async function extractExportsManualFallback(
  workspacePath: string,
  files: readonly ProjectFile[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const exportsByFile = new Map<string, string[]>();

  const candidates = files
    .filter((f) => f.size > 0 && f.size <= 50_000)
    .slice(0, MANUAL_FALLBACK_MAX_FILES);

  for (let i = 0; i < candidates.length; i += MANUAL_FALLBACK_BATCH_SIZE) {
    const batch = candidates.slice(i, i + MANUAL_FALLBACK_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((file) => readAndExtractExports(workspacePath, file)),
    );

    for (const result of results) {
      if (result.status !== "fulfilled" || result.value === null) continue;
      exportsByFile.set(result.value.relativePath, [...result.value.exports]);
    }
  }

  return exportsByFile;
}

function parseNamedExportLine(line: string): readonly string[] {
  const trimmed = line.trim();
  const result = NAMED_EXPORT_REGEX.exec(trimmed);
  return result ? [result[1]] : [];
}

function parseReexportLine(line: string): readonly string[] {
  const trimmed = line.trim();
  const result = REEXPORT_REGEX.exec(trimmed);
  if (!result) return [];

  return result[1]
    .split(",")
    .map((s) => {
      const parts = s.trim().split(/\s+as\s+/);
      return (parts[1] ?? parts[0]).trim();
    })
    .filter((name) => name.length > 0 && /^\w+$/.test(name));
}

function isHookName(name: string): boolean {
  return name.length > 3 && name.startsWith("use") && /^use[A-Z]/.test(name);
}

export function classifyFileType(
  filePath: string,
  exports: readonly string[],
): FileType {
  const lowerPath = filePath.toLowerCase();
  const originalFileName = path.basename(filePath);
  const originalNameNoExt = originalFileName.replace(/\.[^.]+$/, "");

  if (
    lowerPath.includes(".test.") ||
    lowerPath.includes(".spec.") ||
    lowerPath.includes("__test")
  ) {
    return "test";
  }

  if (lowerPath.endsWith(".d.ts")) return "type";

  if (
    lowerPath.endsWith(".css") ||
    lowerPath.endsWith(".scss") ||
    lowerPath.endsWith(".module.css")
  ) {
    return "style";
  }

  if (
    isHookName(originalNameNoExt) ||
    exports.some((e) => isHookName(e))
  ) {
    return "hook";
  }

  const lowerNameNoExt = originalNameNoExt.toLowerCase();

  if (
    lowerPath.includes("/config") ||
    lowerPath.includes("/env") ||
    lowerNameNoExt === "config" ||
    lowerNameNoExt === "constants"
  ) {
    return "config";
  }

  if (
    lowerPath.includes("/types") ||
    lowerNameNoExt === "types" ||
    lowerNameNoExt === "interfaces"
  ) {
    return "type";
  }

  if (
    lowerPath.includes("/util") ||
    lowerPath.includes("/helper") ||
    lowerPath.includes("/lib/") ||
    lowerNameNoExt === "utils" ||
    lowerNameNoExt === "helpers"
  ) {
    return "util";
  }

  const hasPascalCaseExport = exports.some((e) => /^[A-Z][a-z]/.test(e));
  if (
    lowerPath.endsWith(".tsx") ||
    lowerPath.endsWith(".jsx") ||
    lowerPath.includes("/component") ||
    lowerPath.includes("/page") ||
    lowerPath.includes("/layout") ||
    hasPascalCaseExport
  ) {
    return "component";
  }

  return "other";
}

export function formatIndexForPrompt(
  index: RepositoryIndex,
  maxChars: number = MAX_INDEX_PROMPT_CHARS,
): string {
  const header = `FILE INDEX (${index.totalFiles} files, ${index.indexedFiles} indexed):\n`;
  const lines: string[] = [];
  let totalChars = header.length;

  const typeOrder: Record<FileType, number> = {
    style: 0,
    component: 1,
    hook: 2,
    config: 3,
    type: 4,
    util: 5,
    other: 6,
    test: 7,
  };

  const sorted = [...index.fileIndex.values()].sort((a, b) => {
    const orderDiff = typeOrder[a.type] - typeOrder[b.type];
    if (orderDiff !== 0) return orderDiff;
    return a.path.localeCompare(b.path);
  });

  for (const entry of sorted) {
    const exportsStr =
      entry.exports.length > 0
        ? entry.exports.join(", ")
        : "(no named exports)";
    const line = `${entry.path} [${entry.type}]: ${exportsStr}`;

    if (totalChars + line.length + 1 > maxChars) break;

    lines.push(line);
    totalChars += line.length + 1;
  }

  return header + lines.join("\n");
}

function scoreExportsForKeyword(
  exports: readonly string[],
  keyword: string,
): number {
  let score = 0;
  for (const exportName of exports) {
    const lowerExport = exportName.toLowerCase();
    if (lowerExport === keyword) {
      score += 15;
    } else if (lowerExport.includes(keyword)) {
      score += 10;
    }
  }
  return score;
}

function scorePathForKeyword(
  pathParts: readonly string[],
  lowerPath: string,
  keyword: string,
): number {
  let score = 0;
  for (const part of pathParts) {
    if (part === keyword) {
      score += 7;
    } else if (part.includes(keyword)) {
      score += 4;
    }
  }
  if (lowerPath.includes(keyword)) {
    score += 3;
  }
  return score;
}

const STYLE_BOOST_KEYWORDS: ReadonlySet<string> = new Set([
  "theme", "dark", "light", "color", "palette", "style", "css",
  "token", "override", "vermelho", "red", "brand",
]);

function scoreEntryAgainstKeywords(
  entry: FileSymbolIndex,
  lowerKeywords: readonly string[],
): number {
  const lowerPath = entry.path.toLowerCase();
  const pathParts = lowerPath.split(/[/\\.-]/);

  let score = 0;
  for (const keyword of lowerKeywords) {
    score += scoreExportsForKeyword(entry.exports, keyword);
    score += scorePathForKeyword(pathParts, lowerPath, keyword);
  }

  if (score > 0) {
    if (entry.exports.length >= BONUS_EXPORT_THRESHOLD) score += 2;
    if (BONUS_TYPES.has(entry.type)) score += 2;
  }

  if (entry.type === "style" && score > 0) {
    const hasStyleKeyword = lowerKeywords.some((kw) => STYLE_BOOST_KEYWORDS.has(kw));
    if (hasStyleKeyword) score += 20;
  }

  return score;
}

export function findRelevantFilesFromIndex(
  index: RepositoryIndex,
  keywords: readonly string[],
  maxFiles: number = 10,
): readonly FileSymbolIndex[] {
  if (keywords.length === 0) return [];

  const lowerKeywords = keywords.map((k) => k.toLowerCase());

  const scored: { readonly entry: FileSymbolIndex; readonly score: number }[] = [];

  for (const entry of index.fileIndex.values()) {
    const score = scoreEntryAgainstKeywords(entry, lowerKeywords);
    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxFiles).map((s) => s.entry);
}
