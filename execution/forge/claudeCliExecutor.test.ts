import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeCliOutput } from "./claudeCliOutputParser.js";
import { selectModelForTask, classifyTaskComplexity, PHASE_TOOL_SETS, PHASE_MAX_TURNS } from "./claudeCliTypes.js";
import type { ClaudeCliExecutorConfig, ClaudeCliExecutionResult } from "./claudeCliTypes.js";
import { buildForgeCodeOutputFromCli } from "./claudeCliExecutor.js";
import { buildClaudeMdContent } from "./claudeCliInstructions.js";
import type { ClaudeCliInstructionsContext } from "./claudeCliInstructions.js";
import { buildPlanningPrompt, buildImplementationPrompt, buildTestingPrompt } from "./claudeCliContext.js";

describe("parseClaudeCliOutput", () => {
  it("should parse valid JSON output with result and usage", () => {
    const raw = JSON.stringify({
      result: "Fixed the bug in auth.ts",
      session_id: "abc-123",
      usage: { input_tokens: 1000, output_tokens: 500 },
    });

    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.result, "Fixed the bug in auth.ts");
    assert.equal(parsed.session_id, "abc-123");
    assert.equal(parsed.usage?.input_tokens, 1000);
    assert.equal(parsed.usage?.output_tokens, 500);
    assert.equal(parsed.is_error, undefined);
  });

  it("should parse JSON output without usage", () => {
    const raw = JSON.stringify({ result: "Done" });
    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.result, "Done");
    assert.equal(parsed.usage, undefined);
  });

  it("should handle empty output as error", () => {
    const parsed = parseClaudeCliOutput("");

    assert.equal(parsed.result, "");
    assert.equal(parsed.is_error, true);
  });

  it("should handle whitespace-only output as error", () => {
    const parsed = parseClaudeCliOutput("   \n  ");

    assert.equal(parsed.result, "");
    assert.equal(parsed.is_error, true);
  });

  it("should fallback to plain text when JSON parsing fails", () => {
    const raw = "This is plain text output from Claude CLI";
    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.result, raw);
    assert.equal(parsed.is_error, false);
  });

  it("should handle JSON with is_error flag", () => {
    const raw = JSON.stringify({ result: "Error occurred", is_error: true });
    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.result, "Error occurred");
    assert.equal(parsed.is_error, true);
  });

  it("should trim whitespace around valid JSON", () => {
    const raw = `  \n  ${JSON.stringify({ result: "trimmed" })}  \n  `;
    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.result, "trimmed");
  });

  it("should parse real Claude CLI v2 output format", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 4325,
      duration_api_ms: 4464,
      num_turns: 2,
      result: "Fixed the auth module",
      stop_reason: null,
      session_id: "631216b7-0af1-4c88-8301-8e1e6cd0f56e",
      total_cost_usd: 0.058846,
      usage: {
        input_tokens: 4,
        cache_creation_input_tokens: 5986,
        cache_read_input_tokens: 33747,
        output_tokens: 161,
      },
      modelUsage: {
        "claude-sonnet-4-6": {
          inputTokens: 4,
          outputTokens: 161,
          cacheReadInputTokens: 33747,
          cacheCreationInputTokens: 5986,
          costUSD: 0.058331,
        },
        "claude-haiku-4-5-20251001": {
          inputTokens: 355,
          outputTokens: 32,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0.000515,
        },
      },
    });

    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.type, "result");
    assert.equal(parsed.subtype, "success");
    assert.equal(parsed.is_error, false);
    assert.equal(parsed.result, "Fixed the auth module");
    assert.equal(parsed.num_turns, 2);
    assert.equal(parsed.duration_ms, 4325);
    assert.equal(parsed.session_id, "631216b7-0af1-4c88-8301-8e1e6cd0f56e");
    assert.ok(parsed.total_cost_usd !== undefined && parsed.total_cost_usd > 0);
    assert.equal(parsed.usage?.input_tokens, 4);
    assert.equal(parsed.usage?.output_tokens, 161);
    assert.equal(parsed.usage?.cache_creation_input_tokens, 5986);
    assert.equal(parsed.usage?.cache_read_input_tokens, 33747);
    assert.ok(parsed.modelUsage !== undefined);
    assert.equal(parsed.modelUsage?.["claude-sonnet-4-6"]?.inputTokens, 4);
    assert.equal(parsed.modelUsage?.["claude-sonnet-4-6"]?.outputTokens, 161);
    assert.equal(parsed.modelUsage?.["claude-haiku-4-5-20251001"]?.inputTokens, 355);
  });

  it("should extract total tokens from modelUsage correctly", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Done",
      modelUsage: {
        "claude-sonnet-4-6": {
          inputTokens: 100,
          outputTokens: 200,
          cacheReadInputTokens: 300,
          cacheCreationInputTokens: 400,
        },
        "claude-haiku-4-5-20251001": {
          inputTokens: 50,
          outputTokens: 25,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    });

    const parsed = parseClaudeCliOutput(raw);

    const sonnet = parsed.modelUsage?.["claude-sonnet-4-6"];
    const haiku = parsed.modelUsage?.["claude-haiku-4-5-20251001"];
    assert.ok(sonnet !== undefined);
    assert.ok(haiku !== undefined);

    const sonnetTotal = (sonnet?.inputTokens ?? 0) + (sonnet?.outputTokens ?? 0)
      + (sonnet?.cacheReadInputTokens ?? 0) + (sonnet?.cacheCreationInputTokens ?? 0);
    const haikuTotal = (haiku?.inputTokens ?? 0) + (haiku?.outputTokens ?? 0)
      + (haiku?.cacheReadInputTokens ?? 0) + (haiku?.cacheCreationInputTokens ?? 0);

    assert.equal(sonnetTotal, 1000);
    assert.equal(haikuTotal, 75);
  });
});

