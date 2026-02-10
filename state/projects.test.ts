import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  saveProject,
  getActiveProject,
  getAllProjects,
  getProjectById,
  updateProjectStatus,
  getProjectTokenUsage,
  incrementProjectTokens,
  syncProjectsFromManifests,
} from "./projects.js";
import type { ProjectManifest } from "../projects/manifest.schema.js";

const SCHEMA_PATH = path.resolve("state", "schema.sql");

function createTestDb(): BetterSqlite3.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
}

const DEFAULT_MANIFEST: ProjectManifest = {
  projectId: "test-project",
  repoSource: "https://github.com/org/test",
  stack: { language: "typescript", framework: "node" },
  riskProfile: "medium",
  autonomyLevel: 2,
  tokenBudgetMonthly: 100000,
  status: "active",
};

describe("state/projects", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("saveProject", () => {
    it("should insert a new project from manifest", () => {
      saveProject(db, DEFAULT_MANIFEST);
      const project = getProjectById(db, "test-project");

      assert.ok(project);
      assert.equal(project.project_id, "test-project");
      assert.equal(project.repo_source, "https://github.com/org/test");
      assert.equal(project.language, "typescript");
      assert.equal(project.framework, "node");
      assert.equal(project.risk_profile, "medium");
      assert.equal(project.autonomy_level, 2);
      assert.equal(project.token_budget_monthly, 100000);
      assert.equal(project.status, "active");
      assert.equal(project.tokens_used_month, 0);
    });

    it("should update an existing project on second save", () => {
      saveProject(db, DEFAULT_MANIFEST);
      saveProject(db, { ...DEFAULT_MANIFEST, tokenBudgetMonthly: 200000, status: "paused" });

      const project = getProjectById(db, "test-project");
      assert.ok(project);
      assert.equal(project.token_budget_monthly, 200000);
      assert.equal(project.status, "paused");
    });
  });

  describe("getActiveProject", () => {
    it("should return null when no projects exist", () => {
      const result = getActiveProject(db);
      assert.equal(result, null);
    });

    it("should return the active project", () => {
      saveProject(db, DEFAULT_MANIFEST);
      const result = getActiveProject(db);

      assert.ok(result);
      assert.equal(result.project_id, "test-project");
    });

    it("should not return paused projects", () => {
      saveProject(db, { ...DEFAULT_MANIFEST, status: "paused" });
      const result = getActiveProject(db);
      assert.equal(result, null);
    });

    it("should return first by creation when multiple active", () => {
      saveProject(db, DEFAULT_MANIFEST);
      saveProject(db, { ...DEFAULT_MANIFEST, projectId: "other-project" });
      const result = getActiveProject(db);

      assert.ok(result);
      assert.equal(result.project_id, "test-project");
    });
  });

  describe("getAllProjects", () => {
    it("should return empty array when no projects", () => {
      const result = getAllProjects(db);
      assert.equal(result.length, 0);
    });

    it("should return all projects ordered by status and creation", () => {
      saveProject(db, DEFAULT_MANIFEST);
      saveProject(db, { ...DEFAULT_MANIFEST, projectId: "paused-project", status: "paused" });

      const result = getAllProjects(db);
      assert.equal(result.length, 2);
    });
  });

  describe("updateProjectStatus", () => {
    it("should change project status", () => {
      saveProject(db, DEFAULT_MANIFEST);
      updateProjectStatus(db, "test-project", "maintenance");

      const project = getProjectById(db, "test-project");
      assert.ok(project);
      assert.equal(project.status, "maintenance");
    });
  });

  describe("getProjectTokenUsage / incrementProjectTokens", () => {
    it("should return 0 for new project", () => {
      saveProject(db, DEFAULT_MANIFEST);
      const usage = getProjectTokenUsage(db, "test-project");
      assert.equal(usage, 0);
    });

    it("should increment token usage", () => {
      saveProject(db, DEFAULT_MANIFEST);
      incrementProjectTokens(db, "test-project", 500);
      incrementProjectTokens(db, "test-project", 300);

      const usage = getProjectTokenUsage(db, "test-project");
      assert.equal(usage, 800);
    });

    it("should return 0 for non-existent project", () => {
      const usage = getProjectTokenUsage(db, "nonexistent");
      assert.equal(usage, 0);
    });
  });

  describe("syncProjectsFromManifests", () => {
    it("should sync multiple manifests", () => {
      const manifests: ProjectManifest[] = [
        DEFAULT_MANIFEST,
        { ...DEFAULT_MANIFEST, projectId: "second-project", status: "paused" },
      ];

      syncProjectsFromManifests(db, manifests);

      const all = getAllProjects(db);
      assert.equal(all.length, 2);
    });

    it("should handle empty manifests array", () => {
      syncProjectsFromManifests(db, []);
      const all = getAllProjects(db);
      assert.equal(all.length, 0);
    });

    it("should update existing projects on re-sync", () => {
      saveProject(db, DEFAULT_MANIFEST);
      syncProjectsFromManifests(db, [{ ...DEFAULT_MANIFEST, tokenBudgetMonthly: 999999 }]);

      const project = getProjectById(db, "test-project");
      assert.ok(project);
      assert.equal(project.token_budget_monthly, 999999);
    });
  });
});
