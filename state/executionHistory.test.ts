import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  getExecutionHistory,
  getAgentSummary,
  getTaskTypeAggregates,
  getFrequentFiles,
  getRecurrentFailurePatterns,
  getFullExecutionHistoryContext,
} from "./executionHistory.js";

const SCHEMA_PATH = path.resolve("state", "schema.sql");

function createTestDb(): BetterSqlite3.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
}

function insertOutcome(
  db: BetterSqlite3.Database,
  agentId: string,
  task: string,
  status: "success" | "failed",
  error?: string,
  tokensUsed?: number,
  executionTimeMs?: number,
): void {
  db.prepare(
    `INSERT INTO outcomes (id, agent_id, task, status, error, tokens_used, execution_time_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), agentId, task, status, error ?? null, tokensUsed ?? null, executionTimeMs ?? null);
}

function insertFeedback(
  db: BetterSqlite3.Database,
  agentId: string,
  taskType: string,
  grade: "SUCCESS" | "PARTIAL" | "FAILURE",
  reasons?: readonly string[],
): void {
  db.prepare(
    "INSERT INTO agent_feedback (id, agent_id, task_type, grade, reasons) VALUES (?, ?, ?, ?, ?)",
  ).run(
    crypto.randomUUID(),
    agentId,
    taskType,
    grade,
    reasons && reasons.length > 0 ? JSON.stringify(reasons) : null,
  );
}

function insertCodeChange(
  db: BetterSqlite3.Database,
  taskId: string,
  filesChanged: readonly string[],
  risk: number,
  status: string,
): void {
  db.prepare(
    `INSERT INTO code_changes (id, task_id, description, files_changed, risk, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), taskId, `Test: ${taskId}`, JSON.stringify(filesChanged), risk, status);
}

