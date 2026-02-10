import type BetterSqlite3 from "better-sqlite3";
import { checkBudget } from "./budgetGate";
import { loadBudgetConfig } from "../config/budget";

jest.mock("../config/budget");

const mockDb = {} as BetterSqlite3.Database;

describe("checkBudget", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = process.env;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BUDGET_MONTHLY_TOKENS = "500000";
    process.env.BUDGET_PER_AGENT_TOKENS = "500000";
    process.env.BUDGET_MAX_TASKS_DAY = "10";
  });

  it("deve permitir orçamento quando os limites não são excedidos", () => {
    (loadBudgetConfig as jest.Mock).mockReturnValue({
      monthlyTokenLimit: 500000,
      perAgentMonthlyLimit: 500000,
      maxTasksPerDay: 10,
    });
    expect(checkBudget(mockDb, "agent1")).toEqual({ allowed: true });
  });

  it("não deve permitir orçamento se o orçamento mensal estiver esgotado", () => {
    (loadBudgetConfig as jest.Mock).mockReturnValue({
      monthlyTokenLimit: 500000,
      perAgentMonthlyLimit: 500000,
      maxTasksPerDay: 10,
    });
    jest.spyOn(global.console, "error").mockImplementation();
    jest.spyOn(global, "isBudgetExhausted").mockReturnValue(true);
    expect(checkBudget(mockDb, "agent1")).toEqual({
      allowed: false,
      reason: "Orcamento mensal esgotado (kill switch ativo)",
    });
  });

  it("não deve permitir orçamento se o limite mensal de tokens for excedido", () => {
    (loadBudgetConfig as jest.Mock).mockReturnValue({
      monthlyTokenLimit: 500000,
      perAgentMonthlyLimit: 500000,
      maxTasksPerDay: 10,
    });
    jest.spyOn(global.console, "warn").mockImplementation();
    jest.spyOn(global, "getCurrentBudget").mockReturnValue({ used_tokens: 500001 });
    expect(checkBudget(mockDb, "agent1")).toEqual({
      allowed: false,
      reason: "Limite mensal de tokens excedido (500001/500000)",
    });
  });

  it("não deve permitir orçamento se o limite mensal do agente for excedido", () => {
    (loadBudgetConfig as jest.Mock).mockReturnValue({
      monthlyTokenLimit: 500000,
      perAgentMonthlyLimit: 500000,
      maxTasksPerDay: 10,
    });
    jest.spyOn(global.console, "warn").mockImplementation();
    jest.spyOn(global, "getAgentUsageMonth").mockReturnValue(500001);
    expect(checkBudget(mockDb, "agent1")).toEqual({
      allowed: false,
      reason: "Limite mensal do agente excedido (500001/500000)",
    });
  });

  it("não deve permitir orçamento se o limite diário de tarefas for excedido", () => {
    (loadBudgetConfig as jest.Mock).mockReturnValue({
      monthlyTokenLimit: 500000,
      perAgentMonthlyLimit: 500000,
      maxTasksPerDay: 10,
    });
    jest.spyOn(global.console, "warn").mockImplementation();
    jest.spyOn(global, "getTaskCountToday").mockReturnValue(11);
    expect(checkBudget(mockDb, "agent1")).toEqual({
      allowed: false,
      reason: "Limite diario de tasks excedido (11/10)",
    });
  });
});
