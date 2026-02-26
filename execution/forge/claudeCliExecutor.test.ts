import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeCliOutput, buildForgeCodeOutputFromCli } from "./claudeCliExecutor.js";
import { buildClaudeMdContent } from "./claudeCliInstructions.js";
import type { ClaudeCliInstructionsContext } from "./claudeCliInstructions.js";
import type { ClaudeCliExecutionResult } from "./claudeCliExecutor.js";

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

  it("should cap risk at 3 when more than 3 files changed", () => {
    const result: ClaudeCliExecutionResult = {
      success: true,
      status: "SUCCESS",
      description: "Large refactor",
      filesChanged: ["a.ts", "b.ts", "c.ts", "d.ts"],
      totalTokensUsed: 3000,
      iterationsUsed: 1,
      validations: { install: "ok", lint: "ok", build: "ok", tests: "ok" },
      correctionCycles: 0,
    };

    const output = buildForgeCodeOutputFromCli(result);

    assert.equal(output.risk, 3);
    assert.equal(output.files.length, 4);
  });

  it("should set risk to 1 for single file change", () => {
    const result: ClaudeCliExecutionResult = {
      success: true,
      status: "SUCCESS",
      description: "Quick fix",
      filesChanged: ["src/fix.ts"],
      totalTokensUsed: 500,
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
