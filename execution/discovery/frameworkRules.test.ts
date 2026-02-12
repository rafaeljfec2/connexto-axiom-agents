import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFrameworkDiscoveryRules, getContextualPatternsForTask } from "./frameworkRules.js";

describe("frameworkRules", () => {
  describe("getFrameworkDiscoveryRules", () => {
    it("should return Next.js rules for nextjs framework", () => {
      const rules = getFrameworkDiscoveryRules("nextjs");
      assert.ok(rules.alwaysIncludePatterns.some((p) => p.includes("layout")));
      assert.ok(rules.priorityDirs.includes("app"));
      assert.ok(rules.contextualFiles.has("page"));
    });

    it("should return NestJS rules for nestjs framework", () => {
      const rules = getFrameworkDiscoveryRules("nestjs");
      assert.ok(rules.alwaysIncludePatterns.some((p) => p.includes("module")));
      assert.ok(rules.priorityDirs.includes("src"));
      assert.ok(rules.contextualFiles.has("controller"));
    });

    it("should return combined rules for nestjs-nextjs-turbo", () => {
      const rules = getFrameworkDiscoveryRules("nestjs-nextjs-turbo");
      assert.ok(rules.priorityDirs.includes("app"));
      assert.ok(rules.priorityDirs.includes("src"));
      assert.ok(rules.priorityDirs.includes("packages"));
      assert.ok(rules.contextualFiles.has("controller"));
      assert.ok(rules.contextualFiles.has("page"));
    });

    it("should fall back to React rules for unknown framework", () => {
      const rules = getFrameworkDiscoveryRules("unknown-framework");
      assert.ok(rules.priorityDirs.includes("src"));
      assert.ok(rules.priorityDirs.includes("components"));
      assert.ok(rules.contextualFiles.has("component"));
    });

    it("should return Turbo rules for monorepo frameworks", () => {
      const rules = getFrameworkDiscoveryRules("turbo-monorepo");
      assert.ok(rules.priorityDirs.includes("packages"));
      assert.ok(rules.priorityDirs.includes("apps"));
      assert.ok(rules.contextualFiles.has("package"));
    });

    it("should not have empty arrays in results", () => {
      const rules = getFrameworkDiscoveryRules("react");
      assert.ok(rules.alwaysIncludePatterns.length > 0);
      assert.ok(rules.priorityDirs.length > 0);
      assert.ok(rules.contextualFiles.size > 0);
    });
  });

  describe("getContextualPatternsForTask", () => {
    it("should return patterns for matching keywords", () => {
      const rules = getFrameworkDiscoveryRules("nextjs");
      const patterns = getContextualPatternsForTask(rules, ["sidebar", "page"]);

      assert.ok(patterns.length > 0);
      assert.ok(patterns.some((p) => p.includes("layout")));
    });

    it("should return empty for non-matching keywords", () => {
      const rules = getFrameworkDiscoveryRules("nextjs");
      const patterns = getContextualPatternsForTask(rules, ["zzz_nonexistent"]);

      assert.equal(patterns.length, 0);
    });

    it("should not contain duplicate patterns", () => {
      const rules = getFrameworkDiscoveryRules("nextjs");
      const patterns = getContextualPatternsForTask(rules, ["sidebar", "nav", "menu"]);

      const uniquePatterns = [...new Set(patterns)];
      assert.equal(patterns.length, uniquePatterns.length);
    });

    it("should return NestJS contextual patterns for controller keyword", () => {
      const rules = getFrameworkDiscoveryRules("nestjs");
      const patterns = getContextualPatternsForTask(rules, ["controller"]);

      assert.ok(patterns.some((p) => p.includes("module")));
      assert.ok(patterns.some((p) => p.includes("service")));
    });
  });
});
