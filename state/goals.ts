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
    .prepare("SELECT * FROM goals WHERE status IN ('active', 'in_progress') ORDER BY priority DESC")
    .all() as Goal[];
}

export function loadGoalsByProject(
  db: BetterSqlite3.Database,
  projectId: string,
): readonly Goal[] {
  return db
    .prepare(
      "SELECT * FROM goals WHERE status IN ('active', 'in_progress') AND project_id = ? ORDER BY priority DESC",
    )
    .all(projectId) as Goal[];
}

export function markGoalInProgress(db: BetterSqlite3.Database, goalId: string): void {
  db.prepare(
    "UPDATE goals SET status = 'in_progress', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'active'",
  ).run(goalId);
}

export function markGoalCompleted(db: BetterSqlite3.Database, goalId: string): void {
  db.prepare(
    "UPDATE goals SET status = 'completed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'in_progress'",
  ).run(goalId);
}

export function tryAutoCompleteGoal(
  db: BetterSqlite3.Database,
  shortGoalId: string,
): boolean {
  const goal = db
    .prepare("SELECT id, status FROM goals WHERE id LIKE ? || '%' AND status = 'in_progress' LIMIT 1")
    .get(shortGoalId) as { id: string; status: string } | undefined;

  if (!goal) return false;

  const pendingCount = db
    .prepare(
      `SELECT COUNT(*) as count FROM code_changes
       WHERE task_id = ?
         AND status NOT IN ('applied', 'approved', 'rejected', 'failed', 'rolled_back')`,
    )
    .get(shortGoalId) as { count: number };

  const totalCount = db
    .prepare("SELECT COUNT(*) as count FROM code_changes WHERE task_id = ?")
    .get(shortGoalId) as { count: number };

  if (totalCount.count > 0 && pendingCount.count === 0) {
    markGoalCompleted(db, goal.id);
    return true;
  }

  return false;
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
