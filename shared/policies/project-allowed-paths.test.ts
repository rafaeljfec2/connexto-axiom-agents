import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getAllowedWritePaths,
  getForbiddenPaths,
  getWritePolicy,
} from "./project-allowed-paths.js";

describe("project-allowed-paths", () => {
  describe("getAllowedWritePaths", () => {
    it("should return paths for nestjs framework", () => {
      const paths = getAllowedWritePaths({ language: "typescript", framework: "nestjs" });
      assert.ok(paths.includes("src/"));
      assert.ok(paths.includes("test/"));
    });

    it("should return paths for nestjs-nextjs-turbo framework", () => {
      const paths = getAllowedWritePaths({ language: "typescript", framework: "nestjs-nextjs-turbo" });
      assert.ok(paths.includes("apps/"));
      assert.ok(paths.includes("packages/"));
      assert.ok(paths.includes("src/"));
    });

    it("should return paths for nextjs framework", () => {
      const paths = getAllowedWritePaths({ language: "typescript", framework: "nextjs" });
      assert.ok(paths.includes("app/"));
      assert.ok(paths.includes("components/"));
      assert.ok(paths.includes("pages/"));
    });

    it("should return default paths for unknown framework", () => {
      const paths = getAllowedWritePaths({ language: "go", framework: "unknown" });
      assert.ok(paths.includes("src/"));
      assert.ok(paths.length > 5);
    });

    it("should return paths for react framework", () => {
      const paths = getAllowedWritePaths({ language: "typescript", framework: "react" });
      assert.ok(paths.includes("src/"));
      assert.ok(paths.includes("components/"));
      assert.ok(paths.includes("hooks/"));
    });
  });

  describe("getForbiddenPaths", () => {
    it("should include .git and node_modules", () => {
      const forbidden = getForbiddenPaths();
      assert.ok(forbidden.includes(".git/"));
      assert.ok(forbidden.includes("node_modules/"));
    });

    it("should include .env files", () => {
      const forbidden = getForbiddenPaths();
      assert.ok(forbidden.includes(".env"));
      assert.ok(forbidden.includes(".env.production"));
    });

    it("should include infrastructure files", () => {
      const forbidden = getForbiddenPaths();
      assert.ok(forbidden.includes("docker/"));
      assert.ok(forbidden.includes("Dockerfile"));
    });
  });

  describe("getWritePolicy", () => {
    it("should return both allowed and forbidden paths", () => {
      const policy = getWritePolicy({ language: "typescript", framework: "nestjs" });
      assert.ok(policy.allowed.length > 0);
      assert.ok(policy.forbidden.length > 0);
    });

    it("should never overlap allowed and forbidden", () => {
      const policy = getWritePolicy({ language: "typescript", framework: "nextjs" });
      for (const allowed of policy.allowed) {
        assert.ok(!policy.forbidden.includes(allowed), `${allowed} should not be in both lists`);
      }
    });
  });
});
