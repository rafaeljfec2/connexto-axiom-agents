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

  return db;
}
