import type fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../config/logger.js";

const MAX_CONTEXT_FILES = 5;
const MAX_TOTAL_CONTEXT_CHARS = 12_000;
const MAX_TREE_DEPTH = 8;
const MAX_FILE_SIZE_BYTES = 50_000;

const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".pnpm",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".cache",
  "coverage",
  ".turbo",
  ".vercel",
]);

const IGNORED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".lock",
  ".map",
  ".min.js",
  ".min.css",
  ".ico",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

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

  return {
    tree: treeLines.join("\n"),
    files,
    totalFiles,
    totalDirs,
  };
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

  const scored: Array<{ readonly file: ProjectFile; readonly score: number }> = [];

  for (const file of structure.files) {
    if (file.size > MAX_FILE_SIZE_BYTES) continue;
    if (file.size === 0) continue;

    const score = calculateFileRelevance(file.relativePath, keywords);
    if (score > 0) {
      scored.push({ file, score });
    }
  }

  expandWithNeighborFiles(scored, structure.files, maxFiles);

  scored.sort((a, b) => b.score - a.score);
  const topFiles = scored.slice(0, maxFiles);

  const results: FileContext[] = [];
  let totalChars = 0;

  for (const { file, score } of topFiles) {
    if (totalChars >= MAX_TOTAL_CONTEXT_CHARS) break;

    const fullPath = path.join(workspacePath, file.relativePath);
    try {
      const content = await fsPromises.readFile(fullPath, "utf-8");
      const trimmed =
        content.length + totalChars > MAX_TOTAL_CONTEXT_CHARS
          ? content.slice(0, MAX_TOTAL_CONTEXT_CHARS - totalChars) + "\n// ... truncated ..."
          : content;

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
      candidateFiles: scored.length,
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
      const trimmed =
        content.length + totalChars > maxChars
          ? content.slice(0, maxChars - totalChars) + "\n// ... truncated ..."
          : content;

      results.push({ path: filePath, content: trimmed, score: 1 });
      totalChars += trimmed.length;
    } catch {
      logger.debug({ path: filePath }, "Failed to read file");
    }
  }

  return results;
}

function normalizeAccents(text: string): string {
  return text.normalize("NFD").replaceAll(/[\u0300-\u036f]/g, "");
}

function extractKeywords(task: string): readonly string[] {
  const stopWords = new Set([
    "a", "o", "de", "do", "da", "em", "no", "na", "para", "por", "com",
    "que", "um", "uma", "os", "as", "dos", "das", "se", "ou", "e", "ao",
    "the", "is", "are", "and", "or", "to", "from", "in", "of", "for", "with",
    "eu", "quero", "ser", "nao", "faz", "sentido", "opcao",
    "implementar", "criar", "remover", "adicionar", "modificar", "alterar",
  ]);

  return normalizeAccents(task)
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w))
    .slice(0, 10);
}

const NEIGHBOR_PATTERNS: readonly string[] = [
  "layout", "shell", "app-shell", "navigation", "nav", "menu", "routes", "config",
];

function expandWithNeighborFiles(
  scored: Array<{ readonly file: ProjectFile; readonly score: number }>,
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
