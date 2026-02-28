import type BetterSqlite3 from "better-sqlite3";
import { execFile } from "node:child_process";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "../../config/logger.js";
import { getResearchByGoalId } from "../../state/nexusResearch.js";
import { getGoalById } from "../../state/goals.js";
import { discoverProjectStructure } from "../discovery/fileDiscovery.js";
import { buildRepositoryIndex, formatIndexForPrompt } from "../discovery/repositoryIndexer.js";
import { buildClaudeMdContent } from "./claudeCliInstructions.js";
import type { ClaudeCliInstructionsContext } from "./claudeCliInstructions.js";
import type { NexusResearchContext, GoalContext } from "./forgeTypes.js";
import { REPO_INDEX_MAX_CHARS, CLAUDE_MD_FILENAME } from "./claudeCliTypes.js";
import type { ClaudeAuthStatus } from "./claudeCliTypes.js";

const execFileAsync = promisify(execFile);

export async function verifyClaudeCliAvailable(cliPath: string): Promise<ClaudeAuthStatus> {
  try {
    await execFileAsync(cliPath, ["--version"], { timeout: 10_000 });
  } catch {
    return { available: false, authenticated: false, error: `Claude CLI not found at "${cliPath}"` };
  }

  try {
    const { stdout } = await execFileAsync(cliPath, ["auth", "status"], { timeout: 10_000 });
    const status = JSON.parse(stdout.trim()) as { loggedIn?: boolean; subscriptionType?: string | null };

    if (!status.loggedIn) {
      return { available: true, authenticated: false, error: "Claude CLI is not authenticated. Run: claude auth login" };
    }

    logger.info(
      { loggedIn: status.loggedIn, subscriptionType: status.subscriptionType },
      "Claude CLI auth status",
    );

    return { available: true, authenticated: true };
  } catch {
    return { available: true, authenticated: true };
  }
}

export async function detectChangedFiles(workspacePath: string): Promise<readonly string[]> {
  try {
    const { stdout: trackedDiff } = await execFileAsync(
      "git",
      ["diff", "--name-only", "HEAD"],
      { cwd: workspacePath, timeout: 15_000 },
    );

    const { stdout: untrackedFiles } = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: workspacePath, timeout: 15_000 },
    );

    const files = new Set<string>();

    for (const line of trackedDiff.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }

    for (const line of untrackedFiles.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }

    return [...files].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to detect changed files via git");
    return [];
  }
}

export function buildPrompt(task: string, expectedOutput: string): string {
  return buildImplementationPrompt(task, expectedOutput);
}

export function buildPlanningPrompt(task: string, expectedOutput: string): string {
  const lines = [
    "ANALYZE the codebase and create a detailed execution plan for the following task.",
    "You are a TECH LEAD — you plan, you do NOT implement.",
    "",
    "Task:",
    task,
  ];

  if (expectedOutput) {
    lines.push("", `Expected output: ${expectedOutput}`);
  }

  lines.push(
    "",
    "Instructions:",
    "1. Read the project structure to understand the codebase layout",
    "2. Read the relevant source files, Prisma schema (if applicable), existing tests, and configuration",
    "3. Identify ALL files that need to be created or modified",
    "4. Produce a structured execution plan with this format:",
    "",
    "## Execution Plan",
    "### Impact Analysis",
    "- Files to modify: [list]",
    "- Files to create: [list]",
    "- Dependencies affected: [list]",
    "- Risk level: LOW | MEDIUM | HIGH",
    "",
    "### Tasks (in order)",
    "TASK 1 — [name]: [description, files, what to do]",
    "TASK 2 — [name]: [description, files, what to do]",
    "...",
    "",
    "### Verification Steps",
    "- What to check after implementation",
    "",
    "CRITICAL: Do NOT modify any files. Use only Read, Glob, Grep, and Bash (read-only commands).",
    "Your output will be passed to an implementation agent as a blueprint.",
  );

  return lines.join("\n");
}

export function buildImplementationPrompt(task: string, expectedOutput: string, executionPlan?: string): string {
  const lines = [
    "IMPLEMENT the following task by making actual code changes:",
    "",
    task,
  ];

  if (expectedOutput) {
    lines.push("", `Expected output: ${expectedOutput}`);
  }

  if (executionPlan) {
    lines.push(
      "",
      "## Execution Plan (from planning phase)",
      "Follow this plan. It was produced by analyzing the codebase:",
      "",
      executionPlan,
    );
  }

  lines.push(
    "",
    "CRITICAL: You MUST use tools to read and modify files. Do NOT just write a plan or explanation.",
    "If you respond with only text and no tool calls, the task will be marked as FAILED.",
  );

  return lines.join("\n");
}

export function buildTestingPrompt(task: string, filesChanged: readonly string[]): string {
  const lines = [
    "WRITE automated tests for the following changes that were just implemented:",
    "",
    `Original task: ${task}`,
    "",
    "Files changed:",
    ...filesChanged.map((f) => `- ${f}`),
    "",
    "Instructions:",
    "1. Read each changed file to understand what was implemented",
    "2. Identify which files need test coverage",
    "3. Write unit tests for business logic and integration tests for cross-module flows",
    "4. Run the tests to verify they pass: `npx vitest run` or `npm test`",
    "5. Fix any failing tests before finishing",
    "",
    "Rules:",
    "- All test descriptions (describe/it blocks) MUST be written in English",
    "- Tests must be clear, descriptive, and independent from each other",
    "- Never use `any` type in test code",
    "- Follow existing test patterns and conventions in the project",
    "- Only create tests for the newly changed/created files — do NOT modify existing tests",
    "",
    "CRITICAL: You MUST use tools to create test files. Do NOT just write a plan.",
  ];

  return lines.join("\n");
}

export async function writeClaudeMd(
  workspacePath: string,
  ctx: ClaudeCliInstructionsContext,
): Promise<string> {
  const content = buildClaudeMdContent(ctx);
  const filePath = path.join(workspacePath, CLAUDE_MD_FILENAME);
  await fsPromises.writeFile(filePath, content, "utf-8");
  logger.debug({ path: filePath }, "Generated CLAUDE.md for Claude CLI executor");
  return filePath;
}

export async function removeClaudeMd(workspacePath: string): Promise<void> {
  try {
    await fsPromises.unlink(path.join(workspacePath, CLAUDE_MD_FILENAME));
  } catch {
    // ignore if already removed
  }
}

export function loadNexusResearchForGoal(
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

export function loadGoalContext(db: BetterSqlite3.Database, goalId: string): GoalContext | undefined {
  const goal = getGoalById(db, goalId);
  if (!goal) return undefined;
  return { title: goal.title, description: goal.description };
}

export async function readProjectInstructions(workspacePath: string): Promise<string | undefined> {
  try {
    const content = await fsPromises.readFile(
      path.join(workspacePath, ".axiom", "instructions.md"),
      "utf-8",
    );
    return content.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function buildRepositoryIndexSummary(workspacePath: string, maxChars?: number): Promise<string> {
  try {
    const structure = await discoverProjectStructure(workspacePath);
    const index = await buildRepositoryIndex(workspacePath, structure);
    return formatIndexForPrompt(index, maxChars ?? REPO_INDEX_MAX_CHARS);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to build repository index for Claude CLI");
    return "";
  }
}
