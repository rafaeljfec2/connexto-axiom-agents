import { describe, it, expect } from "vitest";
import {
  parseTscErrors,
  parseEslintErrors,
  formatErrorsForPrompt,
  separateErrorsAndWarnings,
  extractTypeNamesFromErrors,
  type StructuredError,
} from "./forgeErrorParser.js";

describe("parseTscErrors", () => {
  it("parses standard tsc error output", () => {
    const raw = `src/foo.ts(42,5): error TS2345: Argument of type 'User' is not assignable to parameter of type 'string'.`;
    const result = parseTscErrors(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "src/foo.ts",
      line: 42,
      column: 5,
      code: "TS2345",
      message: "Argument of type 'User' is not assignable to parameter of type 'string'.",
      severity: "error",
      source: "tsc",
    });
  });

  it("parses tsc warning output", () => {
    const raw = `src/bar.ts(10,3): warning TS6133: 'x' is declared but its value is never read.`;
    const result = parseTscErrors(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "src/bar.ts",
      line: 10,
      column: 3,
      code: "TS6133",
      message: "'x' is declared but its value is never read.",
      severity: "warning",
      source: "tsc",
    });
  });

  it("returns empty array for empty input", () => {
    expect(parseTscErrors("")).toEqual([]);
    expect(parseTscErrors("\n\n")).toEqual([]);
  });

  it("parses multiple errors from same file", () => {
    const raw = `src/foo.ts(1,1): error TS2322: Type 'number' is not assignable to type 'string'.
src/foo.ts(5,10): error TS2345: Argument of type 'null' is not assignable.`;
    const result = parseTscErrors(raw);
    expect(result).toHaveLength(2);
    expect(result[0].line).toBe(1);
    expect(result[0].code).toBe("TS2322");
    expect(result[1].line).toBe(5);
    expect(result[1].code).toBe("TS2345");
  });

  it("parses multiple errors from different files", () => {
    const raw = `src/a.ts(1,1): error TS2304: Cannot find name 'foo'.
lib/b.ts(2,2): warning TS6133: 'bar' is declared but never used.`;
    const result = parseTscErrors(raw);
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe("src/a.ts");
    expect(result[1].file).toBe("lib/b.ts");
    expect(result[0].severity).toBe("error");
    expect(result[1].severity).toBe("warning");
  });

  it("ignores non-matching lines", () => {
    const raw = `src/foo.ts(42,5): error TS2345: valid error
some random text
  indented line
src/bar.ts(1,1): warning TS6133: another valid`;
    const result = parseTscErrors(raw);
    expect(result).toHaveLength(2);
  });

  it("trims whitespace from lines", () => {
    const raw = `  src/foo.ts(1,1): error TS2304: Cannot find name 'x'.  `;
    const result = parseTscErrors(raw);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("src/foo.ts");
  });
});

describe("parseEslintErrors", () => {
  it("parses eslint output with file header and error lines", () => {
    const raw = `src/foo.ts
  42:5  error  'x' is defined but never used  no-unused-vars`;
    const result = parseEslintErrors(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "src/foo.ts",
      line: 42,
      column: 5,
      code: "no-unused-vars",
      message: "'x' is defined but never used",
      severity: "error",
      source: "eslint",
    });
  });

  it("parses eslint warning", () => {
    const raw = `src/bar.ts
  10:3  warning  Unexpected console statement  no-console`;
    const result = parseEslintErrors(raw);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
    expect(result[0].code).toBe("no-console");
  });

  it("returns empty array for empty input", () => {
    expect(parseEslintErrors("")).toEqual([]);
    expect(parseEslintErrors("\n\n")).toEqual([]);
  });

  it("parses multiple files", () => {
    const raw = `src/a.ts
  1:1  error  Missing semicolon  semi

src/b.ts
  2:2  warning  Prefer const  prefer-const`;
    const result = parseEslintErrors(raw);
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe("src/a.ts");
    expect(result[0].code).toBe("semi");
    expect(result[1].file).toBe("src/b.ts");
    expect(result[1].code).toBe("prefer-const");
  });

  it("parses absolute path file headers", () => {
    const raw = `/home/user/project/src/index.ts
  3:1  error  'React' is not defined  no-undef`;
    const result = parseEslintErrors(raw);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("/home/user/project/src/index.ts");
  });

  it("ignores errors without a preceding file header", () => {
    const raw = `  1:1  error  Some message  some-rule`;
    const result = parseEslintErrors(raw);
    expect(result).toHaveLength(0);
  });

  it("requires two or more spaces between message and rule code", () => {
    const raw = `src/foo.ts
  1:1  error  message  rule`;
    const result = parseEslintErrors(raw);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("message");
    expect(result[0].code).toBe("rule");
  });
});

