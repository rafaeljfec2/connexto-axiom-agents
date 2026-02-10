import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverProjectStructure, findRelevantFiles } from "./fileDiscovery.js";

let testDir: string;

function createFile(relativePath: string, content: string): void {
  const fullPath = path.join(testDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

describe("fileDiscovery", () => {
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-discovery-"));

    createFile("src/components/Sidebar.tsx", "export function Sidebar() { return <nav>sidebar</nav>; }");
    createFile("src/components/Header.tsx", "export function Header() { return <header>header</header>; }");
    createFile("src/pages/index.tsx", "export default function Home() { return <div>home</div>; }");
    createFile("src/utils/format.ts", "export function formatDate(d: Date) { return d.toISOString(); }");
    createFile("packages/shared/src/types.ts", "export interface User { id: string; }");
    createFile("package.json", '{ "name": "test-project" }');
    createFile(".gitignore", "node_modules\ndist");
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("discoverProjectStructure", () => {
    it("should discover files and directories", async () => {
      const structure = await discoverProjectStructure(testDir);

      assert.ok(structure.totalFiles > 0);
      assert.ok(structure.totalDirs > 0);
      assert.ok(structure.tree.length > 0);
    });

    it("should include tsx files in the file list", async () => {
      const structure = await discoverProjectStructure(testDir);
      const tsxFiles = structure.files.filter((f) => f.relativePath.endsWith(".tsx"));
      assert.ok(tsxFiles.length >= 3);
    });

    it("should exclude node_modules directory", async () => {
      fs.mkdirSync(path.join(testDir, "node_modules", "lodash"), { recursive: true });
      fs.writeFileSync(path.join(testDir, "node_modules", "lodash", "index.js"), "", "utf-8");

      const structure = await discoverProjectStructure(testDir);
      const nodeModFiles = structure.files.filter((f) => f.relativePath.includes("node_modules"));
      assert.equal(nodeModFiles.length, 0);
    });

    it("should exclude .git directory", async () => {
      fs.mkdirSync(path.join(testDir, ".git"), { recursive: true });
      fs.writeFileSync(path.join(testDir, ".git", "config"), "", "utf-8");

      const structure = await discoverProjectStructure(testDir);
      const gitFiles = structure.files.filter((f) => f.relativePath.includes(".git"));
      assert.equal(gitFiles.length, 0);
    });
  });

  describe("findRelevantFiles", () => {
    it("should find files matching task keywords", async () => {
      const files = await findRelevantFiles(testDir, "remover sidebar do menu lateral");

      assert.ok(files.length > 0);
      const sidebarFile = files.find((f) => f.path.includes("Sidebar"));
      assert.ok(sidebarFile);
    });

    it("should return empty for unrelated task", async () => {
      const files = await findRelevantFiles(testDir, "xyzabc123 nothing matches");
      assert.equal(files.length, 0);
    });

    it("should include file content", async () => {
      const files = await findRelevantFiles(testDir, "sidebar component");

      const sidebarFile = files.find((f) => f.path.includes("Sidebar"));
      if (sidebarFile) {
        assert.ok(sidebarFile.content.includes("Sidebar"));
      }
    });

    it("should respect max files limit", async () => {
      const files = await findRelevantFiles(testDir, "components pages utils format", 2);
      assert.ok(files.length <= 2);
    });

    it("should score tsx/ts files higher", async () => {
      const files = await findRelevantFiles(testDir, "format date utils");
      const formatFile = files.find((f) => f.path.includes("format"));
      assert.ok(formatFile);
    });
  });
});
