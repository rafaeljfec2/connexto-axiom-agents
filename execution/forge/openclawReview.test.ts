import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runHeuristicReview } from "./openclawReview.js";

describe("runHeuristicReview - new heuristics (Phase 2)", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "review-test-"));
  });

  after(async () => {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeTestFile(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(tmpDir, relativePath);
    await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
    await fsPromises.writeFile(fullPath, content, "utf-8");
  }

  it("should detect console.log in production code", async () => {
    await writeTestFile("src/service.ts", [
      "export function doStuff() {",
      '  console.log("debug info");',
      "  return 42;",
      "}",
    ].join("\n"));

    const result = await runHeuristicReview(tmpDir, ["src/service.ts"]);
    const consoleFinding = result.findings.find((f) => f.rule === "no-console-log");

    assert.ok(consoleFinding, "should find console.log");
    assert.equal(consoleFinding?.severity, "WARNING");
    assert.equal(consoleFinding?.line, 2);
  });

  it("should not flag console.log in test files", async () => {
    await writeTestFile("src/service.test.ts", [
      'import { doStuff } from "./service";',
      "test('it works', () => {",
      '  console.log("test debug");',
      "  expect(doStuff()).toBe(42);",
      "});",
    ].join("\n"));

    const result = await runHeuristicReview(tmpDir, ["src/service.test.ts"]);
    const consoleFinding = result.findings.find((f) => f.rule === "no-console-log");

    assert.equal(consoleFinding, undefined, "should not flag console.log in test files");
  });

  it("should detect hardcoded URLs in source code", async () => {
    await writeTestFile("src/api.ts", [
      "export const API_URL = 'https://api.example.com/v1';",
      "export function getUser() {",
      "  return fetch(API_URL);",
      "}",
    ].join("\n"));

    const result = await runHeuristicReview(tmpDir, ["src/api.ts"]);
    const urlFinding = result.findings.find((f) => f.rule === "no-hardcoded-url");

    assert.ok(urlFinding, "should detect hardcoded URL");
    assert.equal(urlFinding?.severity, "WARNING");
    assert.equal(urlFinding?.line, 1);
  });

  it("should not flag URLs in markdown files", async () => {
    await writeTestFile("README.md", [
      "# Project",
      "",
      "See https://docs.example.com for more info.",
    ].join("\n"));

    const result = await runHeuristicReview(tmpDir, ["README.md"]);
    const urlFinding = result.findings.find((f) => f.rule === "no-hardcoded-url");

    assert.equal(urlFinding, undefined, "should not flag URLs in markdown files");
  });

  it("should detect functions with too many parameters", async () => {
    await writeTestFile("src/utils.ts", [
      "export function processData(a: string, b: number, c: boolean, d: string, e: number, f: boolean) {",
      "  return { a, b, c, d, e, f };",
      "}",
    ].join("\n"));

    const result = await runHeuristicReview(tmpDir, ["src/utils.ts"]);
    const paramFinding = result.findings.find((f) => f.rule === "max-function-params");

    assert.ok(paramFinding, "should detect too many function params");
    assert.equal(paramFinding?.severity, "INFO");
    assert.equal(paramFinding?.line, 1);
  });

  it("should not flag functions with 5 or fewer parameters", async () => {
    await writeTestFile("src/ok.ts", [
      "export function processData(a: string, b: number, c: boolean, d: string, e: number) {",
      "  return { a, b, c, d, e };",
      "}",
    ].join("\n"));

    const result = await runHeuristicReview(tmpDir, ["src/ok.ts"]);
    const paramFinding = result.findings.find((f) => f.rule === "max-function-params");

    assert.equal(paramFinding, undefined, "should not flag functions with <= 5 params");
  });

  it("should still run existing heuristics (secrets, any, etc.)", async () => {
    await writeTestFile("src/mixed.ts", [
      "const apiKey = 'api_key: \"sk-12345678abcdef\"';",
      "const data: any = {};",
      "const fallback = data || 'default';",
    ].join("\n"));

    const result = await runHeuristicReview(tmpDir, ["src/mixed.ts"]);

    const secretFinding = result.findings.find((f) => f.rule === "no-secrets");
    const anyFinding = result.findings.find((f) => f.rule === "no-any-type");

    assert.ok(secretFinding, "should still detect secrets");
    assert.ok(anyFinding, "should still detect any type");
  });
});