describe("buildForgeCodeOutputFromCli", () => {
  it("should build ForgeCodeOutput from execution result with files", () => {
    const result: ClaudeCliExecutionResult = {
      success: true,
      status: "SUCCESS",
      description: "Implemented auth module",
      filesChanged: ["src/auth.ts", "src/auth.test.ts"],
      totalTokensUsed: 1500,
      totalCostUsd: 0.05,
      iterationsUsed: 1,
      validations: { install: "ok", lint: "ok", build: "ok", tests: "ok" },
      correctionCycles: 0,
    };

    const output = buildForgeCodeOutputFromCli(result);

    assert.equal(output.description, "Implemented auth module");
    assert.equal(output.risk, 2);
    assert.equal(output.files.length, 2);
    assert.equal(output.files[0].path, "src/auth.ts");
    assert.equal(output.files[0].action, "modify");
    assert.equal(output.files[1].path, "src/auth.test.ts");
    assert.ok(output.rollback.includes("src/auth.ts"));
  });

  it("should cap risk at 2 when more than 2 files changed", () => {
    const result: ClaudeCliExecutionResult = {
      success: true,
      status: "SUCCESS",
      description: "Large refactor",
      filesChanged: ["a.ts", "b.ts", "c.ts", "d.ts"],
      totalTokensUsed: 3000,
      totalCostUsd: 0.1,
      iterationsUsed: 1,
      validations: { install: "ok", lint: "ok", build: "ok", tests: "ok" },
      correctionCycles: 0,
    };

    const output = buildForgeCodeOutputFromCli(result);

    assert.equal(output.risk, 2);
    assert.equal(output.files.length, 4);
  });

  it("should set risk to 1 for single file change", () => {
    const result: ClaudeCliExecutionResult = {
      success: true,
      status: "SUCCESS",
      description: "Quick fix",
      filesChanged: ["src/fix.ts"],
      totalTokensUsed: 500,
      totalCostUsd: 0.01,
      iterationsUsed: 1,
      validations: { install: "ok", lint: "ok", build: "ok", tests: "ok" },
      correctionCycles: 0,
    };

    const output = buildForgeCodeOutputFromCli(result);

    assert.equal(output.risk, 1);
  });

  it("should handle empty files list", () => {
    const result: ClaudeCliExecutionResult = {
      success: true,
      status: "SUCCESS",
      description: "No changes needed",
      filesChanged: [],
      totalTokensUsed: 200,
      totalCostUsd: 0,
      iterationsUsed: 1,
      validations: { install: "skipped", lint: "skipped", build: "skipped", tests: "skipped" },
      correctionCycles: 0,
    };

    const output = buildForgeCodeOutputFromCli(result);

    assert.equal(output.files.length, 0);
    assert.equal(output.risk, 0);
  });
});

