import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export type CodeChangeStatus =
  | "pending"
  | "pending_approval"
  | "approved"
  | "applied"
  | "failed"
  | "rolled_back"
  | "rejected";

export interface CodeChangeEntry {
  readonly taskId: string;
  readonly description: string;
  readonly filesChanged: readonly string[];
  readonly risk: number;
}

export interface CodeChange {
  readonly id: string;
  readonly task_id: string;
  readonly description: string;
  readonly files_changed: string;
  readonly diff: string | null;
  readonly risk: number;
  readonly status: CodeChangeStatus;
  readonly test_output: string | null;
  readonly error: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly applied_at: string | null;
  readonly created_at: string;
}

export interface CodeChangeStatusUpdate {
  readonly status: CodeChangeStatus;
  readonly diff?: string;
  readonly testOutput?: string;
  readonly error?: string;
  readonly approvedBy?: string;
  readonly appliedAt?: string;
}

const COLUMNS = `id, task_id, description, files_changed, diff, risk, status, test_output, error, approved_by, approved_at, applied_at, created_at`;

export function saveCodeChange(db: BetterSqlite3.Database, entry: CodeChangeEntry): string {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO code_changes (id, task_id, description, files_changed, risk)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, entry.taskId, entry.description, JSON.stringify(entry.filesChanged), entry.risk);

  return id;
}

export function getCodeChangeById(db: BetterSqlite3.Database, id: string): CodeChange | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM code_changes WHERE id = ?`).get(id) as
    | CodeChange
    | undefined;
}

export function getPendingApprovalChanges(db: BetterSqlite3.Database): readonly CodeChange[] {
  return db
    .prepare(
      `SELECT ${COLUMNS}
       FROM code_changes
       WHERE status = 'pending_approval'
       ORDER BY created_at DESC`,
    )
    .all() as CodeChange[];
}

export function getRecentCodeChanges(
  db: BetterSqlite3.Database,
  days: number,
): readonly CodeChange[] {
  return db
    .prepare(
      `SELECT ${COLUMNS}
       FROM code_changes
       WHERE created_at >= datetime('now', ?)
       ORDER BY created_at DESC`,
    )
    .all(`-${days} days`) as CodeChange[];
}

export function updateCodeChangeStatus(
  db: BetterSqlite3.Database,
  id: string,
  update: CodeChangeStatusUpdate,
): void {
  const sets: string[] = ["status = ?"];
  const values: (string | null)[] = [update.status];

  if (update.diff !== undefined) {
    sets.push("diff = ?");
    values.push(update.diff);
  }
  if (update.testOutput !== undefined) {
    sets.push("test_output = ?");
    values.push(update.testOutput);
  }
  if (update.error !== undefined) {
    sets.push("error = ?");
    values.push(update.error);
  }
  if (update.approvedBy !== undefined) {
    sets.push("approved_by = ?");
    sets.push("approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
    values.push(update.approvedBy);
  }
  if (update.appliedAt !== undefined) {
    sets.push("applied_at = ?");
    values.push(update.appliedAt);
  }

  values.push(id);

  db.prepare(`UPDATE code_changes SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getCodeChangeStats7d(db: BetterSqlite3.Database): {
  readonly appliedCount: number;
  readonly failedCount: number;
  readonly pendingApprovalCount: number;
  readonly totalRisk: number;
} {
  const applied = db
    .prepare(
      `SELECT COUNT(*) as count FROM code_changes
       WHERE status = 'applied' AND created_at >= datetime('now', '-7 days')`,
    )
    .get() as { count: number };

  const failed = db
    .prepare(
      `SELECT COUNT(*) as count FROM code_changes
       WHERE status IN ('failed', 'rolled_back') AND created_at >= datetime('now', '-7 days')`,
    )
    .get() as { count: number };

  const pendingApproval = db
    .prepare(`SELECT COUNT(*) as count FROM code_changes WHERE status = 'pending_approval'`)
    .get() as { count: number };

  const riskSum = db
    .prepare(
      `SELECT COALESCE(SUM(risk), 0) as total FROM code_changes
       WHERE status = 'applied' AND created_at >= datetime('now', '-7 days')`,
    )
    .get() as { total: number };

  return {
    appliedCount: applied.count,
    failedCount: failed.count,
    pendingApprovalCount: pendingApproval.count,
    totalRisk: riskSum.total,
  };
}
