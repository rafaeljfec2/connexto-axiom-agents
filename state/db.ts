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
