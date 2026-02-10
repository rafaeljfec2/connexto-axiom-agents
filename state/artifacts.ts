import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export type ArtifactType = "post" | "newsletter" | "landing" | "editorial_calendar" | "analysis";
export type ArtifactStatus = "draft" | "approved" | "rejected" | "published";

export interface ArtifactEntry {
  readonly agentId: string;
  readonly type: ArtifactType;
  readonly title: string;
  readonly content: string;
  readonly metadata?: string;
}

export interface Artifact {
  readonly id: string;
  readonly agent_id: string;
  readonly type: ArtifactType;
  readonly title: string;
  readonly content: string;
  readonly status: ArtifactStatus;
  readonly metadata: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const ARTIFACT_COLUMNS = `id, agent_id, type, title, content, status, metadata, approved_by, approved_at, created_at, updated_at`;

export function saveArtifact(db: BetterSqlite3.Database, entry: ArtifactEntry): string {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO artifacts (id, agent_id, type, title, content, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, entry.agentId, entry.type, entry.title, entry.content, entry.metadata ?? null);

  return id;
}

export function getArtifactById(db: BetterSqlite3.Database, id: string): Artifact | undefined {
  return db.prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE id = ?`).get(id) as
    | Artifact
    | undefined;
}

export function getPendingArtifacts(
  db: BetterSqlite3.Database,
  agentId: string,
): readonly Artifact[] {
  return db
    .prepare(
      `SELECT ${ARTIFACT_COLUMNS}
       FROM artifacts
       WHERE agent_id = ? AND status = 'draft'
       ORDER BY created_at DESC`,
    )
    .all(agentId) as Artifact[];
}

export function getAllPendingDrafts(db: BetterSqlite3.Database): readonly Artifact[] {
  return db
    .prepare(
      `SELECT ${ARTIFACT_COLUMNS}
       FROM artifacts
       WHERE status = 'draft'
       ORDER BY created_at DESC`,
    )
    .all() as Artifact[];
}

export function getApprovedArtifacts(
  db: BetterSqlite3.Database,
  agentId: string,
): readonly Artifact[] {
  return db
    .prepare(
      `SELECT ${ARTIFACT_COLUMNS}
       FROM artifacts
       WHERE agent_id = ? AND status = 'approved'
       ORDER BY created_at DESC`,
    )
    .all(agentId) as Artifact[];
}

export function getArtifactsByStatus(
  db: BetterSqlite3.Database,
  agentId: string,
  status: ArtifactStatus,
): readonly Artifact[] {
  return db
    .prepare(
      `SELECT ${ARTIFACT_COLUMNS}
       FROM artifacts
       WHERE agent_id = ? AND status = ?
       ORDER BY created_at DESC`,
    )
    .all(agentId, status) as Artifact[];
}

export function updateArtifactStatus(
  db: BetterSqlite3.Database,
  id: string,
  status: ArtifactStatus,
  approvedBy?: string,
): void {
  if (approvedBy && (status === "approved" || status === "rejected")) {
    db.prepare(
      `UPDATE artifacts
       SET status = ?, approved_by = ?, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(status, approvedBy, id);
  } else {
    db.prepare(
      `UPDATE artifacts
       SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(status, id);
  }
}
