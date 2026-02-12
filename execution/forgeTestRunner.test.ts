import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { findRelatedTestFiles } from "./forgeTestRunner.js";

describe("findRelatedTestFiles", () => {
  let workspacePath: string;

  afterEach(async () => {
    if (workspacePath) {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("should find .test.ts file next to source file", async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "forge-test-"));
    const srcDir = path.join(workspacePath, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "utils.ts"), "export const x = 1;", "utf-8");
    await fs.writeFile(path.join(srcDir, "utils.test.ts"), "describe('utils', () => {});", "utf-8");

    const result = await findRelatedTestFiles(["src/utils.ts"], workspacePath);
    expect(result).toContain("src/utils.test.ts");
  });

  it("should find .spec.ts file next to source file", async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "forge-test-"));
    const srcDir = path.join(workspacePath, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "service.ts"), "export const x = 1;", "utf-8");
    await fs.writeFile(path.join(srcDir, "service.spec.ts"), "describe('service', () => {});", "utf-8");

    const result = await findRelatedTestFiles(["src/service.ts"], workspacePath);
    expect(result).toContain("src/service.spec.ts");
  });

  it("should find test file in __tests__ directory", async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "forge-test-"));
    const srcDir = path.join(workspacePath, "src");
    const testsDir = path.join(srcDir, "__tests__");
    await fs.mkdir(testsDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "component.tsx"), "export const x = 1;", "utf-8");
    await fs.writeFile(path.join(testsDir, "component.test.tsx"), "describe('component', () => {});", "utf-8");

    const result = await findRelatedTestFiles(["src/component.tsx"], workspacePath);
    const expectedPath = path.join("src", "__tests__", "component.test.tsx");
    expect(result).toContain(expectedPath);
  });

  it("should return empty array when no test files exist", async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "forge-test-"));
    const srcDir = path.join(workspacePath, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "orphan.ts"), "export const x = 1;", "utf-8");

    const result = await findRelatedTestFiles(["src/orphan.ts"], workspacePath);
    expect(result).toEqual([]);
  });

  it("should handle multiple changed files", async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "forge-test-"));
    const srcDir = path.join(workspacePath, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "a.ts"), "export const a = 1;", "utf-8");
    await fs.writeFile(path.join(srcDir, "a.test.ts"), "describe('a', () => {});", "utf-8");
    await fs.writeFile(path.join(srcDir, "b.ts"), "export const b = 1;", "utf-8");
    await fs.writeFile(path.join(srcDir, "b.spec.ts"), "describe('b', () => {});", "utf-8");

    const result = await findRelatedTestFiles(["src/a.ts", "src/b.ts"], workspacePath);
    expect(result).toContain("src/a.test.ts");
    expect(result).toContain("src/b.spec.ts");
  });
});
