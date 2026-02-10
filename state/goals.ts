import type BetterSqlite3 from "better-sqlite3";

export interface Goal {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly priority: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export function loadGoals(db: BetterSqlite3.Database): readonly Goal[] {
  return db
    .prepare("SELECT * FROM goals WHERE status = 'active' ORDER BY priority DESC")
    .all() as Goal[];
}
