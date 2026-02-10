import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadGoals, loadGoalsByProject } from "./goals.js";

const SCHEMA_PATH = path.resolve("state", "schema.sql");

function createTestDb(): BetterSqlite3.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  db.exec("ALTER TABLE goals ADD COLUMN project_id TEXT");
  return db;
}

function insertGoal(
  db: BetterSqlite3.Database,
  title: string,
  projectId: string,
  status = "active",
  priority = 10,
): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO goals (id, title, description, status, priority, project_id) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, title, `Test goal: ${title}`, status, priority, projectId);
  return id;
}

describe("state/goals", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("loadGoals", () => {
    it("should return all active goals regardless of project", () => {
      insertGoal(db, "Goal A", "project-a");
      insertGoal(db, "Goal B", "project-b");
      insertGoal(db, "Goal C", "project-a", "completed");

      const goals = loadGoals(db);
      assert.equal(goals.length, 2);
    });

    it("should return empty array when no active goals", () => {
      insertGoal(db, "Done", "default", "completed");
      const goals = loadGoals(db);
      assert.equal(goals.length, 0);
    });

    it("should order by priority DESC", () => {
      insertGoal(db, "Low priority", "default", "active", 1);
      insertGoal(db, "High priority", "default", "active", 100);

      const goals = loadGoals(db);
      assert.equal(goals[0].title, "High priority");
      assert.equal(goals[1].title, "Low priority");
    });
  });

  describe("loadGoalsByProject", () => {
    it("should return only goals for the specified project", () => {
      insertGoal(db, "Goal A", "project-a");
      insertGoal(db, "Goal B", "project-b");
      insertGoal(db, "Goal C", "project-a");

      const goals = loadGoalsByProject(db, "project-a");
      assert.equal(goals.length, 2);
      assert.ok(goals.every((g) => g.project_id === "project-a"));
    });

    it("should not include inactive goals", () => {
      insertGoal(db, "Active", "project-a", "active");
      insertGoal(db, "Done", "project-a", "completed");

      const goals = loadGoalsByProject(db, "project-a");
      assert.equal(goals.length, 1);
      assert.equal(goals[0].title, "Active");
    });

    it("should return empty array for project with no goals", () => {
      insertGoal(db, "Other", "project-b");
      const goals = loadGoalsByProject(db, "project-a");
      assert.equal(goals.length, 0);
    });

    it("should order by priority DESC within project", () => {
      insertGoal(db, "Low", "project-a", "active", 1);
      insertGoal(db, "High", "project-a", "active", 50);

      const goals = loadGoalsByProject(db, "project-a");
      assert.equal(goals[0].title, "High");
      assert.equal(goals[1].title, "Low");
    });

    it("should isolate goals between projects", () => {
      insertGoal(db, "A1", "project-a");
      insertGoal(db, "A2", "project-a");
      insertGoal(db, "B1", "project-b");

      const goalsA = loadGoalsByProject(db, "project-a");
      const goalsB = loadGoalsByProject(db, "project-b");

      assert.equal(goalsA.length, 2);
      assert.equal(goalsB.length, 1);
      assert.equal(goalsB[0].title, "B1");
    });
  });
});
