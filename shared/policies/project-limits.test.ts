import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getProjectLimits } from "./project-limits.js";

describe("getProjectLimits", () => {
  it("should return correct limits for low risk profile", () => {
    const limits = getProjectLimits("low");
    assert.equal(limits.maxRiskLevel, 2);
    assert.equal(limits.maxFilesPerChange, 5);
    assert.equal(limits.approvalRequiredAboveRisk, 3);
  });

  it("should return correct limits for medium risk profile", () => {
    const limits = getProjectLimits("medium");
    assert.equal(limits.maxRiskLevel, 3);
    assert.equal(limits.maxFilesPerChange, 3);
    assert.equal(limits.approvalRequiredAboveRisk, 3);
  });

  it("should return correct limits for high risk profile", () => {
    const limits = getProjectLimits("high");
    assert.equal(limits.maxRiskLevel, 4);
    assert.equal(limits.maxFilesPerChange, 2);
    assert.equal(limits.approvalRequiredAboveRisk, 2);
  });

  it("should return stricter file limits as risk increases", () => {
    const low = getProjectLimits("low");
    const medium = getProjectLimits("medium");
    const high = getProjectLimits("high");

    assert.ok(low.maxFilesPerChange > medium.maxFilesPerChange);
    assert.ok(medium.maxFilesPerChange > high.maxFilesPerChange);
  });

  it("should return higher max risk level for higher risk profiles", () => {
    const low = getProjectLimits("low");
    const medium = getProjectLimits("medium");
    const high = getProjectLimits("high");

    assert.ok(low.maxRiskLevel < medium.maxRiskLevel);
    assert.ok(medium.maxRiskLevel < high.maxRiskLevel);
  });
});
