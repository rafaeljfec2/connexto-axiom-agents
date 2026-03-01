import type { NexusResearchContext, GoalContext } from "./forgeTypes.js";
import type { ForgeTaskType } from "./openclawInstructions.js";
import type { TaskComplexity } from "./claudeCliTypes.js";

export interface InstructionSectionContext {
  readonly task: string;
  readonly expectedOutput: string;
  readonly language: string;
  readonly framework: string;
  readonly projectId: string;
  readonly nexusResearch?: readonly NexusResearchContext[];
  readonly goalContext?: GoalContext;
  readonly repositoryIndexSummary?: string;
  readonly baselineBuildFailed: boolean;
  readonly projectInstructions?: string;
  readonly referenceExamples?: string;
  readonly complexity?: TaskComplexity;
}

export function buildComplexityHintSection(complexity: TaskComplexity): string {
  if (complexity === "complex") {
    return [
      "# Complexity: HIGH",
      "",
      "This is a complex task. Before implementing:",
      "1. Read the full project structure and understand the architecture",
      "2. Plan your approach before writing any code",
      "3. Identify all files that need changes and their dependencies",
      "4. Implement incrementally, verifying after each major step",
    ].join("\n");
  }
  return "";
}

export function buildIdentitySection(): string {
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

export function buildPlanningIdentitySection(): string {
  return [
    "# Identity",
    "",
    "You are FORGE PLANNER, an autonomous tech lead agent that ANALYZES codebases and produces execution plans.",
    "You are a PLANNER — you read and analyze code, but you do NOT modify any files.",
    "Your role is to understand the project structure, identify impacted areas, and produce a detailed execution plan.",
    "",
    "## Absolute Restrictions",
    "",
    "- NEVER modify, create, or delete any files",
    "- NEVER use Write or Edit tools",
    "- ONLY use Read, Glob, Grep, and Bash (for read-only commands like `cat`, `find`, `ls`, `tsc --noEmit`)",
    "- NEVER run commands that modify files (no `npm install`, no `git commit`, no write operations)",
    "- NEVER skip reading the codebase before planning",
  ].join("\n");
}

export function buildTestingIdentitySection(): string {
  return [
    "# Identity",
    "",
    "You are FORGE TESTER, an autonomous test automation agent.",
    "Your role is to write automated tests for recently implemented changes.",
    "You read the changed files, understand the implementation, and create comprehensive test coverage.",
    "",
    "## Absolute Restrictions",
    "",
    "- ONLY create or modify test files — NEVER touch production code",
    "- NEVER modify .env files or files containing secrets",
    "- NEVER skip reading the implementation before writing tests",
    "- NEVER leave failing tests — fix them before finishing",
  ].join("\n");
}

export function buildDecisionProtocolSection(taskType: ForgeTaskType): string {
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

export function buildTaskContextSection(ctx: InstructionSectionContext): string {
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

export function buildGoalSection(goalContext?: GoalContext): string {
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

export function buildNexusSection(research?: readonly NexusResearchContext[]): string {
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

export function buildRepositorySection(summary?: string, taskType?: ForgeTaskType): string {
  if (!summary) return "";
  if (taskType === "FIX") return "";

  return [
    "# Repository Index (summary of key files)",
    "",
    summary,
  ].join("\n");
}

export function buildWorkflowSection(baselineBuildFailed: boolean): string {
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
    "6. When done, provide a structured delivery summary.",
    "",
    "## Delivery Summary Format",
    "When you finish the task, provide:",
    "- **Technical summary** (1-2 paragraphs): what was changed and why",
    "- **Files changed**: list of modified/created files",
    "- **Possible improvements**: suggest next steps or improvements based on your analysis",
    "- **Impact notes**: mention if the change affects business rules, performance, or UX",
    "",
    "## Important",
    "- Edit the minimum number of files necessary to complete the task.",
    "- All paths are relative to the project root.",
    "- Do not add unnecessary comments to the code.",
    "- Consider the intent behind the feature and its impact on end users.",
  );

  return lines.join("\n");
}

export function buildPlanningWorkflowSection(): string {
  return [
    "# Workflow",
    "",
    "1. Read the project structure (`ls`, `find`, `tree`) to understand the codebase layout",
    "2. Read the Prisma schema, package.json, tsconfig, and key configuration files",
    "3. Read the specific source files related to the task",
    "4. Analyze the impact: what files need changes, what modules are affected, what could break",
    "5. Produce an execution plan in the following format:",
    "",
    "## Execution Plan Format",
    "",
    "### Impact Analysis",
    "- **Files to modify**: list every file that needs changes",
    "- **Files to create**: list any new files to be created",
    "- **Dependencies**: list modules/packages that are affected",
    "- **Risk**: LOW | MEDIUM | HIGH with justification",
    "",
    "### Tasks (ordered by dependency)",
    "For each task:",
    "- **TASK N — [Name]**: description of what to do",
    "  - Files: [list of files involved]",
    "  - Details: [specific changes needed]",
    "  - Depends on: [previous tasks, if any]",
    "",
    "### Verification Steps",
    "- List specific commands/checks to run after implementation",
    "",
    "## Important",
    "- Be specific: reference exact file paths, function names, and line ranges",
    "- Order tasks by dependency — schema before logic, types before implementation",
    "- Consider existing patterns in the codebase",
  ].join("\n");
}

export function buildTestingWorkflowSection(): string {
  return [
    "# Workflow",
    "",
    "1. Read each changed file to understand the implementation",
    "2. Identify the test framework used (vitest, jest, node:test, etc.)",
    "3. Check existing test patterns in the project for conventions",
    "4. Write unit tests for business logic (pure functions, services, utils)",
    "5. Write integration tests for cross-module flows (API endpoints, controllers)",
    "6. Run the tests to verify they pass",
    "7. Fix any failing tests and re-run",
    "",
    "## Test Priorities",
    "- Happy path for each new function/endpoint",
    "- Edge cases and error handling",
    "- Input validation",
    "- Integration between changed modules",
    "",
    "## Important",
    "- Follow existing test file naming conventions (`.test.ts`, `.spec.ts`, etc.)",
    "- Use the same assertion library the project already uses",
    "- Do NOT mock external dependencies unless absolutely necessary",
    "- Clean up test data after each test (isolated tests)",
  ].join("\n");
}

export function buildCorrectionWorkflowSection(baselineBuildFailed: boolean): string {
  const lines = [
    "# Correction Workflow",
    "",
    "You are fixing validation errors from a previous implementation attempt.",
    "Focus ONLY on resolving the reported errors — do NOT refactor or change unrelated code.",
    "",
    "1. Read the error output carefully to understand each failure.",
    "2. Read the failing files to understand the context.",
    "3. Apply the minimal fix for each error.",
    "4. Verify with `npx tsc --noEmit` and `npx eslint <changed-files>`.",
  ];

  if (baselineBuildFailed) {
    lines.push("5. **DO NOT run the build command** — the build was already failing before your changes.");
  }

  lines.push(
    "",
    "## Important",
    "- Fix errors in order of severity: TypeScript errors first, then lint errors.",
    "- Do NOT add new features or refactor during correction.",
    "- Keep changes minimal and focused.",
  );

  return lines.join("\n");
}

export function buildProjectInstructionsSection(instructions?: string): string {
  if (!instructions) return "";
  return ["# Project-Specific Standards", "", instructions].join("\n");
}

export function buildReferenceExamplesSection(referenceExamples?: string): string {
  if (!referenceExamples) return "";
  return referenceExamples;
}
