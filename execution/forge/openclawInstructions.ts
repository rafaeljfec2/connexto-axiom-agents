import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NexusResearchContext, GoalContext } from "./forgeTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type ForgeTaskType = "IMPLEMENT" | "FIX" | "CREATE" | "REFACTOR";

export interface InstructionsContext {
  readonly task: string;
  readonly expectedOutput: string;
  readonly language: string;
  readonly framework: string;
  readonly projectId: string;
  readonly taskType?: ForgeTaskType;
  readonly nexusResearch?: readonly NexusResearchContext[];
  readonly goalContext?: GoalContext;
  readonly repositoryIndexSummary?: string;
  readonly baselineBuildFailed: boolean;
}

export async function buildOpenClawInstructions(ctx: InstructionsContext): Promise<string> {
  const taskType = ctx.taskType ?? classifyTaskType(ctx.task);

  const sections: string[] = [
    buildIdentitySection(),
    buildDecisionProtocol(taskType),
    buildTaskSection(ctx),
    buildGoalSection(ctx.goalContext),
    buildNexusSection(ctx.nexusResearch),
    buildRepositorySection(ctx.repositoryIndexSummary, taskType),
    buildToolUsageRules(ctx.baselineBuildFailed),
    buildQualityRules(),
    buildSecurityRules(),
    await buildGoldenExampleSection(taskType),
  ];

  return sections.filter(Boolean).join("\n\n");
}

function buildIdentitySection(): string {
  return [
    "# Identity",
    "",
    "You are FORGE, an autonomous coding agent that IMPLEMENTS code changes.",
    "You MUST use your tools (read_file, write_file, edit_file, run_command, search_code) to make actual changes to files.",
    "NEVER respond with just text, plans, or explanations. ALWAYS use tools to read code, then edit or write files.",
    "If a task says 'prepare', 'plan', or 'propose', interpret that as: actually implement the changes in code.",
    "You operate independently: read the existing code, implement changes, verify them, and fix any issues.",
    "",
    "## Absolute Restrictions",
    "",
    "- NEVER modify files outside the workspace",
    "- NEVER expose ORM/database entities directly in controllers or routes",
    "- NEVER skip reading a file before editing it",
    "- NEVER leave the task incomplete — if verification fails, fix it before finishing",
  ].join("\n");
}

const FIX_KEYWORDS = /\b(fix|bug|corrig|hotfix|patch|erro|error|broken|crash|falha)\b/i;
const CREATE_KEYWORDS = /\b(create|cri[ae]|new module|novo modulo|scaffold|bootstrap|from scratch|do zero)\b/i;
const REFACTOR_KEYWORDS = /\b(refactor|refator|clean|reorganiz|extract|split|simplif|melhora|improv|rename)\b/i;

export function classifyTaskType(task: string): ForgeTaskType {
  if (FIX_KEYWORDS.test(task)) return "FIX";
  if (CREATE_KEYWORDS.test(task)) return "CREATE";
  if (REFACTOR_KEYWORDS.test(task)) return "REFACTOR";
  return "IMPLEMENT";
}

function buildDecisionProtocol(taskType: ForgeTaskType): string {
  const header = [
    "# Decision Protocol",
    "",
    `**Mode:** ${taskType}`,
    "",
  ];

  const protocols: Record<ForgeTaskType, string[]> = {
    IMPLEMENT: [
      "You are implementing a complete feature following the task description.",
      "- Read existing code to understand patterns and conventions before writing new code",
      "- Create new files only when necessary — prefer extending existing modules",
      "- Ensure the implementation integrates with the existing codebase (imports, exports, types)",
      "- Run `tsc --noEmit` after changes to verify type safety",
    ],
    FIX: [
      "You are fixing a specific bug with minimal changes.",
      "- Focus ONLY on the root cause — do NOT refactor unrelated code",
      "- Do NOT create new files unless absolutely required by the fix",
      "- Read the failing code first, understand the bug, then apply the smallest correct fix",
      "- Verify the fix resolves the issue without introducing regressions",
    ],
    CREATE: [
      "You are creating a new module from scratch.",
      "- Follow the existing project structure and naming conventions",
      "- Create proper type definitions before implementing logic",
      "- Ensure the new module exports are properly connected to the rest of the codebase",
      "- Include barrel exports (index.ts) if the project uses them",
    ],
    REFACTOR: [
      "You are improving existing code WITHOUT changing external behavior.",
      "- NEVER change function signatures or public APIs unless explicitly requested",
      "- Ensure all existing tests still pass after refactoring",
      "- Focus on readability, maintainability, and reducing complexity",
      "- If extracting modules, update all import paths accordingly",
    ],
  };

  return [...header, ...protocols[taskType]].join("\n");
}

function buildTaskSection(ctx: InstructionsContext): string {
  const lines = [
    "# Task",
    "",
    `**Project:** ${ctx.projectId}`,
    `**Stack:** ${ctx.language} / ${ctx.framework}`,
    "",
    "## Task Description",
    ctx.task,
  ];

  if (ctx.expectedOutput) {
    lines.push("", "## Expected Output", ctx.expectedOutput);
  }

  return lines.join("\n");
}

