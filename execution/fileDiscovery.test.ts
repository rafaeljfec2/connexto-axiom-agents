import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  discoverProjectStructure,
  findRelevantFiles,
  grepFilesForKeywords,
  followImports,
  findReverseImports,
} from "./fileDiscovery.js";

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

  describe("grepFilesForKeywords", () => {
    it("should find files containing keyword in content", async () => {
      createFile("src/layouts/app-shell.tsx", [
        "import { Sidebar } from '../components/Sidebar';",
        "const menuItems = [",
        "  { label: 'Home', icon: HomeIcon },",
        "  { label: 'Signers', icon: UsersIcon },",
        "  { label: 'Documents', icon: FileIcon },",
        "];",
        "export function AppShell() { return <Sidebar items={menuItems} />; }",
      ].join("\n"));

      const structure = await discoverProjectStructure(testDir);
      const alreadyScored = new Set<string>();
      const results = await grepFilesForKeywords(testDir, structure.files, ["signers"], alreadyScored);

      assert.ok(results.length > 0);
      const shellFile = results.find((r) => r.file.relativePath.includes("app-shell"));
      assert.ok(shellFile);
    });

    it("should not re-score already scored files", async () => {
      const structure = await discoverProjectStructure(testDir);
      const alreadyScored = new Set(structure.files.map((f) => f.relativePath));
      const results = await grepFilesForKeywords(testDir, structure.files, ["sidebar"], alreadyScored);

      assert.equal(results.length, 0);
    });

    it("should return empty when no keywords match content", async () => {
      const structure = await discoverProjectStructure(testDir);
      const results = await grepFilesForKeywords(testDir, structure.files, ["xyznonexistent"], new Set());

      assert.equal(results.length, 0);
    });

    it("should only scan greppable files", async () => {
      createFile("config/settings.yaml", "sidebar: true");
      const structure = await discoverProjectStructure(testDir);
      const results = await grepFilesForKeywords(testDir, structure.files, ["sidebar"], new Set());

      const yamlFile = results.find((r) => r.file.relativePath.includes("settings.yaml"));
      assert.equal(yamlFile, undefined);
    });
  });

  describe("followImports", () => {
    it("should resolve relative imports from found files", async () => {
      createFile("src/components/Sidebar.tsx", [
        "import { Badge } from './Badge';",
        "import { formatName } from '../utils/format';",
        "export function Sidebar() { return <nav><Badge /></nav>; }",
      ].join("\n"));
      createFile("src/components/Badge.tsx", "export function Badge() { return <span>badge</span>; }");

      const structure = await discoverProjectStructure(testDir);
      const allFilePaths = new Set(structure.files.map((f) => f.relativePath));
      const allFilesMap = new Map(structure.files.map((f) => [f.relativePath, f]));

      const sidebarFile = structure.files.find((f) => f.relativePath.includes("Sidebar"));
      assert.ok(sidebarFile);

      const scored = [{ file: sidebarFile, score: 9 }];
      const alreadyScored = new Set([sidebarFile.relativePath]);

      const imported = await followImports(testDir, scored, allFilePaths, alreadyScored, allFilesMap);

      assert.ok(imported.length > 0);
      const badgeFile = imported.find((f) => f.file.relativePath.includes("Badge"));
      assert.ok(badgeFile);
    });

    it("should not follow non-relative imports", async () => {
      createFile("src/components/Sidebar.tsx", [
        "import React from 'react';",
        "import lodash from 'lodash';",
        "export function Sidebar() { return <nav>sidebar</nav>; }",
      ].join("\n"));

      const structure = await discoverProjectStructure(testDir);
      const allFilePaths = new Set(structure.files.map((f) => f.relativePath));
      const allFilesMap = new Map(structure.files.map((f) => [f.relativePath, f]));

      const sidebarFile = structure.files.find((f) => f.relativePath.includes("Sidebar"));
      assert.ok(sidebarFile);

      const scored = [{ file: sidebarFile, score: 9 }];
      const imported = await followImports(testDir, scored, allFilePaths, new Set([sidebarFile.relativePath]), allFilesMap);

      assert.equal(imported.length, 0);
    });

    it("should resolve index files", async () => {
      createFile("src/shared/index.ts", "export { Button } from './Button';");
      createFile("src/shared/Button.tsx", "export function Button() {}");
      createFile("src/components/Form.tsx", "import { Button } from '../shared';");

      const structure = await discoverProjectStructure(testDir);
      const allFilePaths = new Set(structure.files.map((f) => f.relativePath));
      const allFilesMap = new Map(structure.files.map((f) => [f.relativePath, f]));

      const formFile = structure.files.find((f) => f.relativePath.includes("Form"));
      assert.ok(formFile);

      const scored = [{ file: formFile, score: 5 }];
      const imported = await followImports(testDir, scored, allFilePaths, new Set([formFile.relativePath]), allFilesMap);

      const indexFile = imported.find((f) => f.file.relativePath.includes("shared/index"));
      assert.ok(indexFile);
    });
  });

  describe("findReverseImports", () => {
    it("should find files that import a target file", async () => {
      createFile("src/components/Sidebar.tsx", "export function Sidebar() { return <nav>sidebar</nav>; }");
      createFile("src/layouts/app-shell.tsx", [
        "import { Sidebar } from '../components/Sidebar';",
        "export function AppShell() { return <Sidebar />; }",
      ].join("\n"));

      const structure = await discoverProjectStructure(testDir);
      const sidebarFile = structure.files.find((f) => f.relativePath.includes("Sidebar"));
      assert.ok(sidebarFile);

      const targets = [{ file: sidebarFile, score: 9 }];
      const alreadyScored = new Set([sidebarFile.relativePath]);

      const reverse = await findReverseImports(testDir, structure.files, targets, alreadyScored);

      assert.ok(reverse.length > 0);
      const shellFile = reverse.find((r) => r.file.relativePath.includes("app-shell"));
      assert.ok(shellFile);
    });

    it("should not return already scored files", async () => {
      createFile("src/layouts/app-shell.tsx", [
        "import { Sidebar } from '../components/Sidebar';",
        "export function AppShell() { return <Sidebar />; }",
      ].join("\n"));

      const structure = await discoverProjectStructure(testDir);
      const sidebarFile = structure.files.find((f) => f.relativePath.includes("Sidebar"));
      assert.ok(sidebarFile);
      const shellFile = structure.files.find((f) => f.relativePath.includes("app-shell"));
      assert.ok(shellFile);

      const targets = [{ file: sidebarFile, score: 9 }];
      const alreadyScored = new Set([sidebarFile.relativePath, shellFile.relativePath]);

      const reverse = await findReverseImports(testDir, structure.files, targets, alreadyScored);
      assert.equal(reverse.length, 0);
    });

    it("should return empty when no reverse imports exist", async () => {
      const structure = await discoverProjectStructure(testDir);
      const formatFile = structure.files.find((f) => f.relativePath.includes("format"));
      assert.ok(formatFile);

      const targets = [{ file: formatFile, score: 5 }];
      const reverse = await findReverseImports(testDir, structure.files, targets, new Set([formatFile.relativePath]));

      const importers = reverse.filter((r) => r.file.relativePath !== formatFile.relativePath);
      assert.equal(importers.length, 0);
    });
  });
});