describe("buildClaudeMdContent", () => {
  const baseContext: ClaudeCliInstructionsContext = {
    task: "Implement user authentication",
    expectedOutput: "A working auth module with login endpoint",
    language: "typescript",
    framework: "nestjs",
    projectId: "test-project",
    baselineBuildFailed: false,
  };

  it("should include identity section", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(content.includes("# Identity"));
    assert.ok(content.includes("FORGE"));
    assert.ok(content.includes("autonomous coding agent"));
  });

  it("should include task section with project details", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(content.includes("# Task"));
    assert.ok(content.includes("**Project:** test-project"));
    assert.ok(content.includes("**Stack:** typescript / nestjs"));
    assert.ok(content.includes("Implement user authentication"));
  });

  it("should include expected output when provided", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(content.includes("## Expected Output"));
    assert.ok(content.includes("A working auth module with login endpoint"));
  });

  it("should include decision protocol section", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(content.includes("# Decision Protocol"));
    assert.ok(content.includes("**Mode:** IMPLEMENT"));
  });

  it("should classify FIX tasks correctly", () => {
    const fixCtx = { ...baseContext, task: "Fix the login bug in auth service" };
    const content = buildClaudeMdContent(fixCtx);

    assert.ok(content.includes("**Mode:** FIX"));
    assert.ok(content.includes("fixing a specific bug"));
  });

  it("should classify CREATE tasks correctly", () => {
    const createCtx = { ...baseContext, task: "Create a new payment module from scratch" };
    const content = buildClaudeMdContent(createCtx);

    assert.ok(content.includes("**Mode:** CREATE"));
    assert.ok(content.includes("creating a new module"));
  });

  it("should classify REFACTOR tasks correctly", () => {
    const refactorCtx = { ...baseContext, task: "Refactor the database layer for better performance" };
    const content = buildClaudeMdContent(refactorCtx);

    assert.ok(content.includes("**Mode:** REFACTOR"));
    assert.ok(content.includes("improving existing code"));
  });

  it("should include security rules", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(content.includes("# Security Rules"));
    assert.ok(content.includes("NEVER modify .env"));
    assert.ok(content.includes("NEVER run git push"));
    assert.ok(content.includes("NEVER run destructive global commands"));
  });

  it("should include quality rules", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(content.includes("# Code Quality Rules"));
    assert.ok(content.includes("Use `??` instead of `||`"));
    assert.ok(content.includes("Never use `any` type"));
  });

  it("should include workflow section", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(content.includes("# Workflow"));
    assert.ok(content.includes("npx tsc --noEmit"));
    assert.ok(content.includes("npx eslint"));
  });

  it("should warn about baseline build failure when applicable", () => {
    const failedBuildCtx = { ...baseContext, baselineBuildFailed: true };
    const content = buildClaudeMdContent(failedBuildCtx);

    assert.ok(content.includes("DO NOT run the build command"));
    assert.ok(content.includes("pre-existing issue"));
  });

  it("should include NEXUS research when provided", () => {
    const ctxWithResearch = {
      ...baseContext,
      nexusResearch: [
        {
          question: "Best auth library for NestJS?",
          recommendation: "Use passport.js with JWT strategy",
          rawOutput: "Short analysis",
        },
      ],
    };

    const content = buildClaudeMdContent(ctxWithResearch);

    assert.ok(content.includes("# NEXUS Research"));
    assert.ok(content.includes("Best auth library for NestJS?"));
    assert.ok(content.includes("Use passport.js with JWT strategy"));
  });

  it("should not include NEXUS section when no research provided", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(!content.includes("# NEXUS Research"));
  });

  it("should include goal context when provided", () => {
    const ctxWithGoal = {
      ...baseContext,
      goalContext: { title: "Implement auth system", description: "Complete auth with JWT" },
    };

    const content = buildClaudeMdContent(ctxWithGoal);

    assert.ok(content.includes("# Goal Context"));
    assert.ok(content.includes("Implement auth system"));
    assert.ok(content.includes("Complete auth with JWT"));
  });

  it("should not include goal section when no goal provided", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(!content.includes("# Goal Context"));
  });

  it("should include repository index for non-FIX tasks", () => {
    const ctxWithIndex = {
      ...baseContext,
      repositoryIndexSummary: "src/auth/ - Authentication module\nsrc/db/ - Database layer",
    };

    const content = buildClaudeMdContent(ctxWithIndex);

    assert.ok(content.includes("# Repository Index"));
    assert.ok(content.includes("Authentication module"));
  });

  it("should skip repository index for FIX tasks", () => {
    const ctxWithIndex = {
      ...baseContext,
      task: "Fix the crash in login handler",
      repositoryIndexSummary: "src/auth/ - Authentication module",
    };

    const content = buildClaudeMdContent(ctxWithIndex);

    assert.ok(!content.includes("# Repository Index"));
  });
});

