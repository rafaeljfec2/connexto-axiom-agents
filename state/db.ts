import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";

const DB_PATH = "state/local.db";

export function openDatabase(): BetterSqlite3.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
