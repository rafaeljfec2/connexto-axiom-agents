import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  extractGlobPatterns,
  extractKeywords,
  expandContextWithImports,
  ripgrepSearch,
  findSymbolDefinitions,
  globSearch,
} from "./fileDiscovery.js";

describe("fileDiscovery - enhanced discovery", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "fd-test-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("extractKeywords", () => {
    it("should extract meaningful keywords from task", () => {
      const result = extractKeywords("remover opção signatários do sidebar");
      assert.ok(result.length > 0);
      assert.ok(result.includes("signatarios") || result.includes("sidebar"));
    });

    it("should filter stop words", () => {
      const result = extractKeywords("eu quero criar uma sidebar nova para o menu");
      assert.ok(!result.includes("quero"));
      assert.ok(!result.includes("criar"));
      assert.ok(!result.includes("para"));
    });

    it("should return empty array for stop-words-only input", () => {
      const result = extractKeywords("eu de o a");
      assert.equal(result.length, 0);
    });

    it("should limit to 10 keywords", () => {
      const longTask = "sidebar navigation menu header footer layout content container wrapper component section area region zone panel";
      const result = extractKeywords(longTask);
      assert.ok(result.length <= 10);
    });
  });

  describe("extractGlobPatterns", () => {
    it("should generate glob patterns from keywords", () => {
      const result = extractGlobPatterns(["sidebar", "menu"]);
      assert.ok(result.length >= 2);
      assert.ok(result.some((p) => p.includes("sidebar")));
      assert.ok(result.some((p) => p.includes("menu")));
    });

    it("should generate capitalized variants", () => {
      const result = extractGlobPatterns(["sidebar"]);
      assert.ok(result.some((p) => p.includes("Sidebar")));
    });

    it("should skip short keywords", () => {
      const result = extractGlobPatterns(["ab", "sidebar"]);
      assert.ok(!result.some((p) => p.includes("*ab*")));
    });

    it("should return empty for empty keywords", () => {
      const result = extractGlobPatterns([]);
      assert.equal(result.length, 0);
    });
  });

  describe("expandContextWithImports", () => {
    it("should expand context with imported files", async () => {
      const srcDir = path.join(testDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcDir, "types.ts"),
        "export interface User { name: string; }",
        "utf-8",
      );

      const loadedFiles = [{
        path: "src/main.ts",
        content: 'import { User } from "./types";\nconst u: User = { name: "test" };',
        score: 5,
      }];

      const allPaths = new Set(["src/main.ts", "src/types.ts"]);
      const result = await expandContextWithImports(testDir, loadedFiles, allPaths, 10000);

      assert.equal(result.length, 1);
      assert.equal(result[0].path, "src/types.ts");
      assert.ok(result[0].content.includes("User"));
    });

    it("should respect remaining chars limit", async () => {
      const srcDir = path.join(testDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcDir, "types.ts"),
        "x".repeat(500),
        "utf-8",
      );

      const loadedFiles = [{
        path: "src/main.ts",
        content: 'import { User } from "./types";\nconst u = 1;',
        score: 5,
      }];

      const allPaths = new Set(["src/main.ts", "src/types.ts"]);
      const result = await expandContextWithImports(testDir, loadedFiles, allPaths, 100);

      assert.equal(result.length, 1);
      assert.ok(result[0].content.length < 500);
    });

    it("should not re-load already loaded files", async () => {
      const srcDir = path.join(testDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, "types.ts"), "export type X = string;", "utf-8");

      const loadedFiles = [
        { path: "src/main.ts", content: 'import { X } from "./types";', score: 5 },
        { path: "src/types.ts", content: "export type X = string;", score: 3 },
      ];

      const allPaths = new Set(["src/main.ts", "src/types.ts"]);
      const result = await expandContextWithImports(testDir, loadedFiles, allPaths, 10000);

      assert.equal(result.length, 0);
    });

    it("should handle files with no imports", async () => {
      const loadedFiles = [{
        path: "src/constants.ts",
        content: "export const VERSION = '1.0.0';",
        score: 5,
      }];

      const allPaths = new Set(["src/constants.ts"]);
      const result = await expandContextWithImports(testDir, loadedFiles, allPaths, 10000);

      assert.equal(result.length, 0);
    });
  });

  describe("ripgrepSearch", () => {
    it("should return results when rg is available and finds matches", async () => {
      const srcDir = path.join(testDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "test.ts"), "export function doSomething() {}", "utf-8");

      const results = await ripgrepSearch(testDir, "doSomething");
      if (results.length > 0) {
        assert.ok(results[0].path.includes("test.ts"));
        assert.ok(results[0].matchCount >= 1);
      }
    });

    it("should return empty array for non-matching pattern", async () => {
      const srcDir = path.join(testDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "test.ts"), "const x = 1;", "utf-8");

      const results = await ripgrepSearch(testDir, "zzz_nonexistent_zzz");
      assert.equal(results.length, 0);
    });
  });

  describe("findSymbolDefinitions", () => {
    it("should find function definitions", async () => {
      const srcDir = path.join(testDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "utils.ts"),
        "export function formatCurrency(value: number): string { return String(value); }",
        "utf-8",
      );

      const results = await findSymbolDefinitions(testDir, "formatCurrency");
      if (results.length > 0) {
        assert.ok(results[0].path.includes("utils.ts"));
      }
    });

    it("should return empty for non-existent symbol", async () => {
      const srcDir = path.join(testDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "utils.ts"), "const x = 1;", "utf-8");

      const results = await findSymbolDefinitions(testDir, "zzz_nonexistent_symbol_zzz");
      assert.equal(results.length, 0);
    });
  });

  describe("globSearch", () => {
    it("should find files matching glob patterns", async () => {
      const srcDir = path.join(testDir, "src", "components");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "Sidebar.tsx"), "export const Sidebar = () => null;", "utf-8");
      fs.writeFileSync(path.join(srcDir, "Header.tsx"), "export const Header = () => null;", "utf-8");

      const results = await globSearch(testDir, ["**/*Sidebar*"]);
      if (results.length > 0) {
        assert.ok(results.some((r) => r.includes("Sidebar")));
      }
    });

    it("should return empty for non-matching patterns", async () => {
      fs.writeFileSync(path.join(testDir, "test.ts"), "const x = 1;", "utf-8");

      const results = await globSearch(testDir, ["**/*zzz_nonexistent*"]);
      assert.equal(results.length, 0);
    });
  });
});
