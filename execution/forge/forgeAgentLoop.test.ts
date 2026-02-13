import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validatePlanCoherence } from "./forgeAgentLoop.js";
import type { ForgePlan } from "./forgeTypes.js";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

function buildPlan(filesToModify: readonly string[]): ForgePlan {
  return {
    plan: "test plan",
    filesToRead: [],
    filesToModify: [...filesToModify],
    filesToCreate: [],
    approach: "test approach",
    estimatedRisk: 2,
    dependencies: [],
  };
}

describe("validatePlanCoherence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forge-coherence-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should return coherent when plan has no files to modify", async () => {
    const plan = buildPlan([]);
    const result = await validatePlanCoherence(plan, tmpDir, ["theme", "dark"]);
    expect(result.isCoherent).toBe(true);
    expect(result.suspiciousFiles).toEqual([]);
  });

  it("should return coherent when no keywords provided", async () => {
    const plan = buildPlan(["src/config/logger.ts"]);
    const result = await validatePlanCoherence(plan, tmpDir, []);
    expect(result.isCoherent).toBe(true);
  });

  it("should return coherent when file content contains keywords", async () => {
    const filePath = "src/config/theme.ts";
    const fullDir = path.join(tmpDir, "src/config");
    await fs.mkdir(fullDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, filePath),
      'export const darkColors = { primary: "#FF0000" };\nexport const lightColors = { primary: "#FFFFFF" };\n',
    );

    const plan = buildPlan([filePath]);
    const result = await validatePlanCoherence(plan, tmpDir, ["dark", "theme"]);
    expect(result.isCoherent).toBe(true);
    expect(result.suspiciousFiles).toEqual([]);
  });

  it("should detect incoherent plan when no file contains keywords", async () => {
    const filePath = "src/config/logger.ts";
    const fullDir = path.join(tmpDir, "src/config");
    await fs.mkdir(fullDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, filePath),
      "import { pino } from 'pino';\nexport const loggerConfig = { level: 'info' };\n",
    );

    const plan = buildPlan([filePath]);
    const result = await validatePlanCoherence(plan, tmpDir, ["dark", "theme", "color"]);
    expect(result.isCoherent).toBe(false);
    expect(result.suspiciousFiles).toContain(filePath);
  });

  it("should consider path keywords for coherence", async () => {
    const filePath = "src/theme/palette.ts";
    const fullDir = path.join(tmpDir, "src/theme");
    await fs.mkdir(fullDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, filePath),
      "export const red = '#FF0000';\nexport const blue = '#0000FF';\n",
    );

    const plan = buildPlan([filePath]);
    const result = await validatePlanCoherence(plan, tmpDir, ["theme"]);
    expect(result.isCoherent).toBe(true);
    expect(result.suspiciousFiles).toEqual([]);
  });

  it("should mark as coherent if at least one file has keywords", async () => {
    const themePath = "src/config/theme.ts";
    const loggerPath = "src/config/logger.ts";
    const fullDir = path.join(tmpDir, "src/config");
    await fs.mkdir(fullDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, themePath), 'export const darkTheme = { bg: "#000" };\n');
    await fs.writeFile(
      path.join(tmpDir, loggerPath),
      "export const loggerConfig = { level: 'info' };\n",
    );

    const plan = buildPlan([themePath, loggerPath]);
    const result = await validatePlanCoherence(plan, tmpDir, ["dark", "theme"]);
    expect(result.isCoherent).toBe(true);
    expect(result.suspiciousFiles).toContain(loggerPath);
  });

  it("should handle missing files gracefully", async () => {
    const plan = buildPlan(["src/nonexistent.ts"]);
    const result = await validatePlanCoherence(plan, tmpDir, ["theme"]);
    expect(result.isCoherent).toBe(true);
  });
});
