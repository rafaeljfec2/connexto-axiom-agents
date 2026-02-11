import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  saveGovernanceDecision,
  getRecentGovernanceDecisions,
  getGovernanceStats,
} from "./governanceLog.js";
import type { GovernanceLogEntry } from "./governanceLog.js";

const SCHEMA_PATH = path.resolve("state", "schema.sql");

function createTestDb(): BetterSqlite3.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
}

function createEntry(overrides?: Partial<GovernanceLogEntry>): GovernanceLogEntry {
  return {
    cycleId: overrides?.cycleId ?? "cycle-001",
    complexity: overrides?.complexity ?? 2,
    risk: overrides?.risk ?? 2,
    cost: overrides?.cost ?? 1,
    historicalStability: overrides?.historicalStability ?? "stable",
    selectedModel: overrides?.selectedModel ?? "gpt-4o-mini",
    modelTier: overrides?.modelTier ?? "economy",
    nexusPreResearch: overrides?.nexusPreResearch ?? false,
    nexusResearchId: overrides?.nexusResearchId,
    humanApprovalRequired: overrides?.humanApprovalRequired ?? false,
    postValidationStatus: overrides?.postValidationStatus ?? "match",
    postValidationNotes: overrides?.postValidationNotes ?? "OK",
    reasons: overrides?.reasons ?? ["Historico estavel"],
    tokensUsed: overrides?.tokensUsed ?? 300,
  };
}

describe("state/governanceLog", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("saveGovernanceDecision", () => {
    it("should save a governance decision and return an id", () => {
      const entry = createEntry();
      const id = saveGovernanceDecision(db, entry);

      assert.ok(id.length > 0);
    });

    it("should persist all fields correctly", () => {
      const entry = createEntry({
        cycleId: "cycle-test-123",
        complexity: 4,
        risk: 3,
        cost: 2,
        historicalStability: "moderate",
        selectedModel: "gpt-4o",
        modelTier: "standard",
        nexusPreResearch: true,
        nexusResearchId: "research-001",
        humanApprovalRequired: false,
        postValidationStatus: "mismatch",
        postValidationNotes: "Risk exceeded pre-classification",
        reasons: ["Multiple goals", "Architectural change"],
        tokensUsed: 850,
      });

      saveGovernanceDecision(db, entry);
      const records = getRecentGovernanceDecisions(db, 1);

      assert.equal(records.length, 1);
      const record = records[0];
      assert.ok(record);
      assert.equal(record.cycle_id, "cycle-test-123");
      assert.equal(record.complexity, 4);
      assert.equal(record.risk, 3);
      assert.equal(record.cost, 2);
      assert.equal(record.historical_stability, "moderate");
      assert.equal(record.selected_model, "gpt-4o");
      assert.equal(record.model_tier, "standard");
      assert.equal(record.nexus_pre_research, 1);
      assert.equal(record.nexus_research_id, "research-001");
      assert.equal(record.human_approval_required, 0);
      assert.equal(record.post_validation_status, "mismatch");
      assert.equal(record.post_validation_notes, "Risk exceeded pre-classification");
      assert.equal(record.tokens_used, 850);

      const reasons = JSON.parse(record.reasons) as string[];
      assert.equal(reasons.length, 2);
      assert.ok(reasons.includes("Multiple goals"));
    });

    it("should handle null optional fields", () => {
      const entry: GovernanceLogEntry = {
        cycleId: "cycle-null-test",
        complexity: 1,
        risk: 1,
        cost: 1,
        historicalStability: "stable",
        selectedModel: "gpt-4o-mini",
        modelTier: "economy",
        nexusPreResearch: false,
        humanApprovalRequired: false,
        reasons: [],
      };

      const id = saveGovernanceDecision(db, entry);
      assert.ok(id.length > 0);

      const records = getRecentGovernanceDecisions(db, 1);
      assert.equal(records.length, 1);
      const record = records[0];
      assert.ok(record);
      assert.equal(record.nexus_research_id, null);
      assert.equal(record.post_validation_status, null);
      assert.equal(record.post_validation_notes, null);
      assert.equal(record.tokens_used, null);
    });
  });

  describe("getRecentGovernanceDecisions", () => {
    it("should return empty array when no decisions exist", () => {
      const records = getRecentGovernanceDecisions(db);
      assert.equal(records.length, 0);
    });

    it("should return decisions ordered by created_at desc", () => {
      saveGovernanceDecision(db, createEntry({ cycleId: "first" }));
      saveGovernanceDecision(db, createEntry({ cycleId: "second" }));
      saveGovernanceDecision(db, createEntry({ cycleId: "third" }));

      const records = getRecentGovernanceDecisions(db, 10);
      assert.equal(records.length, 3);
      assert.equal(records[0]?.cycle_id, "third");
    });

    it("should respect limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        saveGovernanceDecision(db, createEntry({ cycleId: `cycle-${i}` }));
      }

      const records = getRecentGovernanceDecisions(db, 2);
      assert.equal(records.length, 2);
    });
  });

  describe("getGovernanceStats", () => {
    it("should return zero stats when no decisions exist", () => {
      const stats = getGovernanceStats(db);

      assert.equal(stats.totalDecisions, 0);
      assert.equal(stats.economyCount, 0);
      assert.equal(stats.standardCount, 0);
      assert.equal(stats.premiumCount, 0);
      assert.equal(stats.nexusPreResearchCount, 0);
      assert.equal(stats.mismatchCount, 0);
    });

    it("should count decisions by model tier", () => {
      saveGovernanceDecision(db, createEntry({ modelTier: "economy" }));
      saveGovernanceDecision(db, createEntry({ modelTier: "economy" }));
      saveGovernanceDecision(db, createEntry({ modelTier: "standard" }));
      saveGovernanceDecision(db, createEntry({ modelTier: "premium" }));

      const stats = getGovernanceStats(db);

      assert.equal(stats.totalDecisions, 4);
      assert.equal(stats.economyCount, 2);
      assert.equal(stats.standardCount, 1);
      assert.equal(stats.premiumCount, 1);
    });

    it("should count nexus pre-research activations", () => {
      saveGovernanceDecision(db, createEntry({ nexusPreResearch: true }));
      saveGovernanceDecision(db, createEntry({ nexusPreResearch: false }));
      saveGovernanceDecision(db, createEntry({ nexusPreResearch: true }));

      const stats = getGovernanceStats(db);
      assert.equal(stats.nexusPreResearchCount, 2);
    });

    it("should count mismatches", () => {
      saveGovernanceDecision(db, createEntry({ postValidationStatus: "match" }));
      saveGovernanceDecision(db, createEntry({ postValidationStatus: "mismatch" }));
      saveGovernanceDecision(db, createEntry({ postValidationStatus: "escalation_needed" }));

      const stats = getGovernanceStats(db);
      assert.equal(stats.mismatchCount, 2);
    });

    it("should estimate tokens saved", () => {
      saveGovernanceDecision(db, createEntry({ modelTier: "economy", tokensUsed: 100 }));
      saveGovernanceDecision(db, createEntry({ modelTier: "economy", tokensUsed: 100 }));

      const stats = getGovernanceStats(db);
      assert.ok(stats.estimatedTokensSaved > 0);
    });
  });
});
