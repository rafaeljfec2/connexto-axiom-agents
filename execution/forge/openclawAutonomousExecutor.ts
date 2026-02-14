import type BetterSqlite3 from "better-sqlite3";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";
import type { KairosDelegation } from "../../orchestration/types.js";
import type { Project } from "../../state/projects.js";
import { getResearchByGoalId } from "../../state/nexusResearch.js";
import { getGoalById } from "../../state/goals.js";
import { discoverProjectStructure } from "../discovery/fileDiscovery.js";
import { buildRepositoryIndex, formatIndexForPrompt } from "../discovery/repositoryIndexer.js";
import { checkBaselineBuild } from "./forgeValidation.js";
import { callOpenClawWithTools } from "../shared/openclawResponsesClient.js";
import type { ResponseItem, OpenClawToolResponse, ToolCall } from "../shared/openclawResponsesClient.js";
import { getAllToolDefinitions } from "./openclawTools.js";
import { createDefaultConfig, executeTool } from "./openclawToolExecutor.js";
import type { ToolExecutorConfig } from "./openclawToolExecutor.js";
import { buildOpenClawInstructions } from "./openclawInstructions.js";
import type { NexusResearchContext, GoalContext, ForgeCodeOutput } from "./forgeTypes.js";

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_MAX_TASK_TIMEOUT_MS = 300_000;
const DEFAULT_PER_TASK_TOKEN_LIMIT = 50_000;
const REPO_INDEX_MAX_CHARS = 3000;

const OPENCLAW_SANDBOX_BASE = path.resolve(process.cwd(), "sandbox", "forge");
const OPENCLAW_SANDBOX_NESTED = path.join(OPENCLAW_SANDBOX_BASE, "sandbox", "forge");

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo",
  ".cache", ".pnpm-store", "coverage", ".nyc_output", "sandbox",
]);

const PROJECT_TREE_FILENAME = "_PROJECT_TREE.txt";

const OPENCLAW_AGENT_FILES = new Set([
  "AGENTS.md", "BOOTSTRAP.md", "HEARTBEAT.md", "IDENTITY.md",
  "SOUL.md", "TOOLS.md", "USER.md", "MEMORY.md", "memory",
  PROJECT_TREE_FILENAME,
]);

let resolvedAgentWorkspace = OPENCLAW_SANDBOX_NESTED;
let copiedProjectEntries: string[] = [];
let preExistingSandboxEntries: Set<string> = new Set();

function getSandboxTargets(): readonly string[] {
  return [OPENCLAW_SANDBOX_BASE, OPENCLAW_SANDBOX_NESTED];
}

async function copyWorkspaceToSandbox(workspacePath: string): Promise<void> {
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
    {
      targets,
      source: workspacePath,
      copiedEntries: copiedProjectEntries.length,
    },
    "Copied project workspace to BOTH OpenClaw sandbox locations",
  );
}

const PROJECT_TREE_MAX_DEPTH = 5;
const PROJECT_TREE_MAX_ENTRIES = 500;

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
      .filter((e) => !SKIP_DIRS.has(e.name) && !e.isSymbolicLink() && !OPENCLAW_AGENT_FILES.has(e.name))
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
      lines.push(`${prefix}${isDir ? "📁 " : ""}${entry.name}${isDir ? "/" : ""}`);
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

async function syncChangesBack(workspacePath: string): Promise<readonly string[]> {
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

const EXCLUDED_ROOT_EXTENSIONS = new Set([".md", ".sh", ".txt", ".log"]);

function isExcludedRootFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return EXCLUDED_ROOT_EXTENSIONS.has(ext);
}

