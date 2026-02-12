import type fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";
import { readFirstLines, truncateWithBudget } from "./fileReadUtils.js";
import { parseImportPaths, resolveImportPath } from "./importResolver.js";
import { extractKeywords } from "./keywordExtraction.js";
import { ripgrepSearch } from "./ripgrepSearch.js";

export type { RipgrepResult } from "./ripgrepSearch.js";
export { ripgrepSearch, findSymbolDefinitions, globSearch } from "./ripgrepSearch.js";
export { expandContextWithImports } from "./importResolver.js";
export { extractKeywords, extractGlobPatterns } from "./keywordExtraction.js";

const MAX_CONTEXT_FILES = 5;
const MAX_TOTAL_CONTEXT_CHARS = 20_000;
const MAX_TREE_DEPTH = 8;
const MAX_FILE_SIZE_BYTES = 50_000;

const GREP_MAX_FILES = 50;
const GREP_MAX_LINES = 200;
const GREP_MAX_FILE_SIZE = 30_000;
const REVERSE_IMPORT_MAX_FILES = 30;
const RIPGREP_MAX_RESULTS = 100;

const GREPPABLE_DIRS: ReadonlySet<string> = new Set([
  "src", "app", "apps", "shared", "components", "lib", "features",
  "packages", "pages", "views", "routes", "modules", "hooks", "utils",
  "layouts", "middleware", "services", "helpers",
]);

const GREPPABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts", ".tsx", ".js", ".jsx",
]);

const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules", ".git", ".pnpm", "dist", "build",
  ".next", ".nuxt", ".cache", "coverage", ".turbo", ".vercel",
]);

const IGNORED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".lock", ".map", ".min.js", ".min.css",
  ".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
]);

const NEIGHBOR_PATTERNS: readonly string[] = [
  "layout", "shell", "app-shell", "navigation", "nav", "menu", "routes", "config",
];

export interface ProjectFile {
  readonly relativePath: string;
  readonly isDirectory: boolean;
  readonly size: number;
}

export interface ProjectStructure {
  readonly tree: string;
  readonly files: readonly ProjectFile[];
  readonly totalFiles: number;
  readonly totalDirs: number;
}

export interface FileContext {
  readonly path: string;
  readonly content: string;
  readonly score: number;
}

interface ScoredFile {
  readonly file: ProjectFile;
  readonly score: number;
}

export async function discoverProjectStructure(
  workspacePath: string,
): Promise<ProjectStructure> {
  const files: ProjectFile[] = [];
  const treeLines: string[] = [];
  let totalFiles = 0;
  let totalDirs = 0;

  async function processEntry(
    entry: fs.Dirent,
    dir: string,
    depth: number,
    prefix: string,
  ): Promise<void> {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(workspacePath, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) return;
      totalDirs++;
      treeLines.push(`${prefix}${entry.name}/`);
      await walk(fullPath, depth + 1, `${prefix}  `);
      return;
    }

    const ext = path.extname(entry.name);
    if (IGNORED_EXTENSIONS.has(ext)) return;
    totalFiles++;

    let size = 0;
    try {
      const stat = await fsPromises.stat(fullPath);
      size = stat.size;
    } catch {
      /* ignore */
    }

    files.push({ relativePath, isDirectory: false, size });
    if (depth <= MAX_TREE_DEPTH) {
      treeLines.push(`${prefix}${entry.name}`);
    }
  }

  async function walk(dir: string, depth: number, prefix: string): Promise<void> {
    if (depth > MAX_TREE_DEPTH) return;

    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const sorted = entries
      .filter((e) => !e.name.startsWith(".") || e.name === ".env.example")
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of sorted) {
      await processEntry(entry, dir, depth, prefix);
    }
  }

  await walk(workspacePath, 0, "");

  return { tree: treeLines.join("\n"), files, totalFiles, totalDirs };
}

