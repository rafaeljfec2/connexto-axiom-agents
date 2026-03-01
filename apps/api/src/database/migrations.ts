import type BetterSqlite3 from "better-sqlite3";

export function applyMigrations(db: BetterSqlite3.Database): void {
  migrateProjectsOnboarding(db);
  migrateProjectEmbeddings(db);
}

function migrateProjectsOnboarding(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(projects)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("git_repository_url")) {
    db.exec("ALTER TABLE projects ADD COLUMN git_repository_url TEXT");
  }
  if (!columnNames.has("onboarding_status")) {
    db.exec("ALTER TABLE projects ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!columnNames.has("onboarding_error")) {
    db.exec("ALTER TABLE projects ADD COLUMN onboarding_error TEXT");
  }
  if (!columnNames.has("stack_detected")) {
    db.exec("ALTER TABLE projects ADD COLUMN stack_detected TEXT");
  }
  if (!columnNames.has("files_total")) {
    db.exec("ALTER TABLE projects ADD COLUMN files_total INTEGER DEFAULT 0");
  }
  if (!columnNames.has("files_indexed")) {
    db.exec("ALTER TABLE projects ADD COLUMN files_indexed INTEGER DEFAULT 0");
  }
  if (!columnNames.has("docs_status")) {
    db.exec("ALTER TABLE projects ADD COLUMN docs_status TEXT DEFAULT 'pending'");
  }
  if (!columnNames.has("index_status")) {
    db.exec("ALTER TABLE projects ADD COLUMN index_status TEXT DEFAULT 'pending'");
  }
  if (!columnNames.has("onboarding_started_at")) {
    db.exec("ALTER TABLE projects ADD COLUMN onboarding_started_at TEXT");
  }
  if (!columnNames.has("onboarding_completed_at")) {
    db.exec("ALTER TABLE projects ADD COLUMN onboarding_completed_at TEXT");
  }
}

function migrateProjectEmbeddings(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_embeddings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding BLOB NOT NULL,
      tokens_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_embeddings_project ON project_embeddings(project_id);
    CREATE INDEX IF NOT EXISTS idx_embeddings_file ON project_embeddings(project_id, file_path);
  `);
}
