import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export interface Budget {
  readonly id: string;
  readonly period: string;
  readonly total_tokens: number;
  readonly used_tokens: number;
  readonly hard_limit: number;
  readonly created_at: string;
}

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function ensureCurrentBudget(db: BetterSqlite3.Database, totalTokens: number): void {
  const period = getCurrentPeriod();

  db.prepare(
    "INSERT OR IGNORE INTO budgets (id, period, total_tokens, hard_limit) VALUES (?, ?, ?, 1)",
  ).run(crypto.randomUUID(), period, totalTokens);
}

export function getCurrentBudget(db: BetterSqlite3.Database): Budget | null {
  const period = getCurrentPeriod();

  const row = db.prepare("SELECT * FROM budgets WHERE period = ?").get(period) as
    | Budget
    | undefined;

  return row ?? null;
}

export function incrementUsedTokens(
  db: BetterSqlite3.Database,
  period: string,
  tokens: number,
): void {
  db.prepare("UPDATE budgets SET used_tokens = used_tokens + ? WHERE period = ?").run(
    tokens,
    period,
  );
}

export function isBudgetExhausted(db: BetterSqlite3.Database): boolean {
  const budget = getCurrentBudget(db);
  if (!budget) return false;

  return budget.hard_limit === 1 && budget.used_tokens >= budget.total_tokens;
}