export async function findRelevantFiles(
  workspacePath: string,
  task: string,
  maxFiles: number = MAX_CONTEXT_FILES,
): Promise<readonly FileContext[]> {
  const structure = await discoverProjectStructure(workspacePath);
  const keywords = extractKeywords(task);

  if (keywords.length === 0) {
    logger.debug("No keywords extracted from task, returning empty context");
    return [];
  }

  const allFilePaths = new Set(structure.files.map((f) => f.relativePath));
  const allFilesMap = new Map(structure.files.map((f) => [f.relativePath, f]));
  const scoredPaths = new Set<string>();
  const scored: ScoredFile[] = [];

  for (const file of structure.files) {
    if (file.size > MAX_FILE_SIZE_BYTES || file.size === 0) continue;

    const score = calculateFileRelevance(file.relativePath, keywords);
    if (score > 0) {
      scored.push({ file, score });
      scoredPaths.add(file.relativePath);
    }
  }

  const grepResults = await grepFilesForKeywords(workspacePath, structure.files, keywords, scoredPaths);
  mergeScored(scored, grepResults, scoredPaths);

  const importedFiles = await followImports(workspacePath, scored, allFilePaths, scoredPaths, allFilesMap);
  mergeScored(scored, importedFiles, scoredPaths);

  const reverseFiles = await findReverseImports(workspacePath, structure.files, scored, scoredPaths);
  mergeScored(scored, reverseFiles, scoredPaths);

  expandWithNeighborFiles(scored, structure.files, maxFiles);

  scored.sort((a, b) => b.score - a.score);
  const topFiles = scored.slice(0, maxFiles);

  return readAndAssembleContext(workspacePath, topFiles, task, keywords, scored.length);
}

async function readAndAssembleContext(
  workspacePath: string,
  topFiles: readonly ScoredFile[],
  task: string,
  keywords: readonly string[],
  totalCandidates: number,
): Promise<readonly FileContext[]> {
  const results: FileContext[] = [];
  let totalChars = 0;

  for (const { file, score } of topFiles) {
    if (totalChars >= MAX_TOTAL_CONTEXT_CHARS) break;

    const fullPath = path.join(workspacePath, file.relativePath);
    try {
      const content = await fsPromises.readFile(fullPath, "utf-8");
      const trimmed = truncateWithBudget(content, totalChars, MAX_TOTAL_CONTEXT_CHARS);

      results.push({ path: file.relativePath, content: trimmed, score });
      totalChars += trimmed.length;
    } catch {
      logger.debug({ path: file.relativePath }, "Failed to read file for context");
    }
  }

  logger.info(
    {
      task: task.slice(0, 80),
      keywords,
      candidateFiles: totalCandidates,
      selectedFiles: results.length,
      totalContextChars: totalChars,
    },
    "File discovery completed",
  );

  return results;
}

export async function readFileContents(
  workspacePath: string,
  filePaths: readonly string[],
  maxChars: number = MAX_TOTAL_CONTEXT_CHARS,
): Promise<readonly FileContext[]> {
  const results: FileContext[] = [];
  let totalChars = 0;

  for (const filePath of filePaths) {
    if (totalChars >= maxChars) break;

    const fullPath = path.join(workspacePath, filePath);
    try {
      const content = await fsPromises.readFile(fullPath, "utf-8");
      const trimmed = truncateWithBudget(content, totalChars, maxChars);

      results.push({ path: filePath, content: trimmed, score: 1 });
      totalChars += trimmed.length;
    } catch {
      logger.debug({ path: filePath }, "Failed to read file");
    }
  }

  return results;
}

function isGreppableFile(file: ProjectFile): boolean {
  if (file.size > GREP_MAX_FILE_SIZE || file.size === 0) return false;

  const ext = path.extname(file.relativePath);
  if (!GREPPABLE_EXTENSIONS.has(ext)) return false;

  const firstDir = file.relativePath.split(path.sep)[0];
  return GREPPABLE_DIRS.has(firstDir);
}