describe("selectModelForTask", () => {
  const baseConfig: ClaudeCliExecutorConfig = {
    cliPath: "claude",
    model: "sonnet",
    fixModel: "haiku",
    maxTurns: 25,
    timeoutMs: 300_000,
    maxBudgetUsd: 5,
    maxTotalCostUsd: 10,
  };

  it("should return fixModel for FIX task type", () => {
    const model = selectModelForTask(baseConfig, "FIX");
    assert.equal(model, "haiku");
  });

  it("should return default model for IMPLEMENT task type", () => {
    const model = selectModelForTask(baseConfig, "IMPLEMENT");
    assert.equal(model, "sonnet");
  });

  it("should return fixModel for REFACTOR standard complexity", () => {
    const model = selectModelForTask(baseConfig, "REFACTOR");
    assert.equal(model, "haiku");
  });

  it("should return default model for REFACTOR complex complexity", () => {
    const model = selectModelForTask(baseConfig, "REFACTOR", { complexity: "complex" });
    assert.equal(model, "sonnet");
  });

  it("should return fixModel for corrections regardless of task type", () => {
    const model = selectModelForTask(baseConfig, "IMPLEMENT", { isCorrection: true });
    assert.equal(model, "haiku");
  });

  it("should return default model for CREATE task type", () => {
    const model = selectModelForTask(baseConfig, "CREATE");
    assert.equal(model, "sonnet");
  });
});

describe("extractCostUsd via parseClaudeCliOutput", () => {
  it("should extract total_cost_usd from Claude CLI output", () => {
    const raw = JSON.stringify({
      type: "result",
      result: "Done",
      total_cost_usd: 0.058846,
    });

    const parsed = parseClaudeCliOutput(raw);
    assert.equal(parsed.total_cost_usd, 0.058846);
  });

  it("should default cost to undefined when not present", () => {
    const raw = JSON.stringify({
      type: "result",
      result: "Done",
    });

    const parsed = parseClaudeCliOutput(raw);
    assert.equal(parsed.total_cost_usd, undefined);
  });
});

describe("parseClaudeCliOutput with NDJSON stream-json format", () => {
  it("should extract result from multi-line NDJSON stream", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "src/app.ts" } }] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/app.ts" } }] } }),
      JSON.stringify({ type: "result", subtype: "success", result: "Fixed the bug", session_id: "sess-1", total_cost_usd: 0.03, num_turns: 3 }),
    ];
    const raw = lines.join("\n");

    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.type, "result");
    assert.equal(parsed.result, "Fixed the bug");
    assert.equal(parsed.session_id, "sess-1");
    assert.equal(parsed.total_cost_usd, 0.03);
    assert.equal(parsed.num_turns, 3);
  });

  it("should skip non-result lines and find the last result", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "thinking..." }] } }),
      JSON.stringify({ type: "result", subtype: "success", result: "first result", session_id: "s1" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }),
      JSON.stringify({ type: "result", subtype: "success", result: "final result", session_id: "s2", total_cost_usd: 0.05 }),
    ];
    const raw = lines.join("\n");

    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.result, "final result");
    assert.equal(parsed.session_id, "s2");
  });

  it("should handle NDJSON with malformed lines gracefully", () => {
    const lines = [
      "not valid json at all",
      "{broken json",
      JSON.stringify({ type: "result", result: "recovered", session_id: "s3" }),
    ];
    const raw = lines.join("\n");

    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.type, "result");
    assert.equal(parsed.result, "recovered");
  });

  it("should fallback to single JSON parse when no result type line found", () => {
    const raw = JSON.stringify({ result: "legacy format", is_error: false });

    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.result, "legacy format");
    assert.equal(parsed.is_error, false);
  });

  it("should handle NDJSON with trailing newline", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [] } }),
      JSON.stringify({ type: "result", subtype: "success", result: "done", total_cost_usd: 0.01 }),
      "",
    ];
    const raw = lines.join("\n");

    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.type, "result");
    assert.equal(parsed.result, "done");
  });

  it("should handle stream-json error result", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "trying..." }] } }),
      JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "API rate limit exceeded" }),
    ];
    const raw = lines.join("\n");

    const parsed = parseClaudeCliOutput(raw);

    assert.equal(parsed.type, "result");
    assert.equal(parsed.is_error, true);
    assert.equal(parsed.result, "API rate limit exceeded");
  });
});

