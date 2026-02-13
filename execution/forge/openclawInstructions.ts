import type { NexusResearchContext, GoalContext } from "./forgeTypes.js";

export interface InstructionsContext {
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

export function buildOpenClawInstructions(ctx: InstructionsContext): string {
  const sections: string[] = [
    buildIdentitySection(),
    buildTaskSection(ctx),
    buildGoalSection(ctx.goalContext),
    buildNexusSection(ctx.nexusResearch),
    buildRepositorySection(ctx.repositoryIndexSummary),
    buildToolUsageRules(ctx.baselineBuildFailed),
    buildQualityRules(),
    buildSecurityRules(),
  ];

  return sections.filter(Boolean).join("\n\n");
}

function buildIdentitySection(): string {
  return [
    "# Identity",
    "",
    "You are FORGE, an autonomous coding agent. Your purpose is to implement code changes in a project workspace.",
    "You have tools to read files, write files, edit files, run commands, list directories, and search code.",
    "You operate independently: plan your approach, execute it, verify the results, and fix any issues.",
  ].join("\n");
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

function buildRepositorySection(summary?: string): string {
  if (!summary) return "";

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
    "1. Start by understanding the codebase: use `search_code` and `list_directory` to find relevant files",
    "2. Use `read_file` before editing ANY file to understand its current state",
    "3. Make changes using `edit_file` (preferred for partial changes) or `write_file` (for new files or complete rewrites)",
    "4. After making changes, verify them:",
    "   - Run `run_command` with 'npx tsc --noEmit' to check TypeScript errors",
    "   - Run `run_command` with 'npx eslint <changed-files>' to check lint",
  ];

  if (baselineBuildFailed) {
    lines.push(
      "   - **DO NOT run the build command** — the build was already failing before your changes (pre-existing issue)",
    );
  } else {
    lines.push("   - Optionally run the build if the project has a build script");
  }

  lines.push(
    "5. If verification finds errors, fix them and re-verify",
    "6. When done, provide a clear summary of what you changed and why",
    "",
    "## Important",
    "- The `search` parameter in `edit_file` must match the file content EXACTLY (copy from `read_file` output)",
    "- Never guess file contents — always `read_file` first",
    "- All paths must be relative to the workspace root",
    "- Edit the minimum number of files necessary to complete the task",
    "- Do not add unnecessary comments to the code",
    "- When the task is complete, stop calling tools and provide your summary",
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
    "- NEVER modify .env files or files containing secrets",
    "- NEVER commit credentials or API keys",
    "- NEVER run destructive commands (rm -rf, git push, npm publish)",
    "- NEVER modify files outside the workspace",
    "- Validate and sanitize any user input in code you write",
  ].join("\n");
}
