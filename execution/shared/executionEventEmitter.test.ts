import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ExecutionEventEmitter, createEventEmitter } from "./executionEventEmitter.js";

const SCHEMA_PATH = path.resolve(import.meta.dirname, "../../state/schema.sql");

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
}

function getEventCount(db: InstanceType<typeof Database>, traceId: string): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM execution_events WHERE trace_id = ?").get(traceId) as { count: number };
  return row.count;
}

function getLastEvent(db: InstanceType<typeof Database>, traceId: string): Record<string, unknown> {
  return db.prepare("SELECT * FROM execution_events WHERE trace_id = ? ORDER BY id DESC LIMIT 1").get(traceId) as Record<string, unknown>;
}

describe("ExecutionEventEmitter", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("createEventEmitter", () => {
    it("should create an emitter with the given traceId", () => {
      const emitter = createEventEmitter(db, "trace-abc");
      assert.equal(emitter.getTraceId(), "trace-abc");
    });
  });

  describe("emit", () => {
    it("should insert an event into execution_events table", () => {
      const emitter = new ExecutionEventEmitter(db, "trace-001");
      emitter.emit("forge", "delegation:start", "Started");

      assert.equal(getEventCount(db, "trace-001"), 1);
    });

    it("should store agent, eventType, and message", () => {
      const emitter = new ExecutionEventEmitter(db, "trace-002");
      emitter.emit("kairos", "cycle:start", "Cycle started");

      const event = getLastEvent(db, "trace-002");
      assert.equal(event.agent, "kairos");
      assert.equal(event.event_type, "cycle:start");
      assert.equal(event.message, "Cycle started");
    });

    it("should store optional phase and metadata", () => {
      const emitter = new ExecutionEventEmitter(db, "trace-003");
      emitter.emit("forge", "forge:cli_spawned", "Spawning CLI", {
        phase: "cli_execution",
        metadata: { model: "sonnet", maxTurns: 25 },
      });

      const event = getLastEvent(db, "trace-003");
      assert.equal(event.phase, "cli_execution");

      const metadata = JSON.parse(event.metadata as string) as Record<string, unknown>;
      assert.equal(metadata.model, "sonnet");
      assert.equal(metadata.maxTurns, 25);
    });

    it("should store custom level", () => {
      const emitter = new ExecutionEventEmitter(db, "trace-004");
      emitter.emit("forge", "forge:validation_failed", "Lint failed", {
        level: "warn",
      });

      const event = getLastEvent(db, "trace-004");
      assert.equal(event.level, "warn");
    });
  });

  describe("info", () => {
    it("should emit with info level", () => {
      const emitter = new ExecutionEventEmitter(db, "trace-info");
      emitter.info("kairos", "cycle:start", "Cycle started");

      const event = getLastEvent(db, "trace-info");
      assert.equal(event.level, "info");
    });
  });

  describe("warn", () => {
    it("should emit with warn level", () => {
      const emitter = new ExecutionEventEmitter(db, "trace-warn");
      emitter.warn("forge", "forge:cost_ceiling_reached", "Cost ceiling reached");

      const event = getLastEvent(db, "trace-warn");
      assert.equal(event.level, "warn");
    });
  });

  describe("error", () => {
    it("should emit with error level", () => {
      const emitter = new ExecutionEventEmitter(db, "trace-err");
      emitter.error("forge", "delegation:failed", "Execution failed");

      const event = getLastEvent(db, "trace-err");
      assert.equal(event.level, "error");
    });
  });

  describe("error handling", () => {
    it("should not throw when emit fails", () => {
      db.close();
      const emitter = new ExecutionEventEmitter(db, "trace-closed");

      assert.doesNotThrow(() => {
        emitter.emit("forge", "test", "should not throw");
      });
    });
  });

  describe("multiple events", () => {
    it("should emit multiple events in sequence", () => {
      const emitter = new ExecutionEventEmitter(db, "trace-multi");

      emitter.info("kairos", "cycle:start", "Cycle started");
      emitter.info("forge", "delegation:start", "FORGE started");
      emitter.info("forge", "forge:cli_spawned", "CLI spawned");
      emitter.info("forge", "forge:cli_completed", "CLI completed");
      emitter.info("kairos", "cycle:end", "Cycle ended");

      assert.equal(getEventCount(db, "trace-multi"), 5);
    });
  });
});
