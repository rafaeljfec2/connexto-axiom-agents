import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../config/logger.js";
import type { FileContext } from "./fileDiscovery.js";
import { truncateContent } from "./fileReadUtils.js";

const IMPORT_MAX_PER_FILE = 10;
const MAX_FILE_SIZE_BYTES = 50_000;

const IMPORT_REGEX = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
const REQUIRE_REGEX = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function parseImportPaths(content: string): readonly string[] {
  const imports: string[] = [];

  for (const match of content.matchAll(IMPORT_REGEX)) {
    imports.push(match[1]);
    if (imports.length >= IMPORT_MAX_PER_FILE) break;
  }

  if (imports.length < IMPORT_MAX_PER_FILE) {
    for (const match of content.matchAll(REQUIRE_REGEX)) {
      imports.push(match[1]);
      if (imports.length >= IMPORT_MAX_PER_FILE) break;
    }
  }

  return imports.filter((p) => p.startsWith("."));
}

export function resolveImportPath(
  importerRelativePath: string,
  importSpecifier: string,
  allFilePaths: ReadonlySet<string>,
): string | null {
  const importerDir = path.dirname(importerRelativePath);
  const rawResolved = path.join(importerDir, importSpecifier);
  const normalized = path.normalize(rawResolved);

  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    path.join(normalized, "index.ts"),
    path.join(normalized, "index.tsx"),
    path.join(normalized, "index.js"),
  ];

  for (const candidate of candidates) {
    if (allFilePaths.has(candidate)) return candidate;
  }

  return null;
}

export async function expandContextWithImports(
  workspacePath: string,
  loadedFiles: readonly FileContext[],
  allFilePaths: ReadonlySet<string>,
  remainingChars: number,
): Promise<readonly FileContext[]> {
  const loadedSet = new Set(loadedFiles.map((f) => f.path));
  const expanded: FileContext[] = [];
  let usedChars = 0;

  for (const loaded of loadedFiles) {
    if (usedChars >= remainingChars) break;

    const importPaths = parseImportPaths(loaded.content);
    const result = await resolveAndLoadImports(
      workspacePath, loaded.path, importPaths, allFilePaths, loadedSet, remainingChars - usedChars,
    );

    expanded.push(...result.files);
    usedChars += result.charsUsed;
  }

  logger.debug(
    { expandedFiles: expanded.length, expandedChars: usedChars },
    "Import expansion completed",
  );

  return expanded;
}

async function resolveAndLoadImports(
  workspacePath: string,
  importerPath: string,
  importSpecs: readonly string[],
  allFilePaths: ReadonlySet<string>,
  loadedSet: Set<string>,
  budget: number,
): Promise<{ readonly files: readonly FileContext[]; readonly charsUsed: number }> {
  const files: FileContext[] = [];
  let charsUsed = 0;

  for (const importSpec of importSpecs) {
    if (charsUsed >= budget) break;

    const resolved = resolveImportPath(importerPath, importSpec, allFilePaths);
    if (!resolved || loadedSet.has(resolved)) continue;

    const loaded = await tryReadImportedFile(workspacePath, resolved, budget - charsUsed);
    if (!loaded) continue;

    files.push(loaded);
    loadedSet.add(resolved);
    charsUsed += loaded.content.length;
  }

  return { files, charsUsed };
}

async function tryReadImportedFile(
  workspacePath: string,
  resolvedPath: string,
  available: number,
): Promise<FileContext | null> {
  try {
    const fullPath = path.join(workspacePath, resolvedPath);
    const content = await fsPromises.readFile(fullPath, "utf-8");
    if (content.length > MAX_FILE_SIZE_BYTES) return null;

    const trimmed = truncateContent(content, available);
    return { path: resolvedPath, content: trimmed, score: 2 };
  } catch {
    return null;
  }
}
