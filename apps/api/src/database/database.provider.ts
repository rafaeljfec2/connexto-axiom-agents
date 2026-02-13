import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";

export const DATABASE_TOKEN = "DATABASE_CONNECTION";

export type DatabaseConnection = InstanceType<typeof Database>;

function resolveDbPath(): string {
  if (process.env.AXIOM_DB_PATH) {
    return process.env.AXIOM_DB_PATH;
  }

  const fromCwd = path.resolve(process.cwd(), "state", "local.db");
  if (fs.existsSync(path.dirname(fromCwd))) {
    return fromCwd;
  }

  return path.resolve(process.cwd(), "..", "..", "state", "local.db");
}

export const databaseProvider = {
  provide: DATABASE_TOKEN,
  useFactory: (): DatabaseConnection => {
    const dbPath = resolveDbPath();

    if (!fs.existsSync(path.dirname(dbPath))) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const schemaPath = path.resolve(path.dirname(dbPath), "schema.sql");
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, "utf-8");
      db.exec(schema);
    }

    console.log(`Database connected: ${dbPath}`);
    return db;
  },
};