describe("buildClaudeMdContent with projectInstructions (Phase 1)", () => {
  const baseContext: ClaudeCliInstructionsContext = {
    task: "Implement user auth",
    expectedOutput: "Auth module",
    language: "typescript",
    framework: "nestjs",
    projectId: "test-project",
    baselineBuildFailed: false,
  };

  it("should include project instructions when provided", () => {
    const ctx = { ...baseContext, projectInstructions: "Always use Prisma ORM.\nUse snake_case for DB columns." };
    const content = buildClaudeMdContent(ctx);

    assert.ok(content.includes("# Project-Specific Standards"));
    assert.ok(content.includes("Always use Prisma ORM."));
    assert.ok(content.includes("Use snake_case for DB columns."));
  });

  it("should omit project instructions section when not provided", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(!content.includes("# Project-Specific Standards"));
  });

  it("should place project instructions before security rules", () => {
    const ctx = { ...baseContext, projectInstructions: "Custom rule here" };
    const content = buildClaudeMdContent(ctx);

    const projectIdx = content.indexOf("# Project-Specific Standards");
    const securityIdx = content.indexOf("# Security Rules");

    assert.ok(projectIdx > -1);
    assert.ok(securityIdx > -1);
    assert.ok(projectIdx < securityIdx);
  });
});

describe("classifyTaskComplexity (Phase 4)", () => {
  it("should classify short FIX tasks as simple", () => {
    assert.equal(classifyTaskComplexity("Fix the login bug", "FIX"), "simple");
  });

  it("should classify FIX tasks mentioning multiple files as standard", () => {
    assert.equal(classifyTaskComplexity("Fix the bug across multiple files in auth module", "FIX"), "standard");
  });

  it("should classify long FIX tasks as standard", () => {
    const longTask = "Fix the authentication bug that occurs when users try to log in with expired tokens and the refresh token mechanism fails to properly generate a new access token because the token rotation logic has a race condition in the middleware chain that prevents proper error handling";
    assert.equal(classifyTaskComplexity(longTask, "FIX"), "standard");
  });

  it("should classify CREATE tasks as complex", () => {
    assert.equal(classifyTaskComplexity("Create a user service", "CREATE"), "complex");
  });

  it("should classify tasks with 'from scratch' as complex", () => {
    assert.equal(classifyTaskComplexity("Build the payment system from scratch", "IMPLEMENT"), "complex");
  });

  it("should classify tasks with 'migration' as complex", () => {
    assert.equal(classifyTaskComplexity("Run the database migration for v2", "IMPLEMENT"), "complex");
  });

  it("should classify standard IMPLEMENT tasks as standard", () => {
    assert.equal(classifyTaskComplexity("Implement user authentication", "IMPLEMENT"), "standard");
  });

  it("should classify REFACTOR tasks as standard by default", () => {
    assert.equal(classifyTaskComplexity("Refactor the database layer", "REFACTOR"), "standard");
  });
});