describe("formatErrorsForPrompt", () => {
  const makeError = (overrides: Partial<StructuredError>): StructuredError => ({
    file: "src/foo.ts",
    line: 1,
    column: 1,
    code: "TS2345",
    message: "some message",
    severity: "error",
    source: "tsc",
    ...overrides,
  });

  it("prioritizes errors in touched files", () => {
    const errors: StructuredError[] = [
      makeError({ file: "src/other.ts", line: 1 }),
      makeError({ file: "src/foo.ts", line: 2 }),
    ];
    const result = formatErrorsForPrompt(errors, ["src/foo.ts"], 500);
    const lines = result.split("\n");
    expect(lines[0]).toContain("src/foo.ts");
    expect(lines[1]).toContain("src/other.ts");
  });

  it("prioritizes errors over warnings within same relevance", () => {
    const errors: StructuredError[] = [
      makeError({ file: "src/foo.ts", severity: "warning" }),
      makeError({ file: "src/foo.ts", line: 2, severity: "error" }),
    ];
    const result = formatErrorsForPrompt(errors, ["src/foo.ts"], 500);
    const lines = result.split("\n");
    expect(lines[0]).toContain("ERROR");
    expect(lines[1]).toContain("WARN");
  });

  it("respects maxChars limit", () => {
    const errors: StructuredError[] = [
      makeError({ message: "short" }),
      makeError({ line: 2, message: "another" }),
    ];
    const short = formatErrorsForPrompt(errors, [], 80);
    expect(short.length).toBeLessThanOrEqual(80 + 1);
    const full = formatErrorsForPrompt(errors, [], 1000);
    expect(full.split("\n")).toHaveLength(2);
  });

  it("formats errors correctly with source and severity", () => {
    const errors: StructuredError[] = [
      makeError({ source: "tsc", severity: "error" }),
    ];
    const result = formatErrorsForPrompt(errors, [], 500);
    expect(result).toMatch(/^\[TSC\] ERROR/);
    expect(result).toContain("src/foo.ts:1:1");
    expect(result).toContain("TS2345");
    expect(result).toContain("some message");
  });

  it("formats eslint errors with ESLINT tag", () => {
    const errors: StructuredError[] = [
      makeError({ source: "eslint", code: "no-unused-vars" }),
    ];
    const result = formatErrorsForPrompt(errors, [], 500);
    expect(result).toMatch(/^\[ESLINT\]/);
  });

  it("returns empty string when no errors", () => {
    expect(formatErrorsForPrompt([], [], 500)).toBe("");
  });

  it("matches touched files by suffix (error file ends with touched)", () => {
    const errors: StructuredError[] = [
      makeError({ file: "/workspace/project/src/foo.ts" }),
    ];
    const result = formatErrorsForPrompt(errors, ["src/foo.ts"], 500);
    expect(result).toContain("src/foo.ts");
  });
});

