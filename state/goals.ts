import type BetterSqlite3 from "better-sqlite3";

export interface Goal {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly priority: number;
  readonly project_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export function loadGoals(db: BetterSqlite3.Database): readonly Goal[] {
  return db
    .prepare("SELECT * FROM goals WHERE status = 'active' ORDER BY priority DESC")
    .all() as Goal[];
}

export function loadGoalsByProject(
  db: BetterSqlite3.Database,
  projectId: string,
): readonly Goal[] {
  return db
    .prepare(
      "SELECT * FROM goals WHERE status = 'active' AND project_id = ? ORDER BY priority DESC",
    )
    .all(projectId) as Goal[];
}

export function getGoalById(
  db: BetterSqlite3.Database,
  goalId: string,
): Goal | null {
  const result = db
    .prepare("SELECT * FROM goals WHERE id = ?")
    .get(goalId) as Goal | undefined;
  return result ?? null;
}
