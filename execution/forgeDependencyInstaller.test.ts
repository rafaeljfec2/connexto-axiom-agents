import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { detectMissingImports, detectPackageManager } from "./forgeDependencyInstaller.js";
import type { StructuredError } from "./forgeErrorParser.js";

const structuredError = (
  overrides: Partial<StructuredError> & { message: string; code: string },
): StructuredError => ({
  file: "src/index.ts",
  line: 1,
  column: 1,
  severity: "error",
  source: "tsc",
  ...overrides,
});

describe("detectMissingImports", () => {
  it("should extract package names from TS2307 errors with message \"Cannot find module 'some-package'\"", () => {
    const errors: StructuredError[] = [
      structuredError({
        code: "TS2307",
        message: "Cannot find module 'some-package'",
      }),
    ];
    const result = detectMissingImports(errors);
    expect(result).toEqual(["some-package"]);
  });

  it("should handle scoped packages like @scope/package", () => {
    const errors: StructuredError[] = [
      structuredError({
        code: "TS2307",
        message: "Cannot find module '@scope/package'",
      }),
    ];
    const result = detectMissingImports(errors);
    expect(result).toEqual(["@scope/package"]);
  });

  it("should ignore relative imports (starting with . or /)", () => {
    const errors: StructuredError[] = [
      structuredError({
        code: "TS2307",
        message: "Cannot find module './utils'",
      }),
      structuredError({
        code: "TS2307",
        message: "Cannot find module '../helpers'",
      }),
      structuredError({
        code: "TS2307",
        message: "Cannot find module '/absolute/path'",
      }),
    ];
    const result = detectMissingImports(errors);
    expect(result).toEqual([]);
  });

  it("should ignore Node.js built-in modules (fs, path, node:fs, etc.)", () => {
    const errors: StructuredError[] = [
      structuredError({
        code: "TS2307",
        message: "Cannot find module 'fs'",
      }),
      structuredError({
        code: "TS2307",
        message: "Cannot find module 'path'",
      }),
      structuredError({
        code: "TS2307",
        message: "Cannot find module 'node:fs'",
      }),
      structuredError({
        code: "TS2307",
        message: "Cannot find module 'node:path'",
      }),
    ];
    const result = detectMissingImports(errors);
    expect(result).toEqual([]);
  });

  it("should return empty array for non-TS2307 errors", () => {
    const errors: StructuredError[] = [
      structuredError({
        code: "TS2322",
        message: "Cannot find module 'lodash'",
      }),
      structuredError({
        code: "TS2304",
        message: "Cannot find name 'foo'",
      }),
    ];
    const result = detectMissingImports(errors);
    expect(result).toEqual([]);
  });

  it("should return empty array for empty errors list", () => {
    const result = detectMissingImports([]);
    expect(result).toEqual([]);
  });

  it("should deduplicate package names", () => {
    const errors: StructuredError[] = [
      structuredError({
        code: "TS2307",
        message: "Cannot find module 'lodash'",
      }),
      structuredError({
        code: "TS2307",
        message: "Cannot find module 'lodash'",
      }),
      structuredError({
        code: "TS2307",
        message: "Cannot find module '@types/lodash'",
      }),
    ];
    const result = detectMissingImports(errors);
    expect(result).toHaveLength(2);
    expect(result).toContain("lodash");
    expect(result).toContain("@types/lodash");
  });
});

describe("detectPackageManager", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "fd-installer-test-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should detect pnpm from pnpm-lock.yaml (use real tmpdir with fs)", async () => {
    await fs.writeFile(path.join(testDir, "pnpm-lock.yaml"), "lockfileVersion: 7\n", "utf-8");
    const result = await detectPackageManager(testDir);
    expect(result).toBe("pnpm");
  });

  it("should detect yarn from yarn.lock (use real tmpdir with fs)", async () => {
    await fs.writeFile(path.join(testDir, "yarn.lock"), "# yarn lock\n", "utf-8");
    const result = await detectPackageManager(testDir);
    expect(result).toBe("yarn");
  });

  it("should default to npm when no lockfile found", async () => {
    const result = await detectPackageManager(testDir);
    expect(result).toBe("npm");
  });
});
