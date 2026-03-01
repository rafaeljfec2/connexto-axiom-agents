import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";

const OPENCLAW_SANDBOX_BASE = path.resolve(process.cwd(), "sandbox", "forge");
const OPENCLAW_SANDBOX_NESTED = path.join(OPENCLAW_SANDBOX_BASE, "sandbox", "forge");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  ".pnpm-store",
  "coverage",
  ".nyc_output",
  "sandbox",
  ".axiom",
]);

const PROJECT_TREE_FILENAME = "_PROJECT_TREE.txt";

const OPENCLAW_AGENT_FILES = new Set([
  "AGENTS.md",
  "BOOTSTRAP.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
  "MEMORY.md",
  "memory",
  PROJECT_TREE_FILENAME,
]);

const PROJECT_TREE_MAX_DEPTH = 5;
const PROJECT_TREE_MAX_ENTRIES = 500;
const EXCLUDED_ROOT_EXTENSIONS = new Set([".md", ".sh", ".txt", ".log"]);

let resolvedAgentWorkspace = OPENCLAW_SANDBOX_NESTED;
let copiedProjectEntries: string[] = [];
let preExistingSandboxEntries: Set<string> = new Set();

export { PROJECT_TREE_FILENAME };

export function getResolvedAgentWorkspace(): string {
  return resolvedAgentWorkspace;
}

function getSandboxTargets(): readonly string[] {
  return [OPENCLAW_SANDBOX_BASE, OPENCLAW_SANDBOX_NESTED];
}

export async function copyWorkspaceToSandbox(workspacePath: string): Promise<void> {
  const targets = getSandboxTargets();
  copiedProjectEntries = [];

  const entries = await fsPromises.readdir(workspacePath, { withFileTypes: true });
  const filteredEntries = entries.filter(
    (e) => !SKIP_DIRS.has(e.name) && !e.isSymbolicLink() && !OPENCLAW_AGENT_FILES.has(e.name),
  );

  for (const target of targets) {
    await fsPromises.mkdir(target, { recursive: true });
  }

  const existingEntries = await fsPromises.readdir(OPENCLAW_SANDBOX_BASE).catch(() => []);
  const existingNested = await fsPromises.readdir(OPENCLAW_SANDBOX_NESTED).catch(() => []);
  preExistingSandboxEntries = new Set([...existingEntries, ...existingNested]);

  for (const entry of filteredEntries) {
    const srcPath = path.join(workspacePath, entry.name);
    for (const target of targets) {
      const destPath = path.join(target, entry.name);
      if (entry.isDirectory()) {
        await fsPromises.mkdir(destPath, { recursive: true });
        await copyDirectoryRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        await fsPromises.copyFile(srcPath, destPath);
      }
    }
    copiedProjectEntries.push(entry.name);
  }

  for (const target of targets) {
    await generateProjectTreeAt(workspacePath, target);
  }

  resolvedAgentWorkspace = OPENCLAW_SANDBOX_NESTED;

  logger.info(
    { targets, source: workspacePath, copiedEntries: copiedProjectEntries.length },
    "Copied project workspace to BOTH OpenClaw sandbox locations",
  );
}

async function generateProjectTreeAt(workspacePath: string, targetDir: string): Promise<void> {
  const lines: string[] = [
    "# Project Directory Structure",
    "# Read this file FIRST to understand the project layout.",
    "# Use exact file paths from this listing when reading files.",
    "",
  ];

  let entryCount = 0;

  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (depth > PROJECT_TREE_MAX_DEPTH || entryCount >= PROJECT_TREE_MAX_ENTRIES) return;
    const entries = await fsPromises.readdir(dir, { withFileTypes: true }).catch(() => []);
    const filtered = entries
      .filter(
        (e) => !SKIP_DIRS.has(e.name) && !e.isSymbolicLink() && !OPENCLAW_AGENT_FILES.has(e.name),
      )
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of filtered) {
      if (entryCount >= PROJECT_TREE_MAX_ENTRIES) {
        lines.push(`${prefix}... (truncated)`);
        return;
      }
      const isDir = entry.isDirectory();
      const dirIcon = isDir ? "\uD83D\uDCC1 " : "";
      lines.push(`${prefix}${dirIcon}${entry.name}${isDir ? "/" : ""}`);
      entryCount++;
      if (isDir) {
        await walk(path.join(dir, entry.name), `${prefix}  `, depth + 1);
      }
    }
  }

  await walk(workspacePath, "", 0);
  const treePath = path.join(targetDir, PROJECT_TREE_FILENAME);
  await fsPromises.writeFile(treePath, lines.join("\n"), "utf-8");
  logger.debug({ entries: entryCount }, "Generated project tree file for sandbox");
}

async function copyDirectoryRecursive(src: string, dest: string): Promise<void> {
  const entries = await fsPromises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await fsPromises.mkdir(destPath, { recursive: true });
      await copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsPromises.copyFile(srcPath, destPath);
    }
  }
}

