import crypto from "node:crypto";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { logger } from "../../config/logger.js";
import {
  findRelevantFiles,
  readFileContents,
  expandContextWithImports,
  globSearch,
  extractKeywords,
} from "../discovery/fileDiscovery.js";
import type { FileContext, ProjectStructure } from "../discovery/fileDiscovery.js";
import { findRelevantFilesFromIndex } from "../discovery/repositoryIndexer.js";
import type { RepositoryIndex } from "../discovery/repositoryIndexer.js";
import { getFrameworkDiscoveryRules, getContextualPatternsForTask } from "../discovery/frameworkRules.js";
import { truncateWithBudget } from "../discovery/fileReadUtils.js";
import type { ForgeAgentContext, ForgePlan } from "./forgeTypes.js";
import { loadForgeAgentConfig } from "./forgeTypes.js";

const MIN_REMAINING_CHARS_FOR_EXPANSION = 2000;
const PREVIEW_MAX_FILES = 5;
const PREVIEW_MAX_CHARS = 6000;
const PREVIEW_MIN_AVAILABLE = 200;
const PRE_EXISTING_ERRORS_MAX_CHARS = 1500;

export async function buildPlanningPreview(
  ctx: ForgeAgentContext,
  _structure: ProjectStructure,
  repoIndex: RepositoryIndex | null = null,
): Promise<readonly FileContext[]> {
  const keywords = extractKeywords(ctx.delegation.task);
  const indexRanked = repoIndex
    ? findRelevantFilesFromIndex(repoIndex, keywords, PREVIEW_MAX_FILES)
    : [];

  const indexPaths = new Set(indexRanked.map((f) => f.path));

  const discoveryFiles = await findRelevantFiles(
    ctx.workspacePath,
    ctx.delegation.task,
    PREVIEW_MAX_FILES,
  );

  const merged = mergePreviewSources(indexRanked, discoveryFiles, indexPaths, PREVIEW_MAX_FILES);

  const readResults = await Promise.allSettled(
    merged.map((filePath) =>
      fsPromises.readFile(path.join(ctx.workspacePath, filePath), "utf-8"),
    ),
  );

  let usedChars = 0;
  const limited: FileContext[] = [];
  for (let i = 0; i < readResults.length; i++) {
    if (usedChars + PREVIEW_MIN_AVAILABLE > PREVIEW_MAX_CHARS) break;

    const result = readResults[i];
    if (result.status !== "fulfilled") {
      logger.debug({ path: merged[i] }, "Failed to read preview file");
      continue;
    }

    const trimmed = truncateWithBudget(result.value, usedChars, PREVIEW_MAX_CHARS);
    limited.push({ path: merged[i], content: trimmed, score: 1 });
    usedChars += trimmed.length;
  }

  return limited;
}

function mergePreviewSources(
  indexRanked: readonly { readonly path: string }[],
  discoveryFiles: readonly FileContext[],
  indexPaths: ReadonlySet<string>,
  maxFiles: number,
): readonly string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const entry of indexRanked) {
    if (seen.has(entry.path) || merged.length >= maxFiles) break;
    merged.push(entry.path);
    seen.add(entry.path);
  }

  for (const file of discoveryFiles) {
    if (seen.has(file.path) || merged.length >= maxFiles) break;
    merged.push(file.path);
    seen.add(file.path);
  }

  return merged;
}

export async function loadContextFiles(
  ctx: ForgeAgentContext,
  plan: ForgePlan,
  structure: ProjectStructure,
): Promise<readonly FileContext[]> {
  const { workspacePath, delegation } = ctx;
  const config = loadForgeAgentConfig();

  const requestedFiles = await buildRequestedFileList(ctx, plan);
  const uniqueRequested = [...new Set(requestedFiles)];

  const llmFiles = await readFileContents(workspacePath, uniqueRequested, config.contextMaxChars);
  const allFilePaths = new Set(structure.files.map((f) => f.relativePath));
  const loadedPaths = new Set(llmFiles.map((f) => f.path));
  let totalCharsUsed = llmFiles.reduce((sum, f) => sum + f.content.length, 0);

  const importExpandedFiles = await tryExpandImports(ctx, llmFiles, allFilePaths, config.contextMaxChars - totalCharsUsed);
  totalCharsUsed += importExpandedFiles.reduce((s, f) => s + f.content.length, 0);
  for (const f of importExpandedFiles) loadedPaths.add(f.path);

  const discoveredFiles = await discoverRemainingFiles(
    workspacePath, delegation.task, config.maxContextFiles, loadedPaths, config.contextMaxChars - totalCharsUsed,
  );

  const merged = [...llmFiles, ...importExpandedFiles, ...discoveredFiles];

  logger.info(
    {
      llmRequested: uniqueRequested.length,
      llmLoaded: llmFiles.length,
      importExpanded: importExpandedFiles.length,
      discoveryAdded: discoveredFiles.length,
      totalContext: merged.length,
      totalChars: merged.reduce((s, f) => s + f.content.length, 0),
    },
    "Context files loaded (LLM-guided + imports + discovery)",
  );

  return merged;
}