export async function grepFilesForKeywords(
  workspacePath: string,
  files: readonly ProjectFile[],
  keywords: readonly string[],
  alreadyScored: ReadonlySet<string>,
  useRipgrep: boolean = false,
): Promise<readonly ScoredFile[]> {
  if (useRipgrep && keywords.length > 0) {
    const rgResults = await grepWithRipgrep(workspacePath, files, keywords, alreadyScored);
    if (rgResults.length > 0) return rgResults;
  }

  return grepManualFallback(workspacePath, files, keywords, alreadyScored);
}

async function grepWithRipgrep(
  workspacePath: string,
  files: readonly ProjectFile[],
  keywords: readonly string[],
  alreadyScored: ReadonlySet<string>,
): Promise<readonly ScoredFile[]> {
  const allFilesMap = new Map(files.map((f) => [f.relativePath, f]));
  const pattern = keywords.join("|");
  const rgResults = await ripgrepSearch(workspacePath, pattern, {
    glob: "*.{ts,tsx,js,jsx}",
    maxResults: RIPGREP_MAX_RESULTS,
  });

  const results: ScoredFile[] = [];
  for (const rg of rgResults) {
    if (alreadyScored.has(rg.path)) continue;
    const file = allFilesMap.get(rg.path);
    if (!file) continue;
    results.push({ file, score: rg.matchCount * 4 });
  }

  logger.debug(
    { matchedFiles: results.length, strategy: "ripgrep" },
    "Content grep completed",
  );

  return results;
}

async function grepManualFallback(
  workspacePath: string,
  files: readonly ProjectFile[],
  keywords: readonly string[],
  alreadyScored: ReadonlySet<string>,
): Promise<readonly ScoredFile[]> {
  const results: ScoredFile[] = [];
  let scannedCount = 0;

  const candidates = files.filter(
    (f) => isGreppableFile(f) && !alreadyScored.has(f.relativePath),
  );

  for (const file of candidates) {
    if (scannedCount >= GREP_MAX_FILES) break;
    scannedCount++;

    const fullPath = path.join(workspacePath, file.relativePath);
    try {
      const content = await readFirstLines(fullPath, GREP_MAX_LINES);
      const lowerContent = content.toLowerCase();

      let score = 0;
      for (const keyword of keywords) {
        if (lowerContent.includes(keyword)) {
          score += 4;
        }
      }

      if (score > 0) {
        results.push({ file, score });
      }
    } catch {
      /* skip unreadable files */
    }
  }

  logger.debug(
    { scannedFiles: scannedCount, matchedFiles: results.length, strategy: "manual" },
    "Content grep completed",
  );

  return results;
}

export async function followImports(
  workspacePath: string,
  scoredFiles: readonly ScoredFile[],
  allFilePaths: ReadonlySet<string>,
  alreadyScored: ReadonlySet<string>,
  allFilesMap: ReadonlyMap<string, ProjectFile>,
): Promise<readonly ScoredFile[]> {
  const results: ScoredFile[] = [];
  const seen = new Set(alreadyScored);

  for (const { file } of scoredFiles) {
    const fullPath = path.join(workspacePath, file.relativePath);
    try {
      const content = await fsPromises.readFile(fullPath, "utf-8");
      const importPaths = parseImportPaths(content);

      for (const importSpec of importPaths) {
        const resolved = resolveImportPath(file.relativePath, importSpec, allFilePaths);
        if (!resolved || seen.has(resolved)) continue;

        const importedFile = allFilesMap.get(resolved);
        if (!importedFile || importedFile.size > MAX_FILE_SIZE_BYTES) continue;

        results.push({ file: importedFile, score: 2 });
        seen.add(resolved);
      }
    } catch {
      /* skip unreadable files */
    }
  }

  logger.debug({ importedFiles: results.length }, "Import following completed");
  return results;
}