describe("separateErrorsAndWarnings", () => {
  const makeError = (overrides: Partial<StructuredError>): StructuredError => ({
    file: "src/foo.ts",
    line: 1,
    column: 1,
    code: "TS2345",
    message: "msg",
    severity: "error",
    source: "tsc",
    ...overrides,
  });

  it("splits errors and warnings by severity", () => {
    const input: StructuredError[] = [
      makeError({ severity: "error" }),
      makeError({ severity: "warning", line: 2 }),
      makeError({ severity: "error", line: 3 }),
    ];
    const { errors, warnings } = separateErrorsAndWarnings(input);
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(errors.every((e) => e.severity === "error")).toBe(true);
    expect(warnings.every((w) => w.severity === "warning")).toBe(true);
  });

  it("returns empty arrays when input is empty", () => {
    const { errors, warnings } = separateErrorsAndWarnings([]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("returns all in errors when no warnings", () => {
    const input: StructuredError[] = [
      makeError({ severity: "error" }),
      makeError({ severity: "error", line: 2 }),
    ];
    const { errors, warnings } = separateErrorsAndWarnings(input);
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("returns all in warnings when no errors", () => {
    const input: StructuredError[] = [
      makeError({ severity: "warning" }),
      makeError({ severity: "warning", line: 2 }),
    ];
    const { errors, warnings } = separateErrorsAndWarnings(input);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(2);
  });
});

describe("extractTypeNamesFromErrors", () => {
  const makeError = (code: string, message: string): StructuredError => ({
    file: "src/foo.ts",
    line: 1,
    column: 1,
    code,
    message,
    severity: "error",
    source: "tsc",
  });

  it("extracts type names from TS2345 error messages", () => {
    const errors = [
      makeError(
        "TS2345",
        "Argument of type 'User' is not assignable to parameter of type 'string'.",
      ),
    ];
    const result = extractTypeNamesFromErrors(errors);
    expect(result).toContain("User");
    expect(result).toContain("string");
  });

  it("extracts type names from TS2322 error messages", () => {
    const errors = [
      makeError("TS2322", "Type 'ApiResponse' is not assignable to type 'null'."),
    ];
    const result = extractTypeNamesFromErrors(errors);
    expect(result).toContain("ApiResponse");
  });

  it("skips primitive type names", () => {
    const errors = [
      makeError(
        "TS2345",
        "Argument of type 'String' is not assignable to type 'Number'.",
      ),
    ];
    const result = extractTypeNamesFromErrors(errors);
    expect(result).not.toContain("String");
    expect(result).not.toContain("Number");
  });

  it("skips short type names (< 3 chars)", () => {
    const errors = [
      makeError("TS2345", "Type 'X' is not assignable to type 'Y'."),
    ];
    const result = extractTypeNamesFromErrors(errors);
    expect(result).not.toContain("X");
    expect(result).not.toContain("Y");
  });

  it("ignores errors with non-type-mismatch codes", () => {
    const errors = [
      makeError("TS6133", "'x' is declared but never used."),
      makeError("TS7006", "Parameter 'x' implicitly has an 'any' type."),
    ];
    const result = extractTypeNamesFromErrors(errors);
    expect(result).toHaveLength(0);
  });

  it("extracts from TS2741 and TS2559 type mismatch codes", () => {
    const errors = [
      makeError("TS2741", "Property 'id' is missing in type 'User' but required."),
      makeError("TS2559", "Type 'ApiClient' has no properties in common with type 'Config'."),
    ];
    const result = extractTypeNamesFromErrors(errors);
    expect(result).toContain("User");
    expect(result).toContain("ApiClient");
    expect(result).toContain("Config");
  });

  it("deduplicates type names", () => {
    const errors = [
      makeError("TS2345", "Type 'User' is not assignable to type 'User'."),
    ];
    const result = extractTypeNamesFromErrors(errors);
    expect(result).toHaveLength(1);
    expect(result).toContain("User");
  });

  it("returns empty array for empty input", () => {
    expect(extractTypeNamesFromErrors([])).toEqual([]);
  });

  it("handles multiple errors and aggregates types", () => {
    const errors = [
      makeError("TS2345", "Type 'User' is not assignable."),
      makeError("TS2322", "Type 'Order' is not assignable."),
    ];
    const result = extractTypeNamesFromErrors(errors);
    expect(result).toContain("User");
    expect(result).toContain("Order");
  });

  it("skips Object, Array, Partial, etc. (built-in generics)", () => {
    const errors = [
      makeError("TS2345", "Type 'Partial' is not assignable to type 'Required'."),
    ];
    const result = extractTypeNamesFromErrors(errors);
    expect(result).not.toContain("Partial");
    expect(result).not.toContain("Required");
  });
});
