export interface BudgetConfig {
  readonly monthlyTokenLimit: number;
  readonly perAgentMonthlyLimit: number;
  readonly perTaskTokenLimit: number;
  readonly maxTasksPerDay: number;
  readonly warningThresholdPercent: number;
  readonly kairosMaxInputTokens: number;
  readonly kairosMaxOutputTokens: number;
  readonly nexusMaxOutputTokens: number;
}

export function loadBudgetConfig(): BudgetConfig {
  return {
    monthlyTokenLimit: Number(process.env.BUDGET_MONTHLY_TOKENS ?? "500000"),
    perAgentMonthlyLimit: Number(process.env.BUDGET_PER_AGENT_TOKENS ?? "500000"),
    perTaskTokenLimit: Number(process.env.BUDGET_PER_TASK_TOKENS ?? "50000"),
    maxTasksPerDay: Number(process.env.BUDGET_MAX_TASKS_DAY ?? "10"),
    warningThresholdPercent: 20,
    kairosMaxInputTokens: Number(process.env.KAIROS_MAX_INPUT_TOKENS ?? "800"),
    kairosMaxOutputTokens: Number(process.env.KAIROS_MAX_OUTPUT_TOKENS ?? "400"),
    nexusMaxOutputTokens: Number(process.env.NEXUS_MAX_OUTPUT_TOKENS ?? "600"),
  };
}
