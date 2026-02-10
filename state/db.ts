import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";

const DB_PATH = "state/local.db";
const SCHEMA_PATH = path.resolve("state", "schema.sql");

export function openDatabase(): BetterSqlite3.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);

  applyMigrations(db);

  return db;
}

function applyMigrations(db: BetterSqlite3.Database): void {
  migrateOutcomesColumns(db);
  migrateArtifactsColumns(db);
  migrateCodeChangesColumns(db);
  migratePullRequestsMergeColumns(db);
  migrateGoalsProjectId(db);
  migrateCodeChangesProjectId(db);
  migrateOutcomesProjectId(db);
}

function migrateArtifactsColumns(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(artifacts)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("approved_by")) {
    db.exec("ALTER TABLE artifacts ADD COLUMN approved_by TEXT");
  }
  if (!columnNames.has("approved_at")) {
    db.exec("ALTER TABLE artifacts ADD COLUMN approved_at TEXT");
  }
}

function migrateCodeChangesColumns(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(code_changes)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("branch_name")) {
    db.exec("ALTER TABLE code_changes ADD COLUMN branch_name TEXT");
  }
  if (!columnNames.has("commits")) {
    db.exec("ALTER TABLE code_changes ADD COLUMN commits TEXT");
  }
  if (!columnNames.has("pending_files")) {
    db.exec("ALTER TABLE code_changes ADD COLUMN pending_files TEXT");
  }
}

function migratePullRequestsMergeColumns(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(pull_requests)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("merge_status")) {
    db.exec("ALTER TABLE pull_requests ADD COLUMN merge_status TEXT");
  }
  if (!columnNames.has("merge_report")) {
    db.exec("ALTER TABLE pull_requests ADD COLUMN merge_report TEXT");
  }
  if (!columnNames.has("merge_checked_at")) {
    db.exec("ALTER TABLE pull_requests ADD COLUMN merge_checked_at TEXT");
  }
}

function migrateCodeChangesProjectId(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(code_changes)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("project_id")) {
    db.exec("ALTER TABLE code_changes ADD COLUMN project_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_code_changes_project_id ON code_changes(project_id)");
  }
}

function migrateGoalsProjectId(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(goals)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("project_id")) {
    db.exec("ALTER TABLE goals ADD COLUMN project_id TEXT");
    db.exec("UPDATE goals SET project_id = 'connexto-digital-signer' WHERE project_id IS NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_goals_project_id ON goals(project_id)");
  }
}

function migrateOutcomesProjectId(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(outcomes)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("project_id")) {
    db.exec("ALTER TABLE outcomes ADD COLUMN project_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_outcomes_project_id ON outcomes(project_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_outcomes_created_at ON outcomes(created_at)");
  }
}

function migrateOutcomesColumns(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(outcomes)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("execution_time_ms")) {
    db.exec("ALTER TABLE outcomes ADD COLUMN execution_time_ms INTEGER");
  }
  if (!columnNames.has("tokens_used")) {
    db.exec("ALTER TABLE outcomes ADD COLUMN tokens_used INTEGER");
  }
  if (!columnNames.has("artifact_size_bytes")) {
    db.exec("ALTER TABLE outcomes ADD COLUMN artifact_size_bytes INTEGER");
  }
}
