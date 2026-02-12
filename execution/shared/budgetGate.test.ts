import { describe, it, expect, vi, beforeEach } from "vitest";
import type BetterSqlite3 from "better-sqlite3";
import { checkBudget } from "./budgetGate";

vi.mock("../../config/budget", () => ({
  loadBudgetConfig: vi.fn(),
}));

vi.mock("../../state/budgets", () => ({
  getCurrentBudget: vi.fn(),
  isBudgetExhausted: vi.fn(),
}));

vi.mock("../../state/tokenUsage", () => ({
  getAgentUsageMonth: vi.fn(),
  getTaskCountToday: vi.fn(),
}));

vi.mock("../../config/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { loadBudgetConfig } from "../../config/budget";
import { getCurrentBudget, isBudgetExhausted } from "../../state/budgets";
import { getAgentUsageMonth, getTaskCountToday } from "../../state/tokenUsage";

const mockDb = {} as BetterSqlite3.Database;

const DEFAULT_CONFIG = {
  monthlyTokenLimit: 500_000,
  perAgentMonthlyLimit: 500_000,
  maxTasksPerDay: 10,
  perTaskTokenLimit: 50_000,
  warningThresholdPercent: 20,
  kairosMaxInputTokens: 800,
  kairosMaxOutputTokens: 400,
  nexusMaxOutputTokens: 600,
} as const;

describe("checkBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadBudgetConfig).mockReturnValue(DEFAULT_CONFIG);
    vi.mocked(isBudgetExhausted).mockReturnValue(false);
    vi.mocked(getCurrentBudget).mockReturnValue(null);
    vi.mocked(getAgentUsageMonth).mockReturnValue(0);
    vi.mocked(getTaskCountToday).mockReturnValue(0);
  });

  it("should allow budget when all limits are within range", () => {
    expect(checkBudget(mockDb, "agent1")).toEqual({ allowed: true });
  });

  it("should deny budget when kill switch is active (budget exhausted)", () => {
    vi.mocked(isBudgetExhausted).mockReturnValue(true);

    expect(checkBudget(mockDb, "agent1")).toEqual({
      allowed: false,
      reason: "Orcamento mensal esgotado (kill switch ativo)",
    });
  });

  it("should deny budget when monthly token limit is exceeded", () => {
    vi.mocked(getCurrentBudget).mockReturnValue({
      id: "b1",
      period: "2026-02",
      total_tokens: 500_000,
      used_tokens: 500_001,
      hard_limit: 0,
      created_at: "2026-02-01T00:00:00Z",
    });

    expect(checkBudget(mockDb, "agent1")).toEqual({
      allowed: false,
      reason: "Limite mensal de tokens excedido (500001/500000)",
    });
  });

  it("should deny budget when per-agent monthly limit is exceeded", () => {
    vi.mocked(getAgentUsageMonth).mockReturnValue(500_001);

    expect(checkBudget(mockDb, "agent1")).toEqual({
      allowed: false,
      reason: "Limite mensal do agente excedido (500001/500000)",
    });
  });

  it("should deny budget when daily task limit is exceeded", () => {
    vi.mocked(getTaskCountToday).mockReturnValue(11);

    expect(checkBudget(mockDb, "agent1")).toEqual({
      allowed: false,
      reason: "Limite diario de tasks excedido (11/10)",
    });
  });

  it("should allow budget when used tokens are exactly at the limit minus one", () => {
    vi.mocked(getCurrentBudget).mockReturnValue({
      id: "b1",
      period: "2026-02",
      total_tokens: 500_000,
      used_tokens: 499_999,
      hard_limit: 0,
      created_at: "2026-02-01T00:00:00Z",
    });

    expect(checkBudget(mockDb, "agent1")).toEqual({ allowed: true });
  });

  it("should deny budget when used tokens are exactly at the limit", () => {
    vi.mocked(getCurrentBudget).mockReturnValue({
      id: "b1",
      period: "2026-02",
      total_tokens: 500_000,
      used_tokens: 500_000,
      hard_limit: 0,
      created_at: "2026-02-01T00:00:00Z",
    });

    expect(checkBudget(mockDb, "agent1")).toEqual({
      allowed: false,
      reason: "Limite mensal de tokens excedido (500000/500000)",
    });
  });

  it("should check kill switch before other limits", () => {
    vi.mocked(isBudgetExhausted).mockReturnValue(true);
    vi.mocked(getCurrentBudget).mockReturnValue({
      id: "b1",
      period: "2026-02",
      total_tokens: 500_000,
      used_tokens: 999_999,
      hard_limit: 1,
      created_at: "2026-02-01T00:00:00Z",
    });

    const result = checkBudget(mockDb, "agent1");
    expect(result.reason).toContain("kill switch");
  });
});
