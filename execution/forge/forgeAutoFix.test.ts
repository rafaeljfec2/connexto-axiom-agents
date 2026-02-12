import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import type { StructuredError } from "./forgeErrorParser.js";
import { applyAutoFixes } from "./forgeAutoFix.js";

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

function createError(overrides: Partial<StructuredError> = {}): StructuredError {
  return {
    file: "src/foo.ts",
    line: 1,
    column: 1,
    code: "TS2322",
    message: "Type 'string' is not assignable to type 'number'",
    severity: "error",
    source: "tsc",
    ...overrides,
  };
}

describe("applyAutoFixes", () => {
  const workspacePath = "/workspace";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fix unused import errors by removing them from the file", async () => {
    const content = `import { used, unused } from "./bar";
console.log(used);
`;
    const errors: StructuredError[] = [
      createError({
        file: "src/foo.ts",
        line: 1,
        column: 15,
        code: "no-unused-vars",
        message: "'unused' is defined but never used",
        source: "eslint",
      }),
    ];

    vi.mocked(fs.readFile).mockResolvedValue(content);

    const result = await applyAutoFixes(errors, workspacePath);

    expect(result.fixedCount).toBe(1);
    expect(result.fixedFiles).toEqual(["src/foo.ts"]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/workspace/src/foo.ts",
      `import { used } from "./bar";
console.log(used);
`,
      "utf-8",
    );
    expect(result.remainingErrors).toHaveLength(0);
  });

  it("should prefix unused variables with underscore", async () => {
    const content = `const unusedVar = 42;
const used = 1;
console.log(used);
`;
    const errors: StructuredError[] = [
      createError({
        file: "src/foo.ts",
        line: 1,
        column: 6,
        code: "TS6133",
        message: "'unusedVar' is declared but its value is never read",
        source: "tsc",
      }),
    ];

    vi.mocked(fs.readFile).mockResolvedValue(content);

    const result = await applyAutoFixes(errors, workspacePath);

    expect(result.fixedCount).toBe(1);
    expect(result.fixedFiles).toEqual(["src/foo.ts"]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/workspace/src/foo.ts",
      `const _unusedVar = 42;
const used = 1;
console.log(used);
`,
      "utf-8",
    );
    expect(result.remainingErrors).toHaveLength(0);
  });

  it("should fix missing import type (TS1484) by converting `import {` to `import type {`", async () => {
    const content = `import { MyType } from "./types";
const x: MyType = {};
`;
    const errors: StructuredError[] = [
      createError({
        file: "src/foo.ts",
        line: 1,
        column: 1,
        code: "TS1484",
        message: "Use 'import type' when a type-only import is detected",
        source: "tsc",
      }),
    ];

    vi.mocked(fs.readFile).mockResolvedValue(content);

    const result = await applyAutoFixes(errors, workspacePath);

    expect(result.fixedCount).toBe(1);
    expect(result.fixedFiles).toEqual(["src/foo.ts"]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/workspace/src/foo.ts",
      `import type { MyType } from "./types";
const x: MyType = {};
`,
      "utf-8",
    );
    expect(result.remainingErrors).toHaveLength(0);
  });

  it("should fix missing semicolons for semi errors", async () => {
    const content = `const a = 1
const b = 2
`;
    const errors: StructuredError[] = [
      createError({
        file: "src/foo.ts",
        line: 1,
        column: 11,
        code: "semi",
        message: "Missing semicolon",
        source: "eslint",
      }),
      createError({
        file: "src/foo.ts",
        line: 2,
        column: 11,
        code: "@typescript-eslint/semi",
        message: "Missing semicolon",
        source: "eslint",
      }),
    ];

    vi.mocked(fs.readFile).mockResolvedValue(content);

    const result = await applyAutoFixes(errors, workspacePath);

    expect(result.fixedCount).toBe(2);
    expect(result.fixedFiles).toEqual(["src/foo.ts"]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/workspace/src/foo.ts",
      `const a = 1;
const b = 2;
`,
      "utf-8",
    );
    expect(result.remainingErrors).toHaveLength(0);
  });

  it("should return remaining errors that are not fixable", async () => {
    const content = `const x: number = "hello";
`;
    const errors: StructuredError[] = [
      createError({
        file: "src/foo.ts",
        line: 1,
        column: 7,
        code: "TS2322",
        message: "Type 'string' is not assignable to type 'number'",
        source: "tsc",
      }),
    ];

    vi.mocked(fs.readFile).mockResolvedValue(content);

    const result = await applyAutoFixes(errors, workspacePath);

    expect(result.fixedCount).toBe(0);
    expect(result.fixedFiles).toEqual([]);
    expect(result.remainingErrors).toHaveLength(1);
    expect(result.remainingErrors[0].code).toBe("TS2322");
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("should handle file read errors gracefully (not crash)", async () => {
    const errors: StructuredError[] = [
      createError({
        file: "src/missing.ts",
        line: 1,
        code: "no-unused-vars",
        message: "'x' is defined but never used",
        source: "eslint",
      }),
    ];

    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT: no such file"));

    const result = await applyAutoFixes(errors, workspacePath);

    expect(result.fixedCount).toBe(0);
    expect(result.fixedFiles).toEqual([]);
    expect(result.remainingErrors).toHaveLength(1);
    expect(result.remainingErrors[0].file).toBe("src/missing.ts");
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("should return zero fixes when no fixable errors exist", async () => {
    const content = `const x: number = "hello";
`;
    const errors: StructuredError[] = [
      createError({
        file: "src/foo.ts",
        line: 1,
        code: "TS2322",
        message: "Type 'string' is not assignable to type 'number'",
        source: "tsc",
      }),
      createError({
        file: "src/foo.ts",
        line: 1,
        code: "TS2345",
        message: "Argument of type 'string' is not assignable to parameter of type 'number'",
        source: "tsc",
      }),
    ];

    vi.mocked(fs.readFile).mockResolvedValue(content);

    const result = await applyAutoFixes(errors, workspacePath);

    expect(result.fixedCount).toBe(0);
    expect(result.fixedFiles).toEqual([]);
    expect(result.remainingErrors).toHaveLength(2);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("should remove entire import when all named imports are unused", async () => {
    const content = `import { Foo, Bar } from "./module";
const x = 1;
`;
    const errors: StructuredError[] = [
      createError({
        file: "src/foo.ts",
        line: 1,
        code: "no-unused-vars",
        message: "'Foo' is defined but never used",
        source: "eslint",
      }),
      createError({
        file: "src/foo.ts",
        line: 1,
        code: "no-unused-vars",
        message: "'Bar' is defined but never used",
        source: "eslint",
      }),
    ];

    vi.mocked(fs.readFile).mockResolvedValue(content);

    const result = await applyAutoFixes(errors, workspacePath);

    expect(result.fixedCount).toBe(1);
    expect(result.fixedFiles).toEqual(["src/foo.ts"]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/workspace/src/foo.ts",
      `const x = 1;
`,
      "utf-8",
    );
    expect(result.remainingErrors).toHaveLength(0);
  });

  it("should support @typescript-eslint/no-unused-vars for variable prefixing", async () => {
    const content = `let myVar = 10;
`;
    const errors: StructuredError[] = [
      createError({
        file: "src/foo.ts",
        line: 1,
        column: 5,
        code: "@typescript-eslint/no-unused-vars",
        message: "'myVar' is assigned a value but never used",
        source: "eslint",
      }),
    ];

    vi.mocked(fs.readFile).mockResolvedValue(content);

    const result = await applyAutoFixes(errors, workspacePath);

    expect(result.fixedCount).toBe(1);
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/workspace/src/foo.ts",
      `let _myVar = 10;
`,
      "utf-8",
    );
  });
});
