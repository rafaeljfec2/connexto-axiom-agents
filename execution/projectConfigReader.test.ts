import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readProjectConfig, formatAliasesForPrompt } from "./projectConfigReader.js";
import type { ProjectConfig } from "./projectConfigReader.js";

describe("projectConfigReader", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-test-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("readProjectConfig", () => {
    it("should read tsconfig.json paths and package.json dependencies", async () => {
      fs.writeFileSync(
        path.join(testDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@/*": ["./src/*"],
              "@components/*": ["./src/components/*"],
            },
          },
        }),
        "utf-8",
      );

      fs.writeFileSync(
        path.join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
          devDependencies: { typescript: "^5.0.0" },
        }),
        "utf-8",
      );

      const config = await readProjectConfig(testDir);

      assert.equal(config.importAliases.size, 2);
      assert.equal(config.importAliases.get("@/"), "./src/");
      assert.equal(config.importAliases.get("@components/"), "./src/components/");
      assert.equal(config.baseUrl, ".");
      assert.ok(config.dependencies.includes("react"));
      assert.ok(config.dependencies.includes("typescript"));
    });

    it("should detect pnpm as package manager", async () => {
      fs.writeFileSync(path.join(testDir, "pnpm-lock.yaml"), "lockfileVersion: 7", "utf-8");
      fs.writeFileSync(path.join(testDir, "package.json"), "{}", "utf-8");

      const config = await readProjectConfig(testDir);
      assert.equal(config.packageManager, "pnpm");
    });

    it("should detect yarn as package manager", async () => {
      fs.writeFileSync(path.join(testDir, "yarn.lock"), "# yarn lock", "utf-8");
      fs.writeFileSync(path.join(testDir, "package.json"), "{}", "utf-8");

      const config = await readProjectConfig(testDir);
      assert.equal(config.packageManager, "yarn");
    });

    it("should default to npm", async () => {
      fs.writeFileSync(path.join(testDir, "package.json"), "{}", "utf-8");

      const config = await readProjectConfig(testDir);
      assert.equal(config.packageManager, "npm");
    });

    it("should handle missing tsconfig.json gracefully", async () => {
      fs.writeFileSync(path.join(testDir, "package.json"), JSON.stringify({ dependencies: { express: "^4.0.0" } }), "utf-8");

      const config = await readProjectConfig(testDir);
      assert.equal(config.importAliases.size, 0);
      assert.equal(config.baseUrl, null);
      assert.ok(config.dependencies.includes("express"));
    });

    it("should handle missing package.json gracefully", async () => {
      const config = await readProjectConfig(testDir);
      assert.equal(config.dependencies.length, 0);
    });

    it("should handle tsconfig with comments", async () => {
      fs.writeFileSync(
        path.join(testDir, "tsconfig.json"),
        `{
          // This is a comment
          "compilerOptions": {
            /* block comment */
            "paths": { "@/*": ["./src/*"] }
          }
        }`,
        "utf-8",
      );
      fs.writeFileSync(path.join(testDir, "package.json"), "{}", "utf-8");

      const config = await readProjectConfig(testDir);
      assert.equal(config.importAliases.size, 1);
      assert.equal(config.importAliases.get("@/"), "./src/");
    });

    it("should try tsconfig.app.json if tsconfig.json has no paths", async () => {
      fs.writeFileSync(
        path.join(testDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true } }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(testDir, "tsconfig.app.json"),
        JSON.stringify({
          compilerOptions: {
            paths: { "@lib/*": ["./lib/*"] },
          },
        }),
        "utf-8",
      );
      fs.writeFileSync(path.join(testDir, "package.json"), "{}", "utf-8");

      const config = await readProjectConfig(testDir);
      assert.equal(config.importAliases.size, 1);
      assert.equal(config.importAliases.get("@lib/"), "./lib/");
    });
  });

  describe("formatAliasesForPrompt", () => {
    it("should format aliases for prompt injection", () => {
      const config: ProjectConfig = {
        importAliases: new Map([["@/", "./src/"], ["@ui/", "./src/ui/"]]),
        baseUrl: ".",
        packageManager: "pnpm",
        dependencies: ["react"],
      };

      const result = formatAliasesForPrompt(config);
      assert.ok(result.includes("@/"));
      assert.ok(result.includes("./src/"));
      assert.ok(result.includes("baseUrl: ."));
      assert.ok(result.includes("IMPORT ALIASES"));
    });

    it("should return empty string when no aliases", () => {
      const config: ProjectConfig = {
        importAliases: new Map(),
        baseUrl: null,
        packageManager: "npm",
        dependencies: [],
      };

      const result = formatAliasesForPrompt(config);
      assert.equal(result, "");
    });
  });
});
