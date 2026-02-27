import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  emitExecutionEvent,
  getEventsSince,
  getEventsByTraceId,
  getRecentTraces,
  cleanupOldEvents,
} from "./executionEvents.js";

const SCHEMA_PATH = path.resolve(import.meta.dirname, "schema.sql");

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
}

describe("executionEvents", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("emitExecutionEvent", () => {
    it("should insert an event and return the id", () => {
      const id = emitExecutionEvent(db, {
        traceId: "trace-001",
        agent: "forge",
        eventType: "delegation:start",
        message: "FORGE execution started",
      });

      assert.equal(typeof id, "number");
      assert.ok(id > 0);
    });

    it("should store all fields correctly", () => {
      emitExecutionEvent(db, {
        traceId: "trace-002",
        agent: "kairos",
        eventType: "cycle:start",
        message: "Cycle started",
        phase: "orchestration",
        metadata: { projectId: "my-project" },
        level: "info",
      });

      const rows = db.prepare("SELECT * FROM execution_events WHERE trace_id = ?").all("trace-002") as readonly Record<string, unknown>[];
      assert.equal(rows.length, 1);

      const row = rows[0];
      assert.equal(row.agent, "kairos");
      assert.equal(row.event_type, "cycle:start");
      assert.equal(row.phase, "orchestration");
      assert.equal(row.message, "Cycle started");
      assert.equal(row.level, "info");

      const metadata = JSON.parse(row.metadata as string) as Record<string, unknown>;
      assert.equal(metadata.projectId, "my-project");
    });

    it("should default level to info", () => {
      emitExecutionEvent(db, {
        traceId: "trace-003",
        agent: "forge",
        eventType: "test",
        message: "test",
      });

      const rows = db.prepare("SELECT level FROM execution_events WHERE trace_id = ?").all("trace-003") as readonly Record<string, unknown>[];
      assert.equal(rows[0].level, "info");
    });

    it("should store null for optional fields", () => {
      emitExecutionEvent(db, {
        traceId: "trace-004",
        agent: "forge",
        eventType: "test",
        message: "test",
      });

      const rows = db.prepare("SELECT phase, metadata FROM execution_events WHERE trace_id = ?").all("trace-004") as readonly Record<string, unknown>[];
      assert.equal(rows[0].phase, null);
      assert.equal(rows[0].metadata, null);
    });
  });

  describe("getEventsSince", () => {
    it("should return events with id greater than lastId", () => {
      emitExecutionEvent(db, { traceId: "t1", agent: "kairos", eventType: "e1", message: "m1" });
      const id2 = emitExecutionEvent(db, { traceId: "t1", agent: "forge", eventType: "e2", message: "m2" });
      emitExecutionEvent(db, { traceId: "t1", agent: "vector", eventType: "e3", message: "m3" });

      const events = getEventsSince(db, id2 - 1);
      assert.ok(events.length >= 2);
      assert.ok(events.every((e) => e.id >= id2));
    });

    it("should filter by traceId", () => {
      emitExecutionEvent(db, { traceId: "t1", agent: "kairos", eventType: "e1", message: "m1" });
      emitExecutionEvent(db, { traceId: "t2", agent: "forge", eventType: "e2", message: "m2" });

      const events = getEventsSince(db, 0, { traceId: "t1" });
      assert.equal(events.length, 1);
      assert.equal(events[0].trace_id, "t1");
    });

    it("should respect limit", () => {
      for (let i = 0; i < 10; i++) {
        emitExecutionEvent(db, { traceId: "t1", agent: "forge", eventType: `e${i}`, message: `m${i}` });
      }

      const events = getEventsSince(db, 0, { limit: 3 });
      assert.equal(events.length, 3);
    });
  });

  describe("getEventsByTraceId", () => {
    it("should return all events for a trace ordered by id", () => {
      emitExecutionEvent(db, { traceId: "t1", agent: "kairos", eventType: "e1", message: "m1" });
      emitExecutionEvent(db, { traceId: "t1", agent: "forge", eventType: "e2", message: "m2" });
      emitExecutionEvent(db, { traceId: "t2", agent: "nexus", eventType: "e3", message: "m3" });

      const events = getEventsByTraceId(db, "t1");
      assert.equal(events.length, 2);
      assert.ok(events[0].id < events[1].id);
    });

    it("should return empty array for unknown trace", () => {
      const events = getEventsByTraceId(db, "unknown");
      assert.equal(events.length, 0);
    });
  });

  describe("getRecentTraces", () => {
    it("should return trace summaries ordered by most recent", () => {
      emitExecutionEvent(db, { traceId: "t1", agent: "kairos", eventType: "e1", message: "m1" });
      emitExecutionEvent(db, { traceId: "t1", agent: "forge", eventType: "e2", message: "m2" });
      emitExecutionEvent(db, { traceId: "t2", agent: "kairos", eventType: "e3", message: "m3" });

      const traces = getRecentTraces(db);
      assert.ok(traces.length >= 2);

      const t2Trace = traces.find((t) => t.trace_id === "t2");
      assert.ok(t2Trace);
      assert.equal(t2Trace.event_count, 1);
    });

    it("should indicate errors in traces", () => {
      emitExecutionEvent(db, {
        traceId: "t-error",
        agent: "forge",
        eventType: "delegation:failed",
        message: "Failed",
        level: "error",
      });

      const traces = getRecentTraces(db);
      const errorTrace = traces.find((t) => t.trace_id === "t-error");
      assert.ok(errorTrace);
      assert.equal(errorTrace.has_errors, 1);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        emitExecutionEvent(db, { traceId: `t${i}`, agent: "forge", eventType: "e", message: "m" });
      }

      const traces = getRecentTraces(db, 2);
      assert.equal(traces.length, 2);
    });
  });

  describe("cleanupOldEvents", () => {
    it("should not delete recent events", () => {
      emitExecutionEvent(db, { traceId: "t1", agent: "forge", eventType: "e1", message: "m1" });

      const deleted = cleanupOldEvents(db, 30);
      assert.equal(deleted, 0);

      const events = getEventsByTraceId(db, "t1");
      assert.equal(events.length, 1);
    });
  });
});
