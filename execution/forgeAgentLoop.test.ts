import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parsePlanningOutput, parseCodeOutput } from "./forgeOutputParser.js";
import { loadForgeAgentConfig } from "./forgeTypes.js";
import { readModifiedFilesState } from "./forgeWorkspaceOps.js";

describe("forgeAgentLoop", () => {
  describe("parsePlanningOutput", () => {
    it("should parse valid planning JSON", () => {
      const input = JSON.stringify({
        plan: "Remove signatarios from sidebar navigation",
        files_to_read: ["src/components/Sidebar.tsx", "src/routes.ts"],
        files_to_modify: ["src/components/Sidebar.tsx"],
        files_to_create: [],
        approach: "Find the navigation items array and remove the signatarios entry",
        estimated_risk: 2,
        dependencies: ["Check if there are associated routes"],
      });

      const result = parsePlanningOutput(input);

      assert.ok(result);
      assert.equal(result.plan, "Remove signatarios from sidebar navigation");
      assert.deepEqual(result.filesToRead, ["src/components/Sidebar.tsx", "src/routes.ts"]);
      assert.deepEqual(result.filesToModify, ["src/components/Sidebar.tsx"]);
      assert.deepEqual(result.filesToCreate, []);
      assert.equal(result.approach, "Find the navigation items array and remove the signatarios entry");
      assert.equal(result.estimatedRisk, 2);
      assert.deepEqual(result.dependencies, ["Check if there are associated routes"]);
    });

    it("should parse JSON with surrounding text", () => {
      const input = `Here is my plan:\n${JSON.stringify({
        plan: "Add utility function",
        files_to_read: ["src/utils/index.ts"],
        files_to_modify: ["src/utils/index.ts"],
        files_to_create: [],
        approach: "Add formatCurrency function",
        estimated_risk: 1,
        dependencies: [],
      })}\nEnd of plan.`;

      const result = parsePlanningOutput(input);

      assert.ok(result);
      assert.equal(result.plan, "Add utility function");
    });

    it("should return null for empty string", () => {
      const result = parsePlanningOutput("");
      assert.equal(result, null);
    });

    it("should return null for missing plan field", () => {
      const result = parsePlanningOutput(JSON.stringify({
        files_to_read: ["src/index.ts"],
      }));
      assert.equal(result, null);
    });

    it("should return null when no files are specified", () => {
      const result = parsePlanningOutput(JSON.stringify({
        plan: "Do something",
        files_to_read: [],
        files_to_modify: [],
        files_to_create: [],
      }));
      assert.equal(result, null);
    });

    it("should clamp estimated_risk between 1 and 5", () => {
      const lowRisk = parsePlanningOutput(JSON.stringify({
        plan: "Low risk change",
        files_to_read: ["src/a.ts"],
        files_to_modify: [],
        files_to_create: [],
        approach: "Simple edit",
        estimated_risk: -1,
        dependencies: [],
      }));

      assert.ok(lowRisk);
      assert.equal(lowRisk.estimatedRisk, 1);

      const highRisk = parsePlanningOutput(JSON.stringify({
        plan: "High risk change",
        files_to_read: ["src/b.ts"],
        files_to_modify: [],
        files_to_create: [],
        approach: "Complex edit",
        estimated_risk: 10,
        dependencies: [],
      }));

      assert.ok(highRisk);
      assert.equal(highRisk.estimatedRisk, 5);
    });

    it("should default estimated_risk to 2 when not a number", () => {
      const result = parsePlanningOutput(JSON.stringify({
        plan: "No risk specified",
        files_to_read: ["src/a.ts"],
        files_to_modify: [],
        files_to_create: [],
        approach: "Edit",
      }));

      assert.ok(result);
      assert.equal(result.estimatedRisk, 2);
    });

    it("should truncate long plan to 200 chars", () => {
      const longPlan = "x".repeat(300);
      const result = parsePlanningOutput(JSON.stringify({
        plan: longPlan,
        files_to_read: ["src/a.ts"],
        files_to_modify: [],
        files_to_create: [],
        approach: "Edit",
        estimated_risk: 1,
        dependencies: [],
      }));

      assert.ok(result);
      assert.equal(result.plan.length, 200);
    });

    it("should return null for invalid JSON", () => {
      const result = parsePlanningOutput("not json at all {{{");
      assert.equal(result, null);
    });
  });

  describe("parseCodeOutput", () => {
    it("should parse valid code output with modify action", () => {
      const input = JSON.stringify({
        description: "Remove signatarios from sidebar",
        risk: 2,
        rollback: "Re-add the signatarios entry",
        files: [
          {
            path: "src/components/Sidebar.tsx",
            action: "modify",
            edits: [
              {
                search: "{ label: 'Signatarios', path: '/signatarios' },",
                replace: "",
              },
            ],
          },
        ],
      });

      const result = parseCodeOutput(input);

      assert.ok(result);
      assert.equal(result.description, "Remove signatarios from sidebar");
      assert.equal(result.risk, 2);
      assert.equal(result.rollback, "Re-add the signatarios entry");
      assert.equal(result.files.length, 1);
      assert.equal(result.files[0].path, "src/components/Sidebar.tsx");
      assert.equal(result.files[0].action, "modify");
      assert.ok(result.files[0].edits);
      assert.equal(result.files[0].edits?.length, 1);
    });

    it("should parse code output with create action", () => {
      const input = JSON.stringify({
        description: "Create helper utility",
        risk: 1,
        rollback: "Delete the file",
        files: [
          {
            path: "src/utils/helper.ts",
            action: "create",
            content: "export function helper() { return 42; }",
          },
        ],
      });

      const result = parseCodeOutput(input);

      assert.ok(result);
      assert.equal(result.files.length, 1);
      assert.equal(result.files[0].action, "create");
      assert.equal(result.files[0].content, "export function helper() { return 42; }");
    });

    it("should parse code output with mixed actions", () => {
      const input = JSON.stringify({
        description: "Refactor sidebar and create test",
        risk: 3,
        rollback: "Revert changes",
        files: [
          {
            path: "src/components/Sidebar.tsx",
            action: "modify",
            edits: [{ search: "old code", replace: "new code" }],
          },
          {
            path: "tests/Sidebar.test.tsx",
            action: "create",
            content: "test content",
          },
        ],
      });

      const result = parseCodeOutput(input);

      assert.ok(result);
      assert.equal(result.files.length, 2);
      assert.equal(result.files[0].action, "modify");
      assert.equal(result.files[1].action, "create");
    });

    it("should return null for missing description", () => {
      const result = parseCodeOutput(JSON.stringify({
        risk: 1,
        files: [{ path: "a.ts", action: "create", content: "x" }],
      }));
      assert.equal(result, null);
    });

    it("should return null for invalid risk", () => {
      const result = parseCodeOutput(JSON.stringify({
        description: "Change",
        risk: 0,
        files: [{ path: "a.ts", action: "create", content: "x" }],
      }));
      assert.equal(result, null);

      const result2 = parseCodeOutput(JSON.stringify({
        description: "Change",
        risk: 6,
        files: [{ path: "a.ts", action: "create", content: "x" }],
      }));
      assert.equal(result2, null);
    });

    it("should return output with empty files when task already done", () => {
      const result = parseCodeOutput(JSON.stringify({
        description: "Change",
        risk: 1,
        files: [],
      }));
      assert.ok(result);
      assert.equal(result.files.length, 0);
      assert.equal(result.description, "Change");
    });

    it("should return null for invalid file action", () => {
      const result = parseCodeOutput(JSON.stringify({
        description: "Change",
        risk: 1,
        files: [{ path: "a.ts", action: "delete" }],
      }));
      assert.equal(result, null);
    });

    it("should return null for modify with empty search string", () => {
      const result = parseCodeOutput(JSON.stringify({
        description: "Change",
        risk: 1,
        files: [
          {
            path: "a.ts",
            action: "modify",
            edits: [{ search: "", replace: "new" }],
          },
        ],
      }));
      assert.equal(result, null);
    });

    it("should handle modify with content fallback when no edits", () => {
      const result = parseCodeOutput(JSON.stringify({
        description: "Full file replace",
        risk: 2,
        files: [
          {
            path: "a.ts",
            action: "modify",
            content: "full file content",
          },
        ],
      }));
      assert.ok(result);
      assert.equal(result.files[0].content, "full file content");
    });

    it("should truncate long descriptions to 200 chars", () => {
      const longDesc = "d".repeat(400);
      const result = parseCodeOutput(JSON.stringify({
        description: longDesc,
        risk: 1,
        files: [{ path: "a.ts", action: "create", content: "x" }],
      }));
      assert.ok(result);
      assert.equal(result.description.length, 200);
    });

    it("should extract JSON from text with markdown fences", () => {
      const input = "```json\n" + JSON.stringify({
        description: "Wrapped in markdown",
        risk: 1,
        rollback: "",
        files: [{ path: "a.ts", action: "create", content: "x" }],
      }) + "\n```";

      const result = parseCodeOutput(input);
      assert.ok(result);
      assert.equal(result.description, "Wrapped in markdown");
    });

    it("should return null for completely invalid input", () => {
      assert.equal(parseCodeOutput(""), null);
      assert.equal(parseCodeOutput("no json here"), null);
      assert.equal(parseCodeOutput("[]"), null);
    });
  });

  describe("loadForgeAgentConfig", () => {
    it("should return values from agents/forge/config.ts", () => {
      const config = loadForgeAgentConfig();
      assert.equal(typeof config.maxCorrectionRounds, "number");
      assert.equal(typeof config.contextMaxChars, "number");
      assert.equal(typeof config.runBuild, "boolean");
      assert.equal(typeof config.buildTimeout, "number");
      assert.ok(config.maxCorrectionRounds >= 0);
      assert.ok(config.contextMaxChars > 0);
      assert.ok(config.buildTimeout > 0);
    });

    it("should return expected default config values", () => {
      const config = loadForgeAgentConfig();
      assert.equal(config.maxCorrectionRounds, 4);
      assert.equal(config.contextMaxChars, 20_000);
      assert.equal(config.runBuild, true);
      assert.equal(config.buildTimeout, 120_000);
    });
  });

  describe("readModifiedFilesState", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-agent-loop-"));
    });

    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("should read existing files", async () => {
      const filePath = path.join(testDir, "src", "example.ts");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "export const x = 42;", "utf-8");

      const result = await readModifiedFilesState(["src/example.ts"], testDir);

      assert.equal(result.length, 1);
      assert.equal(result[0].path, "src/example.ts");
      assert.equal(result[0].content, "export const x = 42;");
    });

    it("should skip files that do not exist", async () => {
      const result = await readModifiedFilesState(
        ["src/missing.ts", "src/also-missing.ts"],
        testDir,
      );

      assert.equal(result.length, 0);
    });

    it("should read multiple files", async () => {
      const dir = path.join(testDir, "src");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "a.ts"), "const a = 1;", "utf-8");
      fs.writeFileSync(path.join(dir, "b.ts"), "const b = 2;", "utf-8");

      const result = await readModifiedFilesState(
        ["src/a.ts", "src/b.ts"],
        testDir,
      );

      assert.equal(result.length, 2);
      assert.equal(result[0].content, "const a = 1;");
      assert.equal(result[1].content, "const b = 2;");
    });

    it("should handle empty file paths array", async () => {
      const result = await readModifiedFilesState([], testDir);
      assert.equal(result.length, 0);
    });

    it("should handle mix of existing and missing files", async () => {
      const dir = path.join(testDir, "src");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "exists.ts"), "code", "utf-8");

      const result = await readModifiedFilesState(
        ["src/exists.ts", "src/missing.ts"],
        testDir,
      );

      assert.equal(result.length, 1);
      assert.equal(result[0].path, "src/exists.ts");
    });
  });
});