function buildGoalSection(goalContext?: GoalContext): string {
  if (!goalContext) return "";

  const lines = [
    "# Goal Context",
    "",
    `**Goal:** ${goalContext.title}`,
  ];

  if (goalContext.description) {
    lines.push(`**Description:** ${goalContext.description}`);
  }

  return lines.join("\n");
}

function buildNexusSection(research?: readonly NexusResearchContext[]): string {
  if (!research || research.length === 0) return "";

  const lines = [
    "# NEXUS Research (already completed)",
    "",
    "The following research has already been done for this task. Use it as context, do NOT repeat the research:",
  ];

  for (const r of research) {
    lines.push(
      "",
      `## Research: ${r.question}`,
      `**Recommendation:** ${r.recommendation}`,
    );

    if (r.rawOutput.length <= 500) {
      lines.push(`**Details:** ${r.rawOutput}`);
    }
  }

  return lines.join("\n");
}

function buildRepositorySection(summary?: string, taskType?: ForgeTaskType): string {
  if (!summary) return "";
  if (taskType === "FIX") return "";

  return [
    "# Repository Index (summary of key files)",
    "",
    summary,
  ].join("\n");
}

function buildToolUsageRules(baselineBuildFailed: boolean): string {
  const lines = [
    "# Tool Usage Rules",
    "",
    "## Workflow",
    "1. **FIRST**: Read the file `_PROJECT_TREE.txt` — it contains the full directory structure of the project.",
    "   Use the paths listed there to navigate the codebase. Do NOT try to read directories — only read files.",
    "2. Use `read_file` before editing ANY file to understand its current state.",
    "   IMPORTANT: Only pass **file paths** to `read_file`, never directory paths. Reading a directory will fail with EISDIR.",
    "3. To find specific content, use `search_code` instead of trying to read directories.",
    "4. Make changes using `edit_file` (preferred for partial changes) or `write_file` (for new files or complete rewrites).",
    "5. After making changes, verify them:",
    "   - Run `npx tsc --noEmit` to check TypeScript errors",
    "   - Run `npx eslint <changed-files>` to check lint",
  ];

  if (baselineBuildFailed) {
    lines.push(
      "   - **DO NOT run the build command** — the build was already failing before your changes (pre-existing issue)",
    );
  } else {
    lines.push("   - Optionally run the build if the project has a build script");
  }

  lines.push(
    "6. If verification finds errors, fix them and re-verify",
    "7. When done, provide a clear summary of what you changed and why",
    "",
    "## Important",
    "- **NEVER pass a directory path to `read_file`** — it will fail with EISDIR. Always use exact file paths from `_PROJECT_TREE.txt`.",
    "- The `search` parameter in `edit_file` must match the file content EXACTLY (copy from `read_file` output)",
    "- Never guess file contents — always `read_file` first",
    "- All paths are relative to the project root (e.g. `apps/web/src/styles/globals.css`)",
    "- Ignore markdown files at the root (AGENTS.md, TOOLS.md, etc.) — those are NOT part of the project",
    "- Edit the minimum number of files necessary to complete the task",
    "- Do not add unnecessary comments to the code",
    "- When the task is complete, stop calling tools and provide your summary",
    "",
    "## Context Compaction",
    "- If you have already made 3+ tool calls without progress, STOP and summarize what you have done so far",
    "- Focus ONLY on the remaining error or pending change — do not re-read files you already read",
    "- If a fix attempt failed, describe WHY it failed before trying a different approach",
    "- Do NOT repeat the same edit that already failed — try an alternative approach",
  );

  return lines.join("\n");
}

function buildQualityRules(): string {
  return [
    "# Code Quality Rules",
    "",
    "- Use `??` instead of `||` for nullish coalescing",
    "- Never use `any` type — always define proper types",
    "- Mark component props as readonly",
    "- Use Promise.all for independent async operations",
    "- Write code in English (US)",
    "- Do not add unnecessary comments",
    "- Keep files under 800 lines; suggest refactoring if close to limit",
  ].join("\n");
}

function buildSecurityRules(): string {
  return [
    "# Security Rules",
    "",
    "- NEVER modify .env files or files containing secrets/credentials",
    "- NEVER commit credentials or API keys",
    "- NEVER run git push, git merge, git rebase, or any git command that alters remote state",
    "- NEVER delete branches or alter git history (no --force, --amend, rebase)",
    "- NEVER run destructive global commands (rm -rf, format, shutdown, npm publish, docker push)",
    "- NEVER modify files outside the workspace",
    "- Validate and sanitize any user input in code you write",
  ].join("\n");
}

const EXAMPLE_FILE_MAP: Partial<Record<ForgeTaskType, string>> = {
  IMPLEMENT: "implement-feature.md",
  FIX: "fix-bug.md",
};

async function buildGoldenExampleSection(taskType: ForgeTaskType): Promise<string> {
  const fileName = EXAMPLE_FILE_MAP[taskType];
  if (!fileName) return "";

  try {
    const examplesDir = path.resolve(__dirname, "../../agents/forge/examples");
    const content = await fsPromises.readFile(path.join(examplesDir, fileName), "utf-8");

    const maxChars = 1500;
    const trimmed = content.length > maxChars ? content.slice(0, maxChars) + "\n...(truncated)" : content;

    return `# Reference Example\n\n${trimmed}`;
  } catch {
    return "";
  }
}
