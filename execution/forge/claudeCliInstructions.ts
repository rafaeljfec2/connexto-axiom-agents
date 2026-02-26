import type { NexusResearchContext, GoalContext } from "./forgeTypes.js";
import { classifyTaskType } from "./openclawInstructions.js";
import type { ForgeTaskType } from "./openclawInstructions.js";

export interface ClaudeCliInstructionsContext {
  readonly task: string;
  readonly expectedOutput: string;
  readonly language: string;
  readonly framework: string;
  readonly projectId: string;
  readonly nexusResearch?: readonly NexusResearchContext[];
  readonly goalContext?: GoalContext;
  readonly repositoryIndexSummary?: string;
  readonly baselineBuildFailed: boolean;
}

export function buildClaudeMdContent(ctx: ClaudeCliInstructionsContext): string {
  const taskType = classifyTaskType(ctx.task);

  const sections: string[] = [
    buildIdentitySection(),
    buildDecisionProtocolSection(taskType),
    buildTaskContextSection(ctx),
    buildGoalSection(ctx.goalContext),
    buildNexusSection(ctx.nexusResearch),
    buildRepositorySection(ctx.repositoryIndexSummary, taskType),
    buildWorkflowSection(ctx.baselineBuildFailed),
    buildQualityRulesSection(),
    buildSecurityRulesSection(),
  ];

  return sections.filter(Boolean).join("\n\n");
}

function buildIdentitySection(): string {
  return [
    "# Identity",
    "",
    "You are FORGE, an autonomous coding agent that IMPLEMENTS code changes.",
    "You MUST use your tools to make actual changes to files.",
    "NEVER respond with just text, plans, or explanations — ALWAYS use tools to read code, then edit or write files.",
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

function buildDecisionProtocolSection(taskType: ForgeTaskType): string {
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

  return [
    "# Decision Protocol",
    "",
    `**Mode:** ${taskType}`,
    "",
    ...protocols[taskType],
  ].join("\n");
}

function buildTaskContextSection(ctx: ClaudeCliInstructionsContext): string {
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

function buildWorkflowSection(baselineBuildFailed: boolean): string {
  const lines = [
    "# Workflow",
    "",
    "1. Read the project structure to understand the codebase layout.",
    "2. Read relevant source files before making any changes.",
    "3. Make changes using Edit (preferred for partial changes) or Write (for new files).",
    "4. After making changes, verify them:",
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
    "5. If verification finds errors, fix them and re-verify.",
    "6. When done, provide a clear summary of what you changed and why.",
    "",
    "## Important",
    "- Edit the minimum number of files necessary to complete the task.",
    "- All paths are relative to the project root.",
    "- Do not add unnecessary comments to the code.",
  );

  return lines.join("\n");
}

function buildQualityRulesSection(): string {
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

function buildSecurityRulesSection(): string {
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
