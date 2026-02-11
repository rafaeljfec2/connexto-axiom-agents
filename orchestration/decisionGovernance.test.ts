import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  classifyGovernance,
  selectGovernancePolicy,
  postValidateGovernance,
  loadGovernanceInputData,
  resolveNexusPreResearchContext,
} from "./decisionGovernance.js";
import type { GovernanceClassification } from "./decisionGovernance.js";
import type { Goal } from "../state/goals.js";
import type { KairosOutput } from "./types.js";

const SCHEMA_PATH = path.resolve("state", "schema.sql");

function createTestDb(): BetterSqlite3.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
}

function createGoal(overrides?: Partial<Goal>): Goal {
  return {
    id: overrides?.id ?? crypto.randomUUID(),
    title: overrides?.title ?? "Test goal",
    description: overrides?.description ?? "Test description",
    status: overrides?.status ?? "active",
    priority: overrides?.priority ?? 5,
    created_at: overrides?.created_at ?? new Date().toISOString(),
    updated_at: overrides?.updated_at ?? new Date().toISOString(),
  };
}

function insertFeedback(
  db: BetterSqlite3.Database,
  agentId: string,
  taskType: string,
  grade: "SUCCESS" | "PARTIAL" | "FAILURE",
): void {
  db.prepare(
    "INSERT INTO agent_feedback (id, agent_id, task_type, grade) VALUES (?, ?, ?, ?)",
  ).run(crypto.randomUUID(), agentId, taskType, grade);
}

function insertOutcome(
  db: BetterSqlite3.Database,
  agentId: string,
  task: string,
  status: "success" | "failed",
  error?: string,
  tokensUsed?: number,
): void {
  db.prepare(
    `INSERT INTO outcomes (id, agent_id, task, status, error, tokens_used)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), agentId, task, status, error ?? null, tokensUsed ?? null);
}

function insertCodeChange(
  db: BetterSqlite3.Database,
  taskId: string,
  risk: number,
  status: string,
): void {
  db.prepare(
    `INSERT INTO code_changes (id, task_id, description, files_changed, risk, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), taskId, `Test: ${taskId}`, "[]", risk, status);
}

function insertBudget(
  db: BetterSqlite3.Database,
  totalTokens: number,
  usedTokens: number,
): void {
  db.prepare(
    `INSERT INTO budgets (id, period, total_tokens, used_tokens, hard_limit)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(crypto.randomUUID(), "2026-02", totalTokens, usedTokens);
}

function insertNexusResearch(
  db: BetterSqlite3.Database,
  goalId: string,
  question: string,
): void {
  db.prepare(
    `INSERT INTO nexus_research (id, goal_id, question, options, pros_cons, risk_analysis, recommendation, raw_output)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    goalId,
    question,
    "Option A, Option B",
    "Pro: fast. Con: complex",
    "Low risk overall",
    "Use Option A",
    "raw output data",
  );
}

