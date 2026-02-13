import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateManifest,
  ManifestValidationError,
} from "./manifest.schema.js";

const VALID_MANIFEST = {
  project_id: "meu-saas",
  repo_source: "https://github.com/org/meu-saas",
  stack: {
    language: "typescript",
    framework: "nestjs",
  },
  risk_profile: "medium",
  autonomy_level: 2,
  token_budget_monthly: 100000,
  status: "active",
};

describe("validateManifest", () => {
  it("should parse a valid manifest with all required fields", () => {
    const result = validateManifest(VALID_MANIFEST);

    assert.equal(result.projectId, "meu-saas");
    assert.equal(result.repoSource, "https://github.com/org/meu-saas");
    assert.equal(result.stack.language, "typescript");
    assert.equal(result.stack.framework, "nestjs");
    assert.equal(result.riskProfile, "medium");
    assert.equal(result.autonomyLevel, 2);
    assert.equal(result.tokenBudgetMonthly, 100000);
    assert.equal(result.status, "active");
  });

  it("should accept camelCase keys as alternative", () => {
    const result = validateManifest({
      projectId: "meu-saas",
      repoSource: ".",
      stack: { language: "go", framework: "gin" },
      riskProfile: "low",
      autonomyLevel: 1,
      tokenBudgetMonthly: 50000,
      status: "paused",
    });

    assert.equal(result.projectId, "meu-saas");
    assert.equal(result.riskProfile, "low");
    assert.equal(result.status, "paused");
  });

  it("should default status to active when not provided", () => {
    const input = { ...VALID_MANIFEST, status: undefined };
    const result = validateManifest(input);

    assert.equal(result.status, "active");
  });

  it("should reject null input", () => {
    assert.throws(
      () => validateManifest(null),
      ManifestValidationError,
    );
  });

  it("should reject non-object input", () => {
    assert.throws(
      () => validateManifest("invalid"),
      ManifestValidationError,
    );
  });

  it("should reject empty project_id", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, project_id: "" }),
      ManifestValidationError,
    );
  });

  it("should reject project_id with uppercase characters", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, project_id: "MyProject" }),
      ManifestValidationError,
    );
  });

  it("should reject project_id with spaces", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, project_id: "my project" }),
      ManifestValidationError,
    );
  });

  it("should reject single-character project_id", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, project_id: "a" }),
      ManifestValidationError,
    );
  });

  it("should reject invalid risk_profile", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, risk_profile: "extreme" }),
      ManifestValidationError,
    );
  });

  it("should reject autonomy_level out of range", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, autonomy_level: 5 }),
      ManifestValidationError,
    );
  });

  it("should reject zero token_budget_monthly", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, token_budget_monthly: 0 }),
      ManifestValidationError,
    );
  });

  it("should reject negative token_budget_monthly", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, token_budget_monthly: -1000 }),
      ManifestValidationError,
    );
  });

  it("should reject missing stack", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, stack: null }),
      ManifestValidationError,
    );
  });

  it("should reject stack with missing language", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, stack: { framework: "nestjs" } }),
      ManifestValidationError,
    );
  });

  it("should reject invalid status value", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, status: "archived" }),
      ManifestValidationError,
    );
  });

  it("should accept all valid risk profiles", () => {
    for (const rp of ["low", "medium", "high"]) {
      const result = validateManifest({ ...VALID_MANIFEST, risk_profile: rp });
      assert.equal(result.riskProfile, rp);
    }
  });

  it("should accept all valid autonomy levels", () => {
    for (const level of [1, 2, 3]) {
      const result = validateManifest({ ...VALID_MANIFEST, autonomy_level: level });
      assert.equal(result.autonomyLevel, level);
    }
  });

  it("should accept all valid statuses", () => {
    for (const status of ["active", "maintenance", "paused"]) {
      const result = validateManifest({ ...VALID_MANIFEST, status });
      assert.equal(result.status, status);
    }
  });

  it("should accept string autonomy_level and convert to number", () => {
    const result = validateManifest({ ...VALID_MANIFEST, autonomy_level: "3" });
    assert.equal(result.autonomyLevel, 3);
  });

  it("should accept string token_budget_monthly and convert to number", () => {
    const result = validateManifest({ ...VALID_MANIFEST, token_budget_monthly: "200000" });
    assert.equal(result.tokenBudgetMonthly, 200000);
  });

  it("should trim whitespace from string fields", () => {
    const result = validateManifest({
      ...VALID_MANIFEST,
      project_id: "  meu-saas  ",
      repo_source: "  .  ",
    });
    assert.equal(result.projectId, "meu-saas");
    assert.equal(result.repoSource, ".");
  });

  it("should default forge_executor to legacy when not provided", () => {
    const result = validateManifest(VALID_MANIFEST);
    assert.equal(result.forgeExecutor, "legacy");
  });

  it("should accept forge_executor openclaw", () => {
    const result = validateManifest({ ...VALID_MANIFEST, forge_executor: "openclaw" });
    assert.equal(result.forgeExecutor, "openclaw");
  });

  it("should accept forge_executor legacy", () => {
    const result = validateManifest({ ...VALID_MANIFEST, forge_executor: "legacy" });
    assert.equal(result.forgeExecutor, "legacy");
  });

  it("should accept camelCase forgeExecutor", () => {
    const result = validateManifest({ ...VALID_MANIFEST, forgeExecutor: "openclaw" });
    assert.equal(result.forgeExecutor, "openclaw");
  });

  it("should reject invalid forge_executor value", () => {
    assert.throws(
      () => validateManifest({ ...VALID_MANIFEST, forge_executor: "custom" }),
      ManifestValidationError,
    );
  });
});
