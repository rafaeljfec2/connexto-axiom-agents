import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export type ArtifactType = "post" | "newsletter" | "landing" | "editorial_calendar" | "analysis";
export type ArtifactStatus = "draft" | "approved" | "rejected";

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
  readonly created_at: string;
  readonly updated_at: string;
}

export function saveArtifact(db: BetterSqlite3.Database, entry: ArtifactEntry): string {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO artifacts (id, agent_id, type, title, content, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, entry.agentId, entry.type, entry.title, entry.content, entry.metadata ?? null);

  return id;
}

export function getArtifactById(db: BetterSqlite3.Database, id: string): Artifact | undefined {
  return db
    .prepare(
      `SELECT id, agent_id, type, title, content, status, metadata, created_at, updated_at
       FROM artifacts WHERE id = ?`,
    )
    .get(id) as Artifact | undefined;
}

export function getPendingArtifacts(
  db: BetterSqlite3.Database,
  agentId: string,
): readonly Artifact[] {
  return db
    .prepare(
      `SELECT id, agent_id, type, title, content, status, metadata, created_at, updated_at
       FROM artifacts
       WHERE agent_id = ? AND status = 'draft'
       ORDER BY created_at DESC`,
    )
    .all(agentId) as Artifact[];
}

export function updateArtifactStatus(
  db: BetterSqlite3.Database,
  id: string,
  status: ArtifactStatus,
): void {
  db.prepare(
    `UPDATE artifacts
     SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(status, id);
}