describe("orchestration/decisionGovernance", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("classifyGovernance", () => {
    it("should return low complexity for simple goals", () => {
      const goals = [createGoal({ priority: 3 })];
      const data = loadGovernanceInputData(db);

      const result = classifyGovernance(goals, data);

      assert.ok(result.complexity <= 2);
      assert.equal(typeof result.risk, "number");
      assert.equal(typeof result.cost, "number");
    });

    it("should increase complexity for many active goals", () => {
      const goals = [
        createGoal({ priority: 3 }),
        createGoal({ priority: 5 }),
        createGoal({ priority: 7 }),
      ];
      const data = loadGovernanceInputData(db);

      const result = classifyGovernance(goals, data);

      assert.ok(result.complexity >= 2);
    });

    it("should increase complexity for architectural goals", () => {
      const goals = [createGoal({ title: "migrar banco para PostgreSQL", priority: 5 })];
      const data = loadGovernanceInputData(db);

      const result = classifyGovernance(goals, data);

      assert.ok(result.complexity >= 3);
      assert.ok(result.reasons.some((r) => r.includes("arquitetural")));
    });

    it("should increase complexity for high priority goals", () => {
      const goals = [createGoal({ priority: 9 })];
      const data = loadGovernanceInputData(db);

      const result = classifyGovernance(goals, data);

      assert.ok(result.complexity >= 2);
      assert.ok(result.reasons.some((r) => r.includes("Prioridade maxima")));
    });

    it("should increase risk for low success rate", () => {
      for (let i = 0; i < 5; i++) insertFeedback(db, "forge", "test", "FAILURE");
      insertFeedback(db, "forge", "test", "SUCCESS");

      const data = loadGovernanceInputData(db);
      const goals = [createGoal()];
      const result = classifyGovernance(goals, data);

      assert.ok(result.risk >= 3);
    });

    it("should increase risk for recurrent failures", () => {
      insertOutcome(db, "forge", "task-a", "failed", "lint error");
      insertOutcome(db, "forge", "task-b", "failed", "lint error");
      insertOutcome(db, "forge", "task-c", "failed", "lint error");

      insertFeedback(db, "forge", "test", "FAILURE");
      insertFeedback(db, "forge", "test", "FAILURE");

      const data = loadGovernanceInputData(db);
      const goals = [createGoal()];
      const result = classifyGovernance(goals, data);

      assert.ok(result.risk >= 2);
    });

    it("should increase cost when budget is high", () => {
      insertBudget(db, 500_000, 450_000);

      const data = loadGovernanceInputData(db);
      const goals = [createGoal()];
      const result = classifyGovernance(goals, data);

      assert.ok(result.cost >= 3);
      assert.ok(result.reasons.some((r) => r.includes("Budget")));
    });

    it("should mark stability as stable with high success rate", () => {
      for (let i = 0; i < 10; i++) insertFeedback(db, "forge", "test", "SUCCESS");

      const data = loadGovernanceInputData(db);
      const goals = [createGoal()];
      const result = classifyGovernance(goals, data);

      assert.equal(result.historicalStability, "stable");
    });

    it("should mark stability as unstable with low success rate", () => {
      for (let i = 0; i < 3; i++) insertFeedback(db, "forge", "test", "FAILURE");
      insertFeedback(db, "forge", "test", "SUCCESS");

      const data = loadGovernanceInputData(db);
      const goals = [createGoal()];
      const result = classifyGovernance(goals, data);

      assert.equal(result.historicalStability, "unstable");
    });

    it("should mark stability as moderate with no executions", () => {
      const data = loadGovernanceInputData(db);
      const goals = [createGoal()];
      const result = classifyGovernance(goals, data);

      assert.equal(result.historicalStability, "moderate");
    });
  });

  describe("selectGovernancePolicy", () => {
    it("should select economy model for simple stable tasks", () => {
      const classification: GovernanceClassification = {
        complexity: 1,
        risk: 1,
        cost: 1,
        historicalStability: "stable",
        reasons: [],
      };

      const policy = selectGovernancePolicy(classification);

      assert.equal(policy.modelTier, "economy");
      assert.equal(policy.selectedModel, "gpt-4o-mini");
      assert.equal(policy.nexusPreResearchRequired, false);
      assert.equal(policy.humanApprovalRequired, false);
    });

    it("should select standard model for moderate tasks", () => {
      const classification: GovernanceClassification = {
        complexity: 3,
        risk: 2,
        cost: 2,
        historicalStability: "moderate",
        reasons: [],
      };

      const policy = selectGovernancePolicy(classification);

      assert.equal(policy.modelTier, "standard");
      assert.equal(policy.selectedModel, "gpt-4o");
    });

    it("should select premium model for high complexity", () => {
      const classification: GovernanceClassification = {
        complexity: 4,
        risk: 2,
        cost: 2,
        historicalStability: "stable",
        reasons: [],
      };

      const policy = selectGovernancePolicy(classification);

      assert.equal(policy.modelTier, "premium");
      assert.equal(policy.selectedModel, "gpt-5.2");
      assert.equal(policy.nexusPreResearchRequired, true);
    });

    it("should select premium model for high risk", () => {
      const classification: GovernanceClassification = {
        complexity: 2,
        risk: 4,
        cost: 2,
        historicalStability: "stable",
        reasons: [],
      };

      const policy = selectGovernancePolicy(classification);

      assert.equal(policy.modelTier, "premium");
      assert.equal(policy.humanApprovalRequired, true);
    });

    it("should select premium and require approval for critical risk", () => {
      const classification: GovernanceClassification = {
        complexity: 2,
        risk: 5,
        cost: 3,
        historicalStability: "moderate",
        reasons: [],
      };

      const policy = selectGovernancePolicy(classification);

      assert.equal(policy.modelTier, "premium");
      assert.equal(policy.selectedModel, "gpt-5.2");
      assert.equal(policy.humanApprovalRequired, true);
      assert.equal(policy.nexusPreResearchRequired, true);
    });

    it("should select premium model for unstable history", () => {
      const classification: GovernanceClassification = {
        complexity: 2,
        risk: 2,
        cost: 2,
        historicalStability: "unstable",
        reasons: [],
      };

      const policy = selectGovernancePolicy(classification);

      assert.equal(policy.modelTier, "premium");
      assert.equal(policy.nexusPreResearchRequired, true);
    });
  });

  describe("postValidateGovernance", () => {
    it("should return match when no delegations exist", () => {
      const output: KairosOutput = {
        briefing: "Test",
        decisions_needed: [],
        delegations: [],
        tasks_killed: [],
        next_24h_focus: "test",
      };

      const governance = selectGovernancePolicy({
        complexity: 1,
        risk: 1,
        cost: 1,
        historicalStability: "stable",
        reasons: [],
      });

      const result = postValidateGovernance(output, governance);
      assert.equal(result.status, "match");
    });

    it("should return match when classification aligns with output", () => {
      const output: KairosOutput = {
        briefing: "Test",
        decisions_needed: [],
        delegations: [
          {
            agent: "forge",
            task: "test task",
            goal_id: "goal-1",
            expected_output: "done",
            deadline: "2026-02-11",
            decision_metrics: { impact: 2, cost: 2, risk: 2, confidence: 4 },
          },
        ],
        tasks_killed: [],
        next_24h_focus: "test",
      };

      const governance = selectGovernancePolicy({
        complexity: 2,
        risk: 2,
        cost: 2,
        historicalStability: "stable",
        reasons: [],
      });

      const result = postValidateGovernance(output, governance);
      assert.equal(result.status, "match");
    });

    it("should return mismatch when KAIROS delegates high-risk but pre-classification was low", () => {
      const output: KairosOutput = {
        briefing: "Test",
        decisions_needed: [],
        delegations: [
          {
            agent: "forge",
            task: "critical task",
            goal_id: "goal-1",
            expected_output: "done",
            deadline: "2026-02-11",
            decision_metrics: { impact: 4, cost: 3, risk: 4, confidence: 3 },
          },
        ],
        tasks_killed: [],
        next_24h_focus: "test",
      };

      const governance = selectGovernancePolicy({
        complexity: 2,
        risk: 2,
        cost: 2,
        historicalStability: "stable",
        reasons: [],
      });

      const result = postValidateGovernance(output, governance);
      assert.equal(result.status, "mismatch");
      assert.ok(result.notes.includes("risk"));
    });

    it("should return escalation_needed for critical risk with non-premium model", () => {
      const output: KairosOutput = {
        briefing: "Test",
        decisions_needed: [],
        delegations: [
          {
            agent: "forge",
            task: "critical task",
            goal_id: "goal-1",
            expected_output: "done",
            deadline: "2026-02-11",
            decision_metrics: { impact: 5, cost: 4, risk: 5, confidence: 2 },
          },
        ],
        tasks_killed: [],
        next_24h_focus: "test",
      };

      const governance = selectGovernancePolicy({
        complexity: 1,
        risk: 1,
        cost: 1,
        historicalStability: "stable",
        reasons: [],
      });

      const result = postValidateGovernance(output, governance);
      assert.equal(result.status, "escalation_needed");
    });
  });

  describe("resolveNexusPreResearchContext", () => {
    it("should return empty string when no research exists", () => {
      const goals = [createGoal()];
      const result = resolveNexusPreResearchContext(db, goals);
      assert.equal(result, "");
    });

    it("should return research context when research exists for goal", () => {
      const goalId = crypto.randomUUID();
      const goals = [createGoal({ id: goalId })];
      insertNexusResearch(db, goalId, "How to optimize database queries?");

      const result = resolveNexusPreResearchContext(db, goals);
      assert.ok(result.includes("NEXUS_PRE_RESEARCH:"));
      assert.ok(result.includes("optimize database"));
    });

    it("should return recent research if no goal-specific research found", () => {
      const goals = [createGoal()];
      insertNexusResearch(db, "other-goal-id", "General architecture question");

      const result = resolveNexusPreResearchContext(db, goals);
      assert.ok(result.includes("NEXUS_PRE_RESEARCH:"));
      assert.ok(result.includes("architecture"));
    });
  });

  describe("loadGovernanceInputData", () => {
    it("should return default values for empty database", () => {
      const data = loadGovernanceInputData(db);

      assert.equal(data.forgeFeedback.total, 0);
      assert.equal(data.recurrentFailures.length, 0);
      assert.equal(data.avgRisk, 0);
      assert.equal(data.budgetUsedPercent, 0);
      assert.equal(data.avgTokensPerExecution, 0);
    });

    it("should aggregate feedback data correctly", () => {
      for (let i = 0; i < 7; i++) insertFeedback(db, "forge", "test", "SUCCESS");
      for (let i = 0; i < 3; i++) insertFeedback(db, "forge", "test", "FAILURE");

      const data = loadGovernanceInputData(db);

      assert.equal(data.forgeFeedback.total, 10);
      assert.equal(data.forgeFeedback.successRate, 70);
    });

    it("should calculate budget usage percentage", () => {
      insertBudget(db, 100_000, 60_000);

      const data = loadGovernanceInputData(db);
      assert.ok(data.budgetUsedPercent >= 59 && data.budgetUsedPercent <= 61);
    });

    it("should calculate average tokens per execution", () => {
      insertOutcome(db, "forge", "task-1", "success", undefined, 1000);
      insertOutcome(db, "forge", "task-2", "success", undefined, 2000);

      const data = loadGovernanceInputData(db);
      assert.equal(data.avgTokensPerExecution, 1500);
    });

    it("should calculate average risk from code changes", () => {
      insertCodeChange(db, "task-1", 3, "applied");
      insertCodeChange(db, "task-2", 5, "failed");

      const data = loadGovernanceInputData(db);
      assert.equal(data.avgRisk, 4);
    });
  });
});