describe("buildClaudeMdContent with complexity (Phase 4)", () => {
  const baseContext: ClaudeCliInstructionsContext = {
    task: "Implement user auth",
    expectedOutput: "Auth module",
    language: "typescript",
    framework: "nestjs",
    projectId: "test-project",
    baselineBuildFailed: false,
  };

  it("should include complexity hint for complex tasks", () => {
    const ctx = { ...baseContext, complexity: "complex" as const };
    const content = buildClaudeMdContent(ctx);

    assert.ok(content.includes("# Complexity: HIGH"));
    assert.ok(content.includes("Plan your approach before writing any code"));
  });

  it("should not include complexity hint for standard tasks", () => {
    const ctx = { ...baseContext, complexity: "standard" as const };
    const content = buildClaudeMdContent(ctx);

    assert.ok(!content.includes("# Complexity:"));
  });

  it("should omit architecture and dependency rules for simple tasks", () => {
    const ctx = { ...baseContext, complexity: "simple" as const };
    const content = buildClaudeMdContent(ctx);

    assert.ok(!content.includes("# Architecture Rules"));
    assert.ok(!content.includes("# Dependency Rules"));
  });

  it("should include architecture and dependency rules for standard tasks", () => {
    const ctx = { ...baseContext, complexity: "standard" as const };
    const content = buildClaudeMdContent(ctx);

    assert.ok(content.includes("# Architecture Rules"));
    assert.ok(content.includes("# Dependency Rules"));
  });
});

