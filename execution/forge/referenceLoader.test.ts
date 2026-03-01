import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseReferenceFrontmatter,
  scoreReference,
  selectReferences,
  formatReferencesForPrompt,
  type ReferenceFile,
  type ReferenceSelectionContext,
  type ScoredReference,
} from "./referenceLoader.js";

const IMPLEMENT_CTX: ReferenceSelectionContext = {
  taskType: "IMPLEMENT",
  language: "typescript",
  framework: "nestjs-nextjs-turbo",
  taskDescription: "Add a new service endpoint for user management",
};

const FIX_CTX: ReferenceSelectionContext = {
  taskType: "FIX",
  language: "typescript",
  framework: "nestjs-nextjs-turbo",
  taskDescription: "Fix broken validation in the login flow",
};

function createReference(overrides?: Partial<ReferenceFile>): ReferenceFile {
  return {
    filename: "test-pattern.md",
    frontmatter: {
      tags: ["typescript", "service"],
      applies_to: ["IMPLEMENT", "CREATE"],
      description: "Test reference",
    },
    content: "## Example\n\nSome reference code here.",
    source: "global",
    charCount: 40,
    ...overrides,
  };
}

describe("parseReferenceFrontmatter", () => {
  it("should parse valid frontmatter with all fields", () => {
    const raw = [
      "---",
      "tags: [service, nestjs, pattern]",
      "applies_to: [IMPLEMENT, REFACTOR]",
      "description: Service pattern example",
      "---",
      "",
      "## Content here",
    ].join("\n");

    const { frontmatter, content } = parseReferenceFrontmatter(raw);

    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.tags, ["service", "nestjs", "pattern"]);
    assert.deepEqual(frontmatter.applies_to, ["IMPLEMENT", "REFACTOR"]);
    assert.equal(frontmatter.description, "Service pattern example");
    assert.equal(content, "## Content here");
  });

  it("should return null frontmatter for content without frontmatter", () => {
    const raw = "## Just content\n\nNo frontmatter here.";
    const { frontmatter, content } = parseReferenceFrontmatter(raw);

    assert.equal(frontmatter, null);
    assert.equal(content, "## Just content\n\nNo frontmatter here.");
  });

  it("should lowercase all tags", () => {
    const raw = "---\ntags: [TypeScript, NestJS, Pattern]\n---\n\nContent";
    const { frontmatter } = parseReferenceFrontmatter(raw);

    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.tags, ["typescript", "nestjs", "pattern"]);
  });

  it("should default applies_to to all task types when missing", () => {
    const raw = "---\ntags: [test]\n---\n\nContent";
    const { frontmatter } = parseReferenceFrontmatter(raw);

    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.applies_to, ["IMPLEMENT", "FIX", "CREATE", "REFACTOR"]);
  });

  it("should filter invalid task types from applies_to", () => {
    const raw = "---\ntags: [test]\napplies_to: [IMPLEMENT, INVALID, FIX]\n---\n\nContent";
    const { frontmatter } = parseReferenceFrontmatter(raw);

    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.applies_to, ["IMPLEMENT", "FIX"]);
  });

  it("should handle empty tags array", () => {
    const raw = "---\ntags: []\napplies_to: [IMPLEMENT]\n---\n\nContent";
    const { frontmatter } = parseReferenceFrontmatter(raw);

    assert.ok(frontmatter);
    assert.deepEqual(frontmatter.tags, []);
  });

  it("should handle missing description gracefully", () => {
    const raw = "---\ntags: [test]\n---\n\nContent";
    const { frontmatter } = parseReferenceFrontmatter(raw);

    assert.ok(frontmatter);
    assert.equal(frontmatter.description, "");
  });
});

describe("scoreReference", () => {
  it("should return 0 when task type does not match applies_to", () => {
    const ref = createReference({
      frontmatter: { tags: ["typescript"], applies_to: ["IMPLEMENT"], description: "" },
    });

    const score = scoreReference(ref, FIX_CTX);
    assert.equal(score, 0);
  });

  it("should score higher when task type matches", () => {
    const ref = createReference({
      frontmatter: { tags: [], applies_to: ["IMPLEMENT"], description: "" },
    });

    const score = scoreReference(ref, IMPLEMENT_CTX);
    assert.ok(score >= 10);
  });

  it("should add points for stack tag matches", () => {
    const refNoTags = createReference({
      frontmatter: { tags: [], applies_to: ["IMPLEMENT"], description: "" },
    });
    const refWithTags = createReference({
      frontmatter: { tags: ["typescript", "nestjs"], applies_to: ["IMPLEMENT"], description: "" },
    });

    const scoreNo = scoreReference(refNoTags, IMPLEMENT_CTX);
    const scoreWith = scoreReference(refWithTags, IMPLEMENT_CTX);

    assert.ok(scoreWith > scoreNo);
  });

  it("should add points for task description keyword matches", () => {
    const ref = createReference({
      frontmatter: { tags: ["service", "endpoint"], applies_to: ["IMPLEMENT"], description: "" },
    });

    const score = scoreReference(ref, IMPLEMENT_CTX);
    assert.ok(score > 10);
  });

  it("should give project references a bonus over global", () => {
    const globalRef = createReference({ source: "global" });
    const projectRef = createReference({ source: "project" });

    const globalScore = scoreReference(globalRef, IMPLEMENT_CTX);
    const projectScore = scoreReference(projectRef, IMPLEMENT_CTX);

    assert.ok(projectScore > globalScore);
  });
});

