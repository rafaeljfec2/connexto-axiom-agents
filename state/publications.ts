import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export interface PublicationEntry {
  readonly artifactId: string;
  readonly channel: "x" | "linkedin" | "stub";
  readonly status: "published" | "failed";
  readonly externalId?: string;
  readonly error?: string;
}

export interface Publication {
  readonly id: string;
  readonly artifact_id: string;
  readonly channel: string;
  readonly status: string;
  readonly external_id: string | null;
  readonly published_at: string;
  readonly error: string | null;
  readonly impressions: number | null;
  readonly clicks: number | null;
  readonly likes: number | null;
  readonly created_at: string;
}

const PUBLICATION_COLUMNS = `id, artifact_id, channel, status, external_id, published_at, error, impressions, clicks, likes, created_at`;

export function savePublication(db: BetterSqlite3.Database, entry: PublicationEntry): string {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO publications (id, artifact_id, channel, status, external_id, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.artifactId,
    entry.channel,
    entry.status,
    entry.externalId ?? null,
    entry.error ?? null,
  );

  return id;
}

export function getPublicationsByArtifact(
  db: BetterSqlite3.Database,
  artifactId: string,
): readonly Publication[] {
  return db
    .prepare(
      `SELECT ${PUBLICATION_COLUMNS}
       FROM publications
       WHERE artifact_id = ?
       ORDER BY created_at DESC`,
    )
    .all(artifactId) as Publication[];
}

export function getRecentPublications(
  db: BetterSqlite3.Database,
  limit: number = 10,
): readonly Publication[] {
  return db
    .prepare(
      `SELECT ${PUBLICATION_COLUMNS}
       FROM publications
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Publication[];
}

export function getPublicationCount7d(db: BetterSqlite3.Database): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM publications
       WHERE status = 'published'
         AND created_at >= datetime('now', '-7 days')`,
    )
    .get() as { count: number };

  return row.count;
}
