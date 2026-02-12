import { describe, it, expect } from "vitest";
import {
  extractFirstBalancedJson,
  parseCodeOutput,
} from "./forgeOutputParser.js";

describe("extractFirstBalancedJson", () => {
  it("should extract a simple JSON object from text with surrounding content", () => {
    const text = "Some preamble here\n{\"a\": 1}\nSome trailing text";
    const result = extractFirstBalancedJson(text);
    expect(result).toBe("{\"a\": 1}");
  });

  it("should extract JSON with nested braces", () => {
    const text = "Before {\"outer\": {\"inner\": 42}} after";
    const result = extractFirstBalancedJson(text);
    expect(result).toBe("{\"outer\": {\"inner\": 42}}");
  });

  it("should extract JSON with strings containing braces (e.g., `{\"key\": \"value with { and }\"}`)", () => {
    const text = "x{\"key\": \"value with { and }\"}y";
    const result = extractFirstBalancedJson(text);
    expect(result).toBe("{\"key\": \"value with { and }\"}");
  });

  it("should return null for text without JSON", () => {
    const text = "No JSON here, just plain text";
    const result = extractFirstBalancedJson(text);
    expect(result).toBeNull();
  });

  it("should return the first JSON when multiple objects exist", () => {
    const text = "{\"first\": 1} {\"second\": 2}";
    const result = extractFirstBalancedJson(text);
    expect(result).toBe("{\"first\": 1}");
  });

  it("should handle escaped characters in strings", () => {
    const text = String.raw`{"key": "value with \"quotes\" and \\ backslash"}`;
    const result = extractFirstBalancedJson(text);
    expect(result).toBe(String.raw`{"key": "value with \"quotes\" and \\ backslash"}`);
  });

  it("should handle text with markdown fences around JSON (e.g., \"```json\\n{...}\\n```\")", () => {
    const json = "{\"x\": 123}";
    const text = "```json\n" + json + "\n```";
    const result = extractFirstBalancedJson(text);
    expect(result).toBe(json);
  });
});

describe("parseCodeOutput", () => {
  it("should handle JSON with trailing commas (the implementation removes them)", () => {
    const text = `{
      "description": "Test change",
      "risk": 2,
      "files": [
        {"path": "src/foo.ts", "action": "create", "content": "hello"},
      ]
    }`;
    const result = parseCodeOutput(text);
    expect(result).not.toBeNull();
    expect(result?.description).toBe("Test change");
    expect(result?.risk).toBe(2);
    expect(result?.files).toHaveLength(1);
    expect(result?.files[0].path).toBe("src/foo.ts");
  });

  it("should handle JSON with smart quotes (curly quotes) which get normalized", () => {
    const smartText = "{\u201Cdescription\u201D: \u201CTest change\u201D, \u201Crisk\u201D: 2, \u201Cfiles\u201D: []}";
    const result = parseCodeOutput(smartText);
    expect(result).not.toBeNull();
    expect(result?.description).toBe("Test change");
    expect(result?.risk).toBe(2);
    expect(result?.files).toHaveLength(0);
  });
});