export async function findReverseImports(
  workspacePath: string,
  allFiles: readonly ProjectFile[],
  targetFiles: readonly ScoredFile[],
  alreadyScored: ReadonlySet<string>,
): Promise<readonly ScoredFile[]> {
  if (targetFiles.length === 0) return [];

  const targetPatterns = buildImportPatterns(targetFiles);
  const results: ScoredFile[] = [];
  const seen = new Set(alreadyScored);
  let scannedCount = 0;

  const candidates = allFiles.filter(
    (f) => isGreppableFile(f) && !seen.has(f.relativePath),
  );

  for (const file of candidates) {
    if (scannedCount >= REVERSE_IMPORT_MAX_FILES) break;
    scannedCount++;

    const fullPath = path.join(workspacePath, file.relativePath);
    try {
      const content = await readFirstLines(fullPath, GREP_MAX_LINES);
      const hasImport = targetPatterns.some((pattern) => content.includes(pattern));

      if (hasImport) {
        results.push({ file, score: 3 });
        seen.add(file.relativePath);
      }
    } catch {
      /* skip */
    }
  }

  logger.debug(
    { scannedFiles: scannedCount, reverseImportFiles: results.length },
    "Reverse import tracking completed",
  );

  return results;
}

function buildImportPatterns(targetFiles: readonly ScoredFile[]): readonly string[] {
  const patterns: string[] = [];

  for (const { file } of targetFiles) {
    const basename = path.basename(file.relativePath);
    const nameWithoutExt = basename.replace(/\.[^.]+$/, "");
    const parentDir = path.basename(path.dirname(file.relativePath));

    patterns.push(`/${nameWithoutExt}'`, `/${nameWithoutExt}"`);

    if (nameWithoutExt === "index") {
      patterns.push(`/${parentDir}'`, `/${parentDir}"`);
    } else {
      patterns.push(`/${parentDir}/${nameWithoutExt}'`, `/${parentDir}/${nameWithoutExt}"`);
    }
  }

  return patterns;
}

function expandWithNeighborFiles(
  scored: ScoredFile[],
  allFiles: readonly ProjectFile[],
  maxFiles: number,
): void {
  if (scored.length === 0) return;

  const scoredPaths = new Set(scored.map((s) => s.file.relativePath));
  const parentDirs = new Set<string>();

  for (const s of scored) {
    const dir = path.dirname(s.file.relativePath);
    parentDirs.add(dir);
    const grandparent = path.dirname(dir);
    if (grandparent !== ".") parentDirs.add(grandparent);
  }

  for (const file of allFiles) {
    if (scoredPaths.has(file.relativePath)) continue;
    if (file.size > MAX_FILE_SIZE_BYTES || file.size === 0) continue;

    const fileDir = path.dirname(file.relativePath);
    const fileName = path.basename(file.relativePath).toLowerCase();
    const isSiblingDir = [...parentDirs].some((pd) => fileDir.startsWith(pd));
    const isRelevantName = NEIGHBOR_PATTERNS.some((p) => fileName.includes(p));

    if (isSiblingDir && isRelevantName) {
      scored.push({ file, score: 2 });
      scoredPaths.add(file.relativePath);
    }

    if (scored.length >= maxFiles * 2) break;
  }
}

function mergeScored(
  target: ScoredFile[],
  source: readonly ScoredFile[],
  existingPaths: Set<string>,
): void {
  for (const item of source) {
    if (existingPaths.has(item.file.relativePath)) continue;
    target.push(item);
    existingPaths.add(item.file.relativePath);
  }
}

function calculateFileRelevance(filePath: string, keywords: readonly string[]): number {
  const lowerPath = filePath.toLowerCase();
  const pathParts = lowerPath.split(/[/\\.-]/);
  let score = 0;

  for (const keyword of keywords) {
    if (lowerPath.includes(keyword)) {
      score += 3;
    }

    for (const part of pathParts) {
      if (part === keyword) {
        score += 5;
      } else if (part.includes(keyword)) {
        score += 2;
      }
    }
  }

  if (score > 0) {
    const ext = path.extname(filePath);
    if ([".tsx", ".ts", ".jsx"].includes(ext)) {
      score += 1;
    }

    if (lowerPath.includes("component") || lowerPath.includes("page") || lowerPath.includes("layout")) {
      score += 1;
    }
  }

  return score;
}