function isNewSyncableEntry(entry: { readonly name: string; isSymbolicLink(): boolean }, known: ReadonlySet<string>, alreadySynced: ReadonlySet<string>): boolean {
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
  const sandboxEntries = await fsPromises.readdir(sandboxTarget, { withFileTypes: true }).catch(() => []);
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

async function cleanupSandboxProjectFiles(): Promise<void> {
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

export interface OpenClawExecutorConfig {
  readonly maxOutputTokens: number;
  readonly maxIterations: number;
  readonly taskTimeoutMs: number;
  readonly perTaskTokenLimit: number;
}

export interface OpenClawExecutionResult {
  readonly success: boolean;
  readonly description: string;
  readonly filesChanged: readonly string[];
  readonly totalTokensUsed: number;
  readonly iterationsUsed: number;
  readonly error?: string;
}

function loadExecutorConfig(): OpenClawExecutorConfig {
  return {
    maxOutputTokens: Number(process.env.OPENCLAW_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS),
    maxIterations: Number(process.env.OPENCLAW_MAX_ITERATIONS ?? DEFAULT_MAX_ITERATIONS),
    taskTimeoutMs: Number(process.env.OPENCLAW_TASK_TIMEOUT_MS ?? DEFAULT_MAX_TASK_TIMEOUT_MS),
    perTaskTokenLimit: Number(process.env.OPENCLAW_PER_TASK_TOKEN_LIMIT ?? DEFAULT_PER_TASK_TOKEN_LIMIT),
  };
}

function loadNexusResearchForGoal(
  db: BetterSqlite3.Database,
  goalId: string,
): readonly NexusResearchContext[] {
  const research = getResearchByGoalId(db, goalId);
  if (research.length === 0) return [];

  return research.map((r) => ({
    question: r.question,
    recommendation: r.recommendation,
    rawOutput: r.raw_output,
  }));
}

function loadGoalContext(
  db: BetterSqlite3.Database,
  goalId: string,
): GoalContext | undefined {
  const goal = getGoalById(db, goalId);
  if (!goal) return undefined;

  return { title: goal.title, description: goal.description };
}

async function buildRepositoryIndexSummary(workspacePath: string): Promise<string> {
  try {
    const structure = await discoverProjectStructure(workspacePath);
    const index = await buildRepositoryIndex(workspacePath, structure);
    return formatIndexForPrompt(index, REPO_INDEX_MAX_CHARS);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to build repository index for OpenClaw instructions");
    return "";
  }
}


function buildInitialInput(task: string, expectedOutput: string): readonly ResponseItem[] {
  return [
    {
      role: "user",
      content: [
        "IMPLEMENT the following task by making actual code changes using your tools:",
        "",
        task,
        "",
        expectedOutput ? `Expected output: ${expectedOutput}` : "",
        "",
        "INSTRUCTIONS:",
        `1. Start by calling read_file("${PROJECT_TREE_FILENAME}") to see the project structure.`,
        "2. Read the relevant source files to understand the current code.",
        "3. Use edit_file or write_file to make the required changes.",
        "4. Verify your changes with run_command.",
        "",
        "CRITICAL: You MUST call tools to read and modify files. Do NOT just write a plan or explanation.",
        "If you respond with only text and no tool calls, the task will be marked as FAILED.",
      ].filter(Boolean).join("\n"),
    },
  ];
}

function buildToolResultItems(
  toolCalls: readonly ToolCall[],
  toolResults: readonly string[],
): readonly ResponseItem[] {
  return toolCalls.map((tc, i) => ({
    role: "tool" as const,
    content: toolResults[i],
    tool_call_id: tc.callId,
  }));
}

interface ToolLoopState {
  readonly conversationHistory: ResponseItem[];
  totalTokensUsed: number;
  iterationsUsed: number;
  lastResponse: OpenClawToolResponse | null;
}

async function executeToolCalls(
  toolExecutorConfig: ToolExecutorConfig,
  toolCalls: readonly ToolCall[],
): Promise<readonly string[]> {
  const results: string[] = [];

  for (const tc of toolCalls) {
    const result = await executeTool(toolExecutorConfig, tc);
    results.push(result);

    logger.debug(
      { tool: tc.name, callId: tc.callId, resultLen: result.length },
      "Tool call executed",
    );
  }

  return results;
}

function checkBudgetExceeded(
  state: ToolLoopState,
  config: OpenClawExecutorConfig,
): string | null {
  if (state.totalTokensUsed >= config.perTaskTokenLimit) {
    return `Token budget exceeded: ${String(state.totalTokensUsed)} / ${String(config.perTaskTokenLimit)}`;
  }

  if (state.iterationsUsed >= config.maxIterations) {
    return `Max iterations reached: ${String(state.iterationsUsed)} / ${String(config.maxIterations)}`;
  }

  return null;
}

function extractFinalDescription(response: OpenClawToolResponse): string {
  return response.text ?? "Task completed (no summary provided by agent)";
}

interface LoopContext {
  readonly config: OpenClawExecutorConfig;
  readonly instructions: string;
  readonly tools: readonly import("../shared/openclawResponsesClient.js").ToolDefinition[];
  readonly toolExecutorConfig: ToolExecutorConfig;
  readonly workspacePath: string;
  readonly traceId?: string;
  readonly startTime: number;
}

type IterationOutcome =
  | { readonly done: false }
  | { readonly done: true; readonly result: OpenClawExecutionResult };

function handleFailedResponse(
  response: OpenClawToolResponse,
  state: ToolLoopState,
): IterationOutcome {
  return {
    done: true,
    result: {
      success: false,
      description: "",
      filesChanged: [],
      totalTokensUsed: state.totalTokensUsed,
      iterationsUsed: state.iterationsUsed,
      error: response.text ?? "OpenClaw agent returned failed status",
    },
  };
}

async function handleCompletedResponse(
  response: OpenClawToolResponse,
  state: ToolLoopState,
  ctx: LoopContext,
): Promise<IterationOutcome> {
  const description = extractFinalDescription(response);
  const elapsed = Math.round(performance.now() - ctx.startTime);

  logger.info(
    {
      iterations: state.iterationsUsed,
      tokens: state.totalTokensUsed,
      elapsed,
    },
    "OpenClaw autonomous execution completed — file sync will determine final result",
  );

  return {
    done: true,
    result: {
      success: true,
      description,
      filesChanged: [],
      totalTokensUsed: state.totalTokensUsed,
      iterationsUsed: state.iterationsUsed,
    },
  };
}

async function handleToolCallResponse(
  response: OpenClawToolResponse,
  state: ToolLoopState,
  ctx: LoopContext,
): Promise<void> {
  const toolResults = await executeToolCalls(ctx.toolExecutorConfig, response.toolCalls!);

  if (response.rawAssistantMessage) {
    state.conversationHistory.push({
      role: "assistant",
      content: response.rawAssistantMessage.content ?? "",
      tool_calls: response.rawAssistantMessage.tool_calls,
    });
  }

  const resultItems = buildToolResultItems(response.toolCalls!, toolResults);
  state.conversationHistory.push(...resultItems);
}

async function processIteration(
  state: ToolLoopState,
  ctx: LoopContext,
): Promise<IterationOutcome> {
  const response = await callOpenClawWithTools({
    agentId: "forge",
    input: state.conversationHistory,
    instructions: ctx.instructions,
    tools: ctx.tools,
    maxOutputTokens: ctx.config.maxOutputTokens,
    traceId: ctx.traceId,
  });

  state.lastResponse = response;
  state.iterationsUsed++;

  if (response.usage) {
    state.totalTokensUsed += response.usage.totalTokens;
  }

  logger.info(
    { iteration: state.iterationsUsed, status: response.status, toolCalls: response.toolCalls?.length ?? 0, tokens: state.totalTokensUsed },
    "OpenClaw iteration completed",
  );

  if (response.status === "failed") return handleFailedResponse(response, state);
  if (response.status === "completed") return handleCompletedResponse(response, state, ctx);

  if (response.status === "requires_action" && response.toolCalls && response.toolCalls.length > 0) {
    await handleToolCallResponse(response, state, ctx);
    return { done: false };
  }

  logger.warn({ status: response.status, iteration: state.iterationsUsed }, "Unexpected status, treating as completed");
  return {
    done: true,
    result: { success: true, description: response.text ?? "Unexpected completion", filesChanged: [], totalTokensUsed: state.totalTokensUsed, iterationsUsed: state.iterationsUsed },
  };
}

interface OpenClawLoopParams {
  readonly db: BetterSqlite3.Database;
  readonly delegation: KairosDelegation;
  readonly project: Project;
  readonly workspacePath: string;
  readonly config: OpenClawExecutorConfig;
  readonly startTime: number;
  readonly traceId?: string;
}

export async function executeWithOpenClaw(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  project: Project,
  workspacePath: string,
  traceId?: string,
): Promise<OpenClawExecutionResult> {
  const config = loadExecutorConfig();

  logger.info(
    { projectId: project.project_id, task: delegation.task.slice(0, 100), maxIterations: config.maxIterations, tokenLimit: config.perTaskTokenLimit },
    "Starting OpenClaw autonomous execution",
  );

  const startTime = performance.now();

  await copyWorkspaceToSandbox(workspacePath);
  logger.info(
    { sandboxPath: resolvedAgentWorkspace, workspacePath },
    "OpenClaw sandbox workspace prepared",
  );

  try {
    const result = await executeOpenClawLoop({ db, delegation, project, workspacePath, config, startTime, traceId });

    const syncedFiles = await syncChangesBack(workspacePath);

    if (syncedFiles.length > 0 && !result.success) {
      return {
        ...result,
        success: true,
        filesChanged: syncedFiles,
        error: undefined,
      };
    }

    if (syncedFiles.length > 0) {
      return { ...result, filesChanged: syncedFiles };
    }

    return result;
  } finally {
    await cleanupSandboxProjectFiles();
  }
}

async function executeOpenClawLoop(params: OpenClawLoopParams): Promise<OpenClawExecutionResult> {
  const { db, delegation, project, workspacePath, config, startTime, traceId } = params;
  const { task, expected_output, goal_id } = delegation;

  const [nexusResearch, goalContext, repoIndexSummary, baselineBuildFailed] = await Promise.all([
    Promise.resolve(loadNexusResearchForGoal(db, goal_id)),
    Promise.resolve(loadGoalContext(db, goal_id)),
    buildRepositoryIndexSummary(workspacePath),
    checkBaselineBuild(workspacePath, 60_000),
  ]);

  const instructions = buildOpenClawInstructions({
    task,
    expectedOutput: expected_output,
    language: project.language,
    framework: project.framework,
    projectId: project.project_id,
    nexusResearch: nexusResearch.length > 0 ? nexusResearch : undefined,
    goalContext,
    repositoryIndexSummary: repoIndexSummary || undefined,
    baselineBuildFailed,
  });

  const ctx: LoopContext = {
    config,
    instructions,
    tools: getAllToolDefinitions(),
    toolExecutorConfig: createDefaultConfig(workspacePath),
    workspacePath,
    traceId,
    startTime,
  };

  const state: ToolLoopState = {
    conversationHistory: [...buildInitialInput(task, expected_output)],
    totalTokensUsed: 0,
    iterationsUsed: 0,
    lastResponse: null,
  };

  while (true) {
    const elapsed = performance.now() - startTime;
    if (elapsed >= config.taskTimeoutMs) {
      logger.warn({ elapsed, timeout: config.taskTimeoutMs, iterations: state.iterationsUsed }, "OpenClaw task timeout reached");
      return buildTimeoutResult(state);
    }

    const budgetError = checkBudgetExceeded(state, config);
    if (budgetError) {
      logger.warn({ reason: budgetError, iterations: state.iterationsUsed, tokens: state.totalTokensUsed }, "OpenClaw budget limit reached");
      return buildBudgetExceededResult(state, budgetError);
    }

    const outcome = await processIteration(state, ctx);
    if (outcome.done) return outcome.result;
  }
}

function buildTimeoutResult(state: ToolLoopState): OpenClawExecutionResult {
  return {
    success: false,
    description: "Task timed out — partial changes will be synced back if any",
    filesChanged: [],
    totalTokensUsed: state.totalTokensUsed,
    iterationsUsed: state.iterationsUsed,
    error: "Task execution timed out",
  };
}

function buildBudgetExceededResult(state: ToolLoopState, reason: string): OpenClawExecutionResult {
  return {
    success: false,
    description: `Budget limit: ${reason}. Partial changes will be synced back if any.`,
    filesChanged: [],
    totalTokensUsed: state.totalTokensUsed,
    iterationsUsed: state.iterationsUsed,
    error: reason,
  };
}

export function buildForgeCodeOutput(
  result: OpenClawExecutionResult,
): ForgeCodeOutput {
  return {
    description: result.description,
    risk: result.filesChanged.length > 3 ? 3 : Math.max(1, result.filesChanged.length),
    rollback: "git checkout -- " + result.filesChanged.join(" "),
    files: result.filesChanged.map((filePath) => ({
      path: filePath,
      action: "modify" as const,
      content: "",
    })),
  };
}