async function buildRequestedFileList(
  ctx: ForgeAgentContext,
  plan: ForgePlan,
): Promise<readonly string[]> {
  const files = [...plan.filesToRead, ...plan.filesToModify];

  if (!ctx.enableFrameworkRules) return files;

  const keywords = extractKeywords(ctx.delegation.task);
  const rules = getFrameworkDiscoveryRules(ctx.project.framework);
  const contextualPatterns = getContextualPatternsForTask(rules, keywords);

  if (contextualPatterns.length === 0) return files;

  const frameworkFiles = await globSearch(ctx.workspacePath, contextualPatterns);
  for (const fp of frameworkFiles) {
    if (!files.includes(fp)) files.push(fp);
  }

  return files;
}

async function tryExpandImports(
  ctx: ForgeAgentContext,
  llmFiles: readonly FileContext[],
  allFilePaths: ReadonlySet<string>,
  remainingChars: number,
): Promise<readonly FileContext[]> {
  if (!ctx.enableImportExpansion || remainingChars <= MIN_REMAINING_CHARS_FOR_EXPANSION) return [];

  return expandContextWithImports(ctx.workspacePath, llmFiles, allFilePaths, remainingChars);
}

async function discoverRemainingFiles(
  workspacePath: string,
  task: string,
  maxFiles: number,
  loadedPaths: ReadonlySet<string>,
  remainingChars: number,
): Promise<readonly FileContext[]> {
  if (remainingChars <= MIN_REMAINING_CHARS_FOR_EXPANSION) return [];

  const allDiscovered = await findRelevantFiles(workspacePath, task, maxFiles);
  const unloaded = allDiscovered.filter((f) => !loadedPaths.has(f.path));

  let usedChars = 0;
  const filtered: FileContext[] = [];
  for (const file of unloaded) {
    if (usedChars + file.content.length > remainingChars) break;
    filtered.push(file);
    usedChars += file.content.length;
  }

  return filtered;
}

export async function getPreExistingErrors(
  filePaths: readonly string[],
  workspacePath: string,
): Promise<string> {
  const lintableFiles = filePaths.filter(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx"),
  );
  if (lintableFiles.length === 0) return "";

  try {
    const { execFile: execFileFn } = await import("node:child_process");
    const { promisify: promisifyFn } = await import("node:util");
    const execFileAsync = promisifyFn(execFileFn);

    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["tsc", "--noEmit"],
      { cwd: workspacePath, timeout: 30_000 },
    );

    const output = `${stdout}${stderr}`.trim();
    if (output.length === 0) return "";

    const relevantErrors = filterErrorsForFiles(output, lintableFiles);
    if (relevantErrors.length === 0) return "";

    logger.debug(
      { errorCount: relevantErrors.length },
      "Pre-existing TypeScript errors detected",
    );

    return relevantErrors.join("\n").slice(0, PRE_EXISTING_ERRORS_MAX_CHARS);
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    const raw = `${execError.stdout ?? ""}${execError.stderr ?? ""}`.trim();
    if (raw.length === 0) return "";

    const relevantErrors = filterErrorsForFiles(raw, lintableFiles);
    return relevantErrors.join("\n").slice(0, PRE_EXISTING_ERRORS_MAX_CHARS);
  }
}

function filterErrorsForFiles(output: string, filePaths: readonly string[]): readonly string[] {
  const lines = output.split("\n");
  return lines.filter((line) =>
    filePaths.some((fp) => line.includes(fp)),
  );
}

export async function computeFileHashes(
  filePaths: readonly string[],
  workspacePath: string,
): Promise<Map<string, string>> {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const hashes = new Map<string, string>();

  for (const filePath of filePaths) {
    try {
      const content = await readFile(path.join(workspacePath, filePath), "utf-8");
      hashes.set(filePath, crypto.createHash("sha256").update(content).digest("hex"));
    } catch {
      // File does not exist yet (will be created)
    }
  }

  return hashes;
}

export async function checkFileHashDrift(
  filePaths: readonly string[],
  workspacePath: string,
  originalHashes: ReadonlyMap<string, string>,
): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  for (const filePath of filePaths) {
    const originalHash = originalHashes.get(filePath);
    if (!originalHash) continue;

    try {
      const content = await readFile(path.join(workspacePath, filePath), "utf-8");
      const currentHash = crypto.createHash("sha256").update(content).digest("hex");

      if (currentHash !== originalHash) {
        logger.warn(
          { path: filePath },
          "File content changed between planning and execution phases (hash drift detected)",
        );
      }
    } catch {
      // file no longer exists
    }
  }
}