async function syncCopiedEntriesFrom(
  target: string,
  workspacePath: string,
  changedFiles: string[],
  alreadySynced: Set<string>,
): Promise<void> {
  for (const entryName of copiedProjectEntries) {
    if (alreadySynced.has(entryName)) continue;
    const sandboxPath = path.join(target, entryName);
    const workspaceEntryPath = path.join(workspacePath, entryName);
    const stat = await fsPromises.lstat(sandboxPath).catch(() => null);
    if (!stat) continue;

    if (stat.isDirectory()) {
      const beforeCount = changedFiles.length;
      await diffAndCopyBack(sandboxPath, workspaceEntryPath, entryName, changedFiles);
      if (changedFiles.length > beforeCount) alreadySynced.add(entryName);
    } else if (stat.isFile()) {
      const changed = await isFileChanged(sandboxPath, workspaceEntryPath);
      if (changed) {
        await fsPromises.copyFile(sandboxPath, workspaceEntryPath);
        changedFiles.push(entryName);
        alreadySynced.add(entryName);
      }
    }
  }
}

export async function syncChangesBack(workspacePath: string): Promise<readonly string[]> {
  const changedFiles: string[] = [];
  const alreadySynced = new Set<string>();

  try {
    for (const target of getSandboxTargets()) {
      await syncCopiedEntriesFrom(target, workspacePath, changedFiles, alreadySynced);
      await syncNewFilesFrom(target, workspacePath, changedFiles, alreadySynced);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to sync changes back from sandbox");
  }

  if (changedFiles.length > 0) {
    logger.info(
      { count: changedFiles.length, files: changedFiles.slice(0, 20) },
      "Synced changed files back from OpenClaw sandbox",
    );
  }

  return changedFiles;
}

function isExcludedRootFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return EXCLUDED_ROOT_EXTENSIONS.has(ext);
}

function isNewSyncableEntry(
  entry: { readonly name: string; isSymbolicLink(): boolean },
  known: ReadonlySet<string>,
  alreadySynced: ReadonlySet<string>,
): boolean {
  if (known.has(entry.name)) return false;
  if (alreadySynced.has(entry.name)) return false;
  if (SKIP_DIRS.has(entry.name)) return false;
  if (entry.isSymbolicLink()) return false;
  if (isExcludedRootFile(entry.name)) return false;
  if (preExistingSandboxEntries.has(entry.name)) return false;
  return true;
}

async function syncNewFilesFrom(
  sandboxTarget: string,
  workspacePath: string,
  changedFiles: string[],
  alreadySynced: Set<string>,
): Promise<void> {
  const sandboxEntries = await fsPromises
    .readdir(sandboxTarget, { withFileTypes: true })
    .catch(() => []);
  const known = new Set([...copiedProjectEntries, ...OPENCLAW_AGENT_FILES]);

  for (const entry of sandboxEntries) {
    if (!isNewSyncableEntry(entry, known, alreadySynced)) continue;
    const sandboxPath = path.join(sandboxTarget, entry.name);
    const workspaceEntryPath = path.join(workspacePath, entry.name);
    if (entry.isDirectory()) {
      await fsPromises.mkdir(workspaceEntryPath, { recursive: true });
      await copyDirectoryRecursive(sandboxPath, workspaceEntryPath);
    } else if (entry.isFile()) {
      await fsPromises.copyFile(sandboxPath, workspaceEntryPath);
    } else {
      continue;
    }
    changedFiles.push(entry.name);
    alreadySynced.add(entry.name);
  }
}

async function diffAndCopyBack(
  sandboxDir: string,
  workspaceDir: string,
  relativePath: string,
  changedFiles: string[],
): Promise<void> {
  const entries = await fsPromises.readdir(sandboxDir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const sandboxPath = path.join(sandboxDir, entry.name);
    const workspacePath = path.join(workspaceDir, entry.name);
    const relPath = `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) {
      await fsPromises.mkdir(workspacePath, { recursive: true });
      await diffAndCopyBack(sandboxPath, workspacePath, relPath, changedFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    const changed = await isFileChanged(sandboxPath, workspacePath);
    if (changed) {
      await fsPromises.mkdir(path.dirname(workspacePath), { recursive: true });
      await fsPromises.copyFile(sandboxPath, workspacePath);
      changedFiles.push(relPath);
    }
  }
}

async function isFileChanged(sandboxFile: string, workspaceFile: string): Promise<boolean> {
  try {
    const [sandboxContent, workspaceContent] = await Promise.all([
      fsPromises.readFile(sandboxFile),
      fsPromises.readFile(workspaceFile).catch(() => null),
    ]);
    if (!workspaceContent) return true;
    return !sandboxContent.equals(workspaceContent);
  } catch {
    return true;
  }
}

export async function cleanupSandboxProjectFiles(): Promise<void> {
  try {
    for (const target of getSandboxTargets()) {
      for (const entryName of copiedProjectEntries) {
        const entryPath = path.join(target, entryName);
        const stat = await fsPromises.lstat(entryPath).catch(() => null);
        if (!stat) continue;
        await fsPromises.rm(entryPath, { recursive: true, force: true });
      }
      const treeFilePath = path.join(target, PROJECT_TREE_FILENAME);
      await fsPromises.rm(treeFilePath, { force: true }).catch(() => {});
    }
    copiedProjectEntries = [];
    preExistingSandboxEntries = new Set();
    logger.debug("Removed project files from OpenClaw sandbox (both locations)");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to clean up sandbox project files");
  }
}