describe("writeReviewReport tabular format (Phase 3)", () => {
  it("should generate tabular review report with severity groups", async () => {
    const fsPromises = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const { writeReviewReport } = await import("./openclawArtifacts.js");
    const tmpDir = await fsPromises.default.mkdtemp(path.default.join(os.default.tmpdir(), "review-report-"));

    try {
      const review = {
        passed: false,
        criticalCount: 1,
        warningCount: 2,
        findings: [
          { severity: "CRITICAL" as const, rule: "no-secrets", file: "src/auth.ts", line: 45, message: "Possible API key detected" },
          { severity: "WARNING" as const, rule: "no-any-type", file: "src/utils.ts", line: 12, message: "Usage of any type" },
          { severity: "WARNING" as const, rule: "no-console-log", file: "src/service.ts", line: 5, message: "Use structured logger" },
          { severity: "INFO" as const, rule: "max-function-params", file: "src/utils.ts", line: 20, message: "Too many params" },
        ],
      };

      await writeReviewReport(tmpDir, review);

      const content = await fsPromises.default.readFile(path.default.join(tmpDir, ".axiom", "review.md"), "utf-8");

      assert.ok(content.includes("| Metric | Value |"));
      assert.ok(content.includes("| Result | FAILED |"));
      assert.ok(content.includes("| Critical | 1 |"));
      assert.ok(content.includes("| Warnings | 2 |"));
      assert.ok(content.includes("| Info | 1 |"));
      assert.ok(content.includes("## CRITICAL"));
      assert.ok(content.includes("## WARNING"));
      assert.ok(content.includes("## INFO"));
      assert.ok(content.includes("`no-secrets` at `src/auth.ts:45`"));
    } finally {
      await fsPromises.default.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("should generate passing report without findings", async () => {
    const fsPromises = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const { writeReviewReport } = await import("./openclawArtifacts.js");
    const tmpDir = await fsPromises.default.mkdtemp(path.default.join(os.default.tmpdir(), "review-report-pass-"));

    try {
      const review = { passed: true, criticalCount: 0, warningCount: 0, findings: [] };

      await writeReviewReport(tmpDir, review);

      const content = await fsPromises.default.readFile(path.default.join(tmpDir, ".axiom", "review.md"), "utf-8");

      assert.ok(content.includes("| Result | PASSED |"));
      assert.ok(content.includes("No issues found."));
    } finally {
      await fsPromises.default.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("writeImplementationReport (Phase 3)", () => {
  it("should generate implementation report with all fields", async () => {
    const fsPromises = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const { writeImplementationReport } = await import("./openclawArtifacts.js");
    const tmpDir = await fsPromises.default.mkdtemp(path.default.join(os.default.tmpdir(), "impl-report-"));

    try {
      await writeImplementationReport(tmpDir, {
        taskType: "IMPLEMENT",
        model: "sonnet",
        totalTokensUsed: 5000,
        totalCostUsd: 0.15,
        durationMs: 45000,
        filesChanged: ["src/auth.ts", "src/auth.test.ts"],
        validations: { install: "ok", lint: "ok", build: "ok", tests: "ok" },
        correctionCycles: 1,
        status: "SUCCESS",
      });

      const content = await fsPromises.default.readFile(path.default.join(tmpDir, ".axiom", "implementation.md"), "utf-8");

      assert.ok(content.includes("# Implementation Report"));
      assert.ok(content.includes("| Status | SUCCESS |"));
      assert.ok(content.includes("| Task Type | IMPLEMENT |"));
      assert.ok(content.includes("| Model | sonnet |"));
      assert.ok(content.includes("| Tokens Used | 5000 |"));
      assert.ok(content.includes("| Cost (USD) | $0.1500 |"));
      assert.ok(content.includes("| Duration | 45s |"));
      assert.ok(content.includes("| Files Changed | 2 |"));
      assert.ok(content.includes("| Correction Cycles | 1 |"));
      assert.ok(content.includes("## Files Changed"));
      assert.ok(content.includes("- src/auth.ts"));
      assert.ok(content.includes("- src/auth.test.ts"));
      assert.ok(content.includes("| Install | ok |"));
    } finally {
      await fsPromises.default.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("PHASE_TOOL_SETS and PHASE_MAX_TURNS (phased execution config)", () => {
  it("should define read-only tools for planning phase", () => {
    assert.equal(PHASE_TOOL_SETS.planning, "Read,Glob,Grep,Bash");
    assert.ok(!PHASE_TOOL_SETS.planning.includes("Write"));
    assert.ok(!PHASE_TOOL_SETS.planning.includes("Edit"));
  });

  it("should define full tools for implementation phase", () => {
    assert.ok(PHASE_TOOL_SETS.implementation.includes("Edit"));
    assert.ok(PHASE_TOOL_SETS.implementation.includes("Write"));
    assert.ok(PHASE_TOOL_SETS.implementation.includes("Read"));
    assert.ok(PHASE_TOOL_SETS.implementation.includes("Bash"));
  });

  it("should define full tools for testing phase", () => {
    assert.ok(PHASE_TOOL_SETS.testing.includes("Edit"));
    assert.ok(PHASE_TOOL_SETS.testing.includes("Write"));
  });

  it("should have lower max turns for planning than implementation", () => {
    assert.ok(PHASE_MAX_TURNS.planning < PHASE_MAX_TURNS.implementation);
  });

  it("should have lower max turns for correction than implementation", () => {
    assert.ok(PHASE_MAX_TURNS.correction <= PHASE_MAX_TURNS.implementation);
  });
});

describe("buildPlanningPrompt", () => {
  it("should include analysis instructions and read-only restriction", () => {
    const prompt = buildPlanningPrompt("Create a user service", "A working user CRUD");

    assert.ok(prompt.includes("ANALYZE the codebase"));
    assert.ok(prompt.includes("TECH LEAD"));
    assert.ok(prompt.includes("Do NOT modify any files"));
    assert.ok(prompt.includes("Create a user service"));
    assert.ok(prompt.includes("A working user CRUD"));
  });

  it("should include execution plan format template", () => {
    const prompt = buildPlanningPrompt("Build payment module", "");

    assert.ok(prompt.includes("Impact Analysis"));
    assert.ok(prompt.includes("Tasks (in order)"));
    assert.ok(prompt.includes("Verification Steps"));
  });
});

describe("buildImplementationPrompt", () => {
  it("should include task and expected output", () => {
    const prompt = buildImplementationPrompt("Fix the login bug", "Login works");

    assert.ok(prompt.includes("IMPLEMENT"));
    assert.ok(prompt.includes("Fix the login bug"));
    assert.ok(prompt.includes("Login works"));
  });

  it("should include execution plan when provided", () => {
    const plan = "TASK 1: Modify auth.ts\nTASK 2: Update tests";
    const prompt = buildImplementationPrompt("Implement auth", "Auth works", plan);

    assert.ok(prompt.includes("Execution Plan (from planning phase)"));
    assert.ok(prompt.includes("TASK 1: Modify auth.ts"));
    assert.ok(prompt.includes("TASK 2: Update tests"));
  });

  it("should not include plan section when no plan provided", () => {
    const prompt = buildImplementationPrompt("Fix bug", "Bug fixed");

    assert.ok(!prompt.includes("Execution Plan"));
  });
});

describe("buildTestingPrompt", () => {
  it("should list changed files and include testing instructions", () => {
    const prompt = buildTestingPrompt("Add user endpoint", ["src/user.ts", "src/user.controller.ts"]);

    assert.ok(prompt.includes("WRITE automated tests"));
    assert.ok(prompt.includes("- src/user.ts"));
    assert.ok(prompt.includes("- src/user.controller.ts"));
    assert.ok(prompt.includes("Add user endpoint"));
  });

  it("should include testing rules", () => {
    const prompt = buildTestingPrompt("Task", ["a.ts"]);

    assert.ok(prompt.includes("English"));
    assert.ok(prompt.includes("do NOT modify existing tests"));
  });
});

describe("buildClaudeMdContent with executionPhase (phased execution)", () => {
  const baseContext: ClaudeCliInstructionsContext = {
    task: "Create a payment module from scratch",
    expectedOutput: "Payment module with CRUD",
    language: "typescript",
    framework: "nestjs",
    projectId: "test-project",
    baselineBuildFailed: false,
  };

  it("should generate planning identity for planning phase", () => {
    const ctx = { ...baseContext, executionPhase: "planning" as const };
    const content = buildClaudeMdContent(ctx);

    assert.ok(content.includes("FORGE PLANNER"));
    assert.ok(content.includes("NEVER modify, create, or delete any files"));
    assert.ok(content.includes("NEVER use Write or Edit tools"));
    assert.ok(!content.includes("FORGE, an autonomous coding agent that IMPLEMENTS"));
  });

  it("should generate planning workflow for planning phase", () => {
    const ctx = { ...baseContext, executionPhase: "planning" as const };
    const content = buildClaudeMdContent(ctx);

    assert.ok(content.includes("Impact Analysis"));
    assert.ok(content.includes("Tasks (ordered by dependency)"));
    assert.ok(content.includes("Verification Steps"));
  });

  it("should generate testing identity for testing phase", () => {
    const ctx = { ...baseContext, executionPhase: "testing" as const };
    const content = buildClaudeMdContent(ctx);

    assert.ok(content.includes("FORGE TESTER"));
    assert.ok(content.includes("ONLY create or modify test files"));
    assert.ok(!content.includes("FORGE PLANNER"));
  });

  it("should generate testing workflow for testing phase", () => {
    const ctx = { ...baseContext, executionPhase: "testing" as const };
    const content = buildClaudeMdContent(ctx);

    assert.ok(content.includes("Test Priorities"));
    assert.ok(content.includes("Happy path"));
    assert.ok(content.includes("Edge cases"));
  });

  it("should generate standard implementation identity when no phase specified", () => {
    const content = buildClaudeMdContent(baseContext);

    assert.ok(content.includes("FORGE, an autonomous coding agent that IMPLEMENTS"));
    assert.ok(!content.includes("FORGE PLANNER"));
    assert.ok(!content.includes("FORGE TESTER"));
  });

  it("should generate standard implementation identity for implementation phase", () => {
    const ctx = { ...baseContext, executionPhase: "implementation" as const };
    const content = buildClaudeMdContent(ctx);

    assert.ok(content.includes("FORGE, an autonomous coding agent that IMPLEMENTS"));
  });

  it("should not include implementation sections in planning phase", () => {
    const ctx = { ...baseContext, executionPhase: "planning" as const };
    const content = buildClaudeMdContent(ctx);

    assert.ok(!content.includes("# Decision Protocol"));
    assert.ok(!content.includes("# Code Quality Rules"));
    assert.ok(!content.includes("# Frontend Rules"));
  });

  it("should include project instructions in all phases", () => {
    const ctx = { ...baseContext, executionPhase: "planning" as const, projectInstructions: "Custom rule here" };
    const content = buildClaudeMdContent(ctx);

    assert.ok(content.includes("# Project-Specific Standards"));
    assert.ok(content.includes("Custom rule here"));
  });
});

describe("manifest validation accepts claude-cli executor", () => {
  it("should accept forge_executor claude-cli", async () => {
    const { validateManifest } = await import("../../projects/manifest.schema.js");

    const result = validateManifest({
      project_id: "test-project",
      repo_source: "https://github.com/org/test",
      stack: { language: "typescript", framework: "nestjs" },
      risk_profile: "medium",
      autonomy_level: 2,
      token_budget_monthly: 100000,
      status: "active",
      forge_executor: "claude-cli",
    });

    assert.equal(result.forgeExecutor, "claude-cli");
  });
});
