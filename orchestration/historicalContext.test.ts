import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildHistoricalContext } from "./historicalContext.js";

const SCHEMA_PATH = path.resolve("state", "schema.sql");

function createTestDb(): BetterSqlite3.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
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

function insertOutcome(
  db: BetterSqlite3.Database,
  agentId: string,
  task: string,
  status: "success" | "failed",
  error?: string,
): void {
  db.prepare(
    `INSERT INTO outcomes (id, agent_id, task, status, error)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), agentId, task, status, error ?? null);
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

describe("orchestration/historicalContext", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("buildHistoricalContext", () => {
    it("should return empty string when no executions exist", () => {
      const result = buildHistoricalContext(db, "forge");
      assert.equal(result, "");
    });

    it("should include HISTORICO header when data exists", () => {
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");

      const result = buildHistoricalContext(db, "forge");
      assert.ok(result.startsWith("HISTORICO:"));
    });

    it("should include agent summary line with success rate", () => {
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");
      insertFeedback(db, "forge", "ui-edit", "FAILURE");

      const result = buildHistoricalContext(db, "forge");
      assert.ok(result.includes("FORGE:"));
      assert.ok(result.includes("50%"));
      assert.ok(result.includes("2 exec"));
    });

    it("should include problematic tasks when failures are recurrent", () => {
      insertFeedback(db, "forge", "remover-signatarios", "FAILURE", ["lint error"]);
      insertFeedback(db, "forge", "remover-signatarios", "FAILURE", ["lint error"]);
      insertFeedback(db, "forge", "remover-signatarios", "FAILURE", ["lint error"]);

      const result = buildHistoricalContext(db, "forge");
      assert.ok(result.includes("Tasks problematicas"));
      assert.ok(result.includes("remover-signatarios"));
    });

    it("should include frequent files when code changes exist", () => {
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");
      insertCodeChange(db, "ui-edit", ["src/sidebar.tsx", "src/app.tsx"], 2, "applied");
      insertCodeChange(db, "ui-edit-2", ["src/sidebar.tsx"], 1, "applied");

      const result = buildHistoricalContext(db, "forge");
      assert.ok(result.includes("Arquivos frequentes"));
      assert.ok(result.includes("sidebar.tsx"));
    });

    it("should include recent executions from outcomes", () => {
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");
      insertOutcome(db, "forge", "remover sidebar", "success");
      insertOutcome(db, "forge", "adicionar teste", "failed", "lint failed");

      const result = buildHistoricalContext(db, "forge");
      assert.ok(result.includes("Ultimas execucoes"));
      assert.ok(result.includes("remover sidebar"));
      assert.ok(result.includes("SUCCESS"));
      assert.ok(result.includes("adicionar teste"));
      assert.ok(result.includes("FAILURE"));
    });

    it("should respect maxChars limit", () => {
      for (let i = 0; i < 20; i++) {
        insertFeedback(db, "forge", `task-type-${i}`, i % 2 === 0 ? "SUCCESS" : "FAILURE");
        insertOutcome(db, "forge", `very long task name that is quite descriptive ${i}`, "success");
      }

      const result = buildHistoricalContext(db, "forge", 7, 200);
      assert.ok(result.length <= 200);
    });

    it("should not include data from other agents", () => {
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");
      insertFeedback(db, "vector", "content-draft", "FAILURE");

      const result = buildHistoricalContext(db, "forge");
      assert.ok(!result.includes("content-draft"));
    });

    it("should produce a complete formatted block", () => {
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");
      insertFeedback(db, "forge", "ui-edit", "SUCCESS");
      insertFeedback(db, "forge", "ui-edit", "FAILURE", ["search string not found"]);
      insertFeedback(db, "forge", "ui-edit", "FAILURE", ["search string not found"]);
      insertOutcome(db, "forge", "remover sidebar", "success");
      insertOutcome(db, "forge", "adicionar teste", "failed", "lint failed");
      insertCodeChange(db, "ui-edit", ["src/sidebar.tsx"], 3, "applied");

      const result = buildHistoricalContext(db, "forge");

      assert.ok(result.includes("HISTORICO:"));
      assert.ok(result.includes("FORGE:"));
      assert.ok(result.includes("50%"));
      assert.ok(result.includes("4 exec"));
      assert.ok(result.includes("Tasks problematicas"));
      assert.ok(result.includes("Arquivos frequentes"));
      assert.ok(result.includes("Ultimas execucoes"));
    });
  });
});
