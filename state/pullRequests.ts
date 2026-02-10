import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export type PullRequestStatus = "pending_push" | "pending_approval" | "open" | "closed" | "merged";

export type MergeStatus = "unchecked" | "ready" | "blocked" | "confirmed";

export interface PullRequestEntry {
  readonly codeChangeId: string;
  readonly repo: string;
  readonly branchName: string;
  readonly title: string;
  readonly body: string;
  readonly risk: number;
}

export interface PullRequest {
  readonly id: string;
  readonly code_change_id: string;
  readonly repo: string;
  readonly branch_name: string;
  readonly pr_number: number | null;
  readonly pr_url: string | null;
  readonly title: string;
  readonly body: string;
  readonly status: PullRequestStatus;
  readonly risk: number;
  readonly merge_status: MergeStatus | null;
  readonly merge_report: string | null;
  readonly merge_checked_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PullRequestStatusUpdate {
  readonly status: PullRequestStatus;
  readonly prNumber?: number;
  readonly prUrl?: string;
}

export interface MergeStatusUpdate {
  readonly mergeStatus: MergeStatus;
  readonly mergeReport?: string;
}

export interface PRStats7d {
  readonly openCount: number;
  readonly closedCount7d: number;
  readonly mergedCount7d: number;
  readonly pendingApprovalCount: number;
  readonly readyForMergeCount: number;
  readonly stalePRCount: number;
}

const COLUMNS = `id, code_change_id, repo, branch_name, pr_number, pr_url, title, body, status, risk, merge_status, merge_report, merge_checked_at, created_at, updated_at`;

export function savePullRequest(db: BetterSqlite3.Database, entry: PullRequestEntry): string {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO pull_requests (id, code_change_id, repo, branch_name, title, body, risk)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, entry.codeChangeId, entry.repo, entry.branchName, entry.title, entry.body, entry.risk);

  return id;
}

export function getPullRequestById(
  db: BetterSqlite3.Database,
  id: string,
): PullRequest | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM pull_requests WHERE id = ?`).get(id) as
    | PullRequest
    | undefined;
}

export function getPullRequestByChangeId(
  db: BetterSqlite3.Database,
  changeId: string,
): PullRequest | undefined {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM pull_requests WHERE code_change_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(changeId) as PullRequest | undefined;
}

export function getPendingApprovalPRs(db: BetterSqlite3.Database): readonly PullRequest[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM pull_requests
       WHERE status = 'pending_approval'
       ORDER BY created_at DESC`,
    )
    .all() as PullRequest[];
}

export function getOpenPRs(db: BetterSqlite3.Database): readonly PullRequest[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM pull_requests
       WHERE status = 'open'
       ORDER BY created_at DESC`,
    )
    .all() as PullRequest[];
}

export function updatePullRequestStatus(
  db: BetterSqlite3.Database,
  id: string,
  update: PullRequestStatusUpdate,
): void {
  const sets: string[] = ["status = ?", "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"];
  const values: (string | number | null)[] = [update.status];

  if (update.prNumber !== undefined) {
    sets.push("pr_number = ?");
    values.push(update.prNumber);
  }
  if (update.prUrl !== undefined) {
    sets.push("pr_url = ?");
    values.push(update.prUrl);
  }

  values.push(id);

  db.prepare(`UPDATE pull_requests SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function updateMergeStatus(
  db: BetterSqlite3.Database,
  id: string,
  update: MergeStatusUpdate,
): void {
  const sets: string[] = [
    "merge_status = ?",
    "merge_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  ];
  const values: (string | null)[] = [update.mergeStatus];

  if (update.mergeReport !== undefined) {
    sets.push("merge_report = ?");
    values.push(update.mergeReport);
  }

  values.push(id);

  db.prepare(`UPDATE pull_requests SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getReadyForMergePRs(db: BetterSqlite3.Database): readonly PullRequest[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM pull_requests
       WHERE status = 'open' AND merge_status IN ('ready', 'confirmed')
       ORDER BY created_at DESC`,
    )
    .all() as PullRequest[];
}

export function getStalePRs(db: BetterSqlite3.Database, staleDays: number): readonly PullRequest[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM pull_requests
       WHERE status = 'open'
         AND created_at < datetime('now', ? || ' days')
       ORDER BY created_at ASC`,
    )
    .all(`-${staleDays}`) as PullRequest[];
}

export function getPRStats7d(db: BetterSqlite3.Database): PRStats7d {
  const open = db
    .prepare(`SELECT COUNT(*) as count FROM pull_requests WHERE status = 'open'`)
    .get() as { count: number };

  const closed = db
    .prepare(
      `SELECT COUNT(*) as count FROM pull_requests
       WHERE status = 'closed' AND updated_at >= datetime('now', '-7 days')`,
    )
    .get() as { count: number };

  const merged = db
    .prepare(
      `SELECT COUNT(*) as count FROM pull_requests
       WHERE status = 'merged' AND updated_at >= datetime('now', '-7 days')`,
    )
    .get() as { count: number };

  const pendingApproval = db
    .prepare(`SELECT COUNT(*) as count FROM pull_requests WHERE status = 'pending_approval'`)
    .get() as { count: number };

  const readyForMerge = db
    .prepare(
      `SELECT COUNT(*) as count FROM pull_requests
       WHERE status = 'open' AND merge_status IN ('ready', 'confirmed')`,
    )
    .get() as { count: number };

  const defaultStaleDays = Number(process.env.PR_STALE_DAYS ?? "7");
  const stale = db
    .prepare(
      `SELECT COUNT(*) as count FROM pull_requests
       WHERE status = 'open'
         AND created_at < datetime('now', ? || ' days')`,
    )
    .get(`-${defaultStaleDays}`) as { count: number };

  return {
    openCount: open.count,
    closedCount7d: closed.count,
    mergedCount7d: merged.count,
    pendingApprovalCount: pendingApproval.count,
    readyForMergeCount: readyForMerge.count,
    stalePRCount: stale.count,
  };
}
