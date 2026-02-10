import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateProjectFilePaths,
  sanitizeWorkspacePath,
  ProjectSecurityError,
} from "./projectSecurity.js";

const WORKSPACE = "/tmp/test-workspace";

describe("projectSecurity", () => {
  describe("validateProjectFilePaths", () => {
    it("should accept valid paths in allowed directories", () => {
      const result = validateProjectFilePaths(
        [{ path: "src/components/Button.tsx", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it("should accept paths in apps/ directory", () => {
      const result = validateProjectFilePaths(
        [{ path: "apps/web/src/layout.tsx", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, true);
    });

    it("should accept paths in packages/ directory", () => {
      const result = validateProjectFilePaths(
        [{ path: "packages/shared/src/utils.ts", action: "create", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, true);
    });

    it("should reject absolute paths", () => {
      const result = validateProjectFilePaths(
        [{ path: "/etc/passwd", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("Absolute path"));
    });

    it("should reject path traversal", () => {
      const result = validateProjectFilePaths(
        [{ path: "../../../etc/passwd", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("traversal"));
    });

    it("should reject .git paths", () => {
      const result = validateProjectFilePaths(
        [{ path: ".git/config", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("Forbidden"));
    });

    it("should reject node_modules paths", () => {
      const result = validateProjectFilePaths(
        [{ path: "node_modules/lodash/index.js", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, false);
    });

    it("should reject .env files", () => {
      const result = validateProjectFilePaths(
        [{ path: ".env", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, false);
    });

    it("should reject .env.production", () => {
      const result = validateProjectFilePaths(
        [{ path: ".env.production", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, false);
    });

    it("should reject certificate files", () => {
      const result = validateProjectFilePaths(
        [{ path: "src/certs/server.pem", action: "create", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes("Forbidden extension"));
    });

    it("should reject Dockerfile", () => {
      const result = validateProjectFilePaths(
        [{ path: "Dockerfile", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, false);
    });

    it("should reject docker-compose.yml", () => {
      const result = validateProjectFilePaths(
        [{ path: "docker-compose.yml", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, false);
    });

    it("should flag files outside standard directories as requiring approval", () => {
      const result = validateProjectFilePaths(
        [{ path: "config/database.ts", action: "modify", content: "" }],
        WORKSPACE,
      );
      assert.equal(result.valid, true);
      assert.equal(result.requiresApproval, true);
    });

    it("should validate multiple files and report all errors", () => {
      const result = validateProjectFilePaths(
        [
          { path: "src/valid.ts", action: "create", content: "" },
          { path: "/etc/bad", action: "modify", content: "" },
          { path: ".git/config", action: "modify", content: "" },
        ],
        WORKSPACE,
      );
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 2);
    });
  });

  describe("sanitizeWorkspacePath", () => {
    it("should resolve relative paths within workspace", () => {
      const result = sanitizeWorkspacePath(WORKSPACE, "src/index.ts");
      assert.ok(result.startsWith(WORKSPACE));
      assert.ok(result.endsWith("src/index.ts"));
    });

    it("should throw on absolute paths", () => {
      assert.throws(
        () => sanitizeWorkspacePath(WORKSPACE, "/etc/passwd"),
        ProjectSecurityError,
      );
    });

    it("should throw on path traversal", () => {
      assert.throws(
        () => sanitizeWorkspacePath(WORKSPACE, "../../etc/passwd"),
        ProjectSecurityError,
      );
    });

    it("should throw on traversal that escapes workspace", () => {
      assert.throws(
        () => sanitizeWorkspacePath(WORKSPACE, "../outside/file.ts"),
        ProjectSecurityError,
      );
    });
  });
});