describe("state/executionHistory", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("getExecutionHistory", () => {
    it("should return empty array when no outcomes exist", () => {
      const result = getExecutionHistory(db, "forge");
      assert.equal(result.length, 0);
    });

    it("should return recent executions ordered by date", () => {
      db.prepare(
        `INSERT INTO outcomes (id, agent_id, task, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(crypto.randomUUID(), "forge", "task-a", "success", null, "2026-02-01T10:00:00.000Z");
      db.prepare(
        `INSERT INTO outcomes (id, agent_id, task, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(crypto.randomUUID(), "forge", "task-b", "failed", "lint error", "2026-02-02T10:00:00.000Z");
      db.prepare(
        `INSERT INTO outcomes (id, agent_id, task, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(crypto.randomUUID(), "forge", "task-c", "success", null, "2026-02-03T10:00:00.000Z");

      const result = getExecutionHistory(db, "forge", 30, 10);
      assert.equal(result.length, 3);
      assert.equal(result[0].task, "task-c");
      assert.equal(result[1].task, "task-b");
      assert.equal(result[1].error, "lint error");
    });

    it("should respect limit parameter", () => {
      insertOutcome(db, "forge", "task-a", "success");
      insertOutcome(db, "forge", "task-b", "success");
      insertOutcome(db, "forge", "task-c", "success");

      const result = getExecutionHistory(db, "forge", 7, 2);
      assert.equal(result.length, 2);
    });

    it("should filter by agent id", () => {
      insertOutcome(db, "forge", "task-a", "success");
      insertOutcome(db, "vector", "task-b", "success");

      const result = getExecutionHistory(db, "forge");
      assert.equal(result.length, 1);
      assert.equal(result[0].task, "task-a");
    });

    it("should truncate long error messages", () => {
      const longError = "a".repeat(200);
      insertOutcome(db, "forge", "task-a", "failed", longError);

      const result = getExecutionHistory(db, "forge");
      assert.equal(result.length, 1);
      const errorText = result[0].error ?? "";
      assert.ok(errorText.length <= 60);
      assert.ok(errorText.endsWith("..."));
    });
  });

  describe("getAgentSummary", () => {
    it("should return zero values when no feedback exists", () => {
      const result = getAgentSummary(db, "forge");
      assert.equal(result.totalExecutions, 0);
      assert.equal(result.successRate, 0);
    });

    it("should calculate correct success rate", () => {
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");
      insertFeedback(db, "forge", "ui-edit", "FAILURE");
      insertFeedback(db, "forge", "refactor", "PARTIAL");

      const result = getAgentSummary(db, "forge");
      assert.equal(result.totalExecutions, 4);
      assert.equal(result.successRate, 50);
    });
  });

  describe("getTaskTypeAggregates", () => {
    it("should return empty array when no feedback exists", () => {
      const result = getTaskTypeAggregates(db, "forge");
      assert.equal(result.length, 0);
    });

    it("should aggregate by task type with correct stats", () => {
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");
      insertFeedback(db, "forge", "ui-edit", "FAILURE", ["lint error"]);
      insertFeedback(db, "forge", "ui-edit", "FAILURE", ["lint error"]);
      insertFeedback(db, "forge", "test-addition", "SUCCESS");

      const result = getTaskTypeAggregates(db, "forge");
      assert.equal(result.length, 2);

      const uiEdit = result.find((a) => a.taskType === "ui-edit");
      assert.ok(uiEdit);
      assert.equal(uiEdit.totalExecutions, 3);
      assert.equal(uiEdit.successCount, 1);
      assert.equal(uiEdit.failureCount, 2);
      assert.ok(uiEdit.successRate > 33 && uiEdit.successRate < 34);

      const testAdd = result.find((a) => a.taskType === "test-addition");
      assert.ok(testAdd);
      assert.equal(testAdd.totalExecutions, 1);
      assert.equal(testAdd.successRate, 100);
    });

    it("should detect recurrent errors in task type aggregates", () => {
      insertFeedback(db, "forge", "ui-edit", "FAILURE", ["lint error"]);
      insertFeedback(db, "forge", "ui-edit", "FAILURE", ["lint error"]);

      const result = getTaskTypeAggregates(db, "forge");
      const uiEdit = result.find((a) => a.taskType === "ui-edit");
      assert.ok(uiEdit);
      assert.ok(uiEdit.recurrentErrors.length > 0);
      assert.ok(uiEdit.recurrentErrors[0].includes("lint error"));
    });
  });

  describe("getFrequentFiles", () => {
    it("should return empty array when no code changes exist", () => {
      const result = getFrequentFiles(db);
      assert.equal(result.length, 0);
    });

    it("should return files sorted by frequency", () => {
      insertCodeChange(db, "task-a", ["src/sidebar.tsx", "src/app.tsx"], 2, "applied");
      insertCodeChange(db, "task-b", ["src/sidebar.tsx", "src/header.tsx"], 3, "applied");
      insertCodeChange(db, "task-c", ["src/sidebar.tsx"], 1, "applied");

      const result = getFrequentFiles(db);
      assert.ok(result.length > 0);
      assert.equal(result[0], "src/sidebar.tsx");
    });

    it("should respect limit parameter", () => {
      insertCodeChange(db, "task-a", ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"], 1, "applied");

      const result = getFrequentFiles(db, 7, 3);
      assert.ok(result.length <= 3);
    });

    it("should only count applied or pending_approval changes", () => {
      insertCodeChange(db, "task-a", ["src/good.tsx"], 1, "applied");
      insertCodeChange(db, "task-b", ["src/failed.tsx"], 2, "failed");

      const result = getFrequentFiles(db);
      assert.ok(result.includes("src/good.tsx"));
      assert.ok(!result.includes("src/failed.tsx"));
    });
  });

  describe("getRecurrentFailurePatterns", () => {
    it("should return empty array when no failures exist", () => {
      const result = getRecurrentFailurePatterns(db, "forge");
      assert.equal(result.length, 0);
    });

    it("should detect recurrent errors across outcomes", () => {
      insertOutcome(db, "forge", "task-a", "failed", "Search string not found");
      insertOutcome(db, "forge", "task-b", "failed", "Search string not found");
      insertOutcome(db, "forge", "task-c", "failed", "Search string not found");
      insertOutcome(db, "forge", "task-d", "failed", "timeout exceeded");

      const result = getRecurrentFailurePatterns(db, "forge");
      assert.ok(result.length > 0);
      assert.ok(result[0].includes("Search string not found"));
      assert.ok(result[0].includes("3x"));
    });
  });

  describe("getFullExecutionHistoryContext", () => {
    it("should return complete context with all sections", () => {
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");
      insertFeedback(db, "forge", "ui-edit", "FAILURE", ["lint error"]);
      insertOutcome(db, "forge", "task-a", "success");
      insertCodeChange(db, "task-a", ["src/sidebar.tsx"], 2, "applied");

      const context = getFullExecutionHistoryContext(db, "forge");

      assert.ok(context.agentSummary);
      assert.equal(context.agentSummary.totalExecutions, 2);
      assert.ok(context.taskAggregates.length > 0);
      assert.ok(context.recentExecutions.length > 0);
      assert.ok(context.frequentFiles.length > 0);
    });

    it("should return empty context for agent with no data", () => {
      const context = getFullExecutionHistoryContext(db, "nexus");

      assert.equal(context.agentSummary.totalExecutions, 0);
      assert.equal(context.agentSummary.successRate, 0);
      assert.equal(context.taskAggregates.length, 0);
      assert.equal(context.recentExecutions.length, 0);
      assert.equal(context.frequentFiles.length, 0);
    });
  });
});