describe("selectReferences", () => {
  it("should return empty array when no references have matching score", () => {
    const refs = [
      createReference({
        frontmatter: { tags: ["python"], applies_to: ["FIX"], description: "" },
      }),
    ];

    const selected = selectReferences(refs, IMPLEMENT_CTX, 3000);
    assert.equal(selected.length, 0);
  });

  it("should select references within token budget", () => {
    const refs = [
      createReference({ filename: "a.md", charCount: 4000 }),
      createReference({ filename: "b.md", charCount: 4000 }),
      createReference({ filename: "c.md", charCount: 4000 }),
    ];

    const selected = selectReferences(refs, IMPLEMENT_CTX, 3000);
    assert.ok(selected.length <= 3);

    const totalChars = selected.reduce((sum, s) => sum + s.reference.charCount, 0);
    assert.ok(totalChars <= 3000 * 4);
  });

  it("should sort by score descending", () => {
    const highRef = createReference({
      filename: "high.md",
      frontmatter: { tags: ["typescript", "nestjs", "service"], applies_to: ["IMPLEMENT"], description: "" },
      charCount: 100,
    });
    const lowRef = createReference({
      filename: "low.md",
      frontmatter: { tags: [], applies_to: ["IMPLEMENT"], description: "" },
      charCount: 100,
    });

    const selected = selectReferences([lowRef, highRef], IMPLEMENT_CTX, 3000);

    assert.ok(selected.length >= 2);
    assert.ok(selected[0].score >= selected[1].score);
  });

  it("should skip references that exceed remaining budget", () => {
    const smallRef = createReference({ filename: "small.md", charCount: 100 });
    const bigRef = createReference({ filename: "big.md", charCount: 50000 });

    const selected = selectReferences([bigRef, smallRef], IMPLEMENT_CTX, 100);
    const filenames = selected.map((s) => s.reference.filename);

    assert.ok(filenames.includes("small.md"));
    assert.ok(!filenames.includes("big.md"));
  });
});

describe("formatReferencesForPrompt", () => {
  it("should return empty string for empty selection", () => {
    const result = formatReferencesForPrompt([]);
    assert.equal(result, "");
  });

  it("should format with header and reference sections", () => {
    const selected: readonly ScoredReference[] = [
      {
        reference: createReference({ frontmatter: { tags: [], applies_to: ["IMPLEMENT"], description: "My Pattern" }, content: "Code here" }),
        score: 15,
      },
    ];

    const result = formatReferencesForPrompt(selected);

    assert.ok(result.includes("# Reference Examples"));
    assert.ok(result.includes("Follow these patterns"));
    assert.ok(result.includes("## My Pattern"));
    assert.ok(result.includes("Code here"));
  });

  it("should use filename as fallback when description is empty", () => {
    const selected: readonly ScoredReference[] = [
      {
        reference: createReference({ filename: "my-pattern.md", frontmatter: { tags: [], applies_to: ["IMPLEMENT"], description: "" }, content: "Code" }),
        score: 10,
      },
    ];

    const result = formatReferencesForPrompt(selected);
    assert.ok(result.includes("## my-pattern"));
  });

  it("should include multiple references in order", () => {
    const selected: readonly ScoredReference[] = [
      {
        reference: createReference({ frontmatter: { tags: [], applies_to: ["IMPLEMENT"], description: "First" }, content: "First code" }),
        score: 20,
      },
      {
        reference: createReference({ frontmatter: { tags: [], applies_to: ["IMPLEMENT"], description: "Second" }, content: "Second code" }),
        score: 15,
      },
    ];

    const result = formatReferencesForPrompt(selected);
    const firstIndex = result.indexOf("## First");
    const secondIndex = result.indexOf("## Second");

    assert.ok(firstIndex < secondIndex);
  });
});
