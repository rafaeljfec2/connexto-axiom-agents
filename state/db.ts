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

export function applyMigrations(db: BetterSqlite3.Database): void {
  migrateOutcomesColumns(db);
  migrateArtifactsColumns(db);
  migrateCodeChangesColumns(db);
  migratePullRequestsMergeColumns(db);
  migrateGoalsProjectId(db);
  migrateCodeChangesProjectId(db);
  migrateOutcomesProjectId(db);
  migrateGovernanceDecisions(db);
  migrateOutcomesTraceId(db);
  migrateProjectsForgeExecutor(db);
  migrateProjectsPushEnabled(db);
  migrateProjectsBaseBranch(db);
  migrateGoalsInProgressStatus(db);
  migrateGoalsCodeReviewStatus(db);
  migrateTokenUsageCacheColumns(db);
  migrateProjectsOnboarding(db);
  migrateProjectEmbeddings(db);
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

function migrateGovernanceDecisions(db: BetterSqlite3.Database): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='governance_decisions'")
    .all() as ReadonlyArray<{ name: string }>;

  if (tables.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS governance_decisions (
        id                      TEXT PRIMARY KEY,
        cycle_id                TEXT NOT NULL,
        complexity              INTEGER NOT NULL,
        risk                    INTEGER NOT NULL,
        cost                    INTEGER NOT NULL,
        historical_stability    TEXT NOT NULL,
        selected_model          TEXT NOT NULL,
        model_tier              TEXT NOT NULL,
        nexus_pre_research      INTEGER NOT NULL DEFAULT 0,
        nexus_research_id       TEXT,
        human_approval_required INTEGER NOT NULL DEFAULT 0,
        post_validation_status  TEXT,
        post_validation_notes   TEXT,
        reasons                 TEXT NOT NULL,
        tokens_used             INTEGER,
        created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_governance_decisions_created_at ON governance_decisions(created_at);
      CREATE INDEX IF NOT EXISTS idx_governance_decisions_model_tier ON governance_decisions(model_tier);
    `);
  }
}

function migrateOutcomesTraceId(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(outcomes)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("trace_id")) {
    db.exec("ALTER TABLE outcomes ADD COLUMN trace_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_outcomes_trace_id ON outcomes(trace_id)");
  }
}

function migrateProjectsForgeExecutor(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(projects)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("forge_executor")) {
    db.exec("ALTER TABLE projects ADD COLUMN forge_executor TEXT NOT NULL DEFAULT 'legacy'");
  }
}

function migrateProjectsPushEnabled(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(projects)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("push_enabled")) {
    db.exec("ALTER TABLE projects ADD COLUMN push_enabled INTEGER");
  }
}

function migrateProjectsBaseBranch(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(projects)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("base_branch")) {
    db.exec("ALTER TABLE projects ADD COLUMN base_branch TEXT NOT NULL DEFAULT 'main'");
  }
}

function migrateGoalsInProgressStatus(db: BetterSqlite3.Database): void {
  const tableInfo = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='goals'")
    .get() as { sql: string } | undefined;

  if (tableInfo && !tableInfo.sql.includes("in_progress")) {
    db.exec(`
      CREATE TABLE goals_new (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'in_progress', 'completed', 'cancelled')),
        priority    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        project_id  TEXT
      );
      INSERT INTO goals_new SELECT id, title, description, status, priority, created_at, updated_at, project_id FROM goals;
      DROP TABLE goals;
      ALTER TABLE goals_new RENAME TO goals;
      CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
      CREATE INDEX IF NOT EXISTS idx_goals_project_id ON goals(project_id);
    `);
  }
}

function migrateGoalsCodeReviewStatus(db: BetterSqlite3.Database): void {
  const tableInfo = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='goals'")
    .get() as { sql: string } | undefined;

  if (tableInfo && !tableInfo.sql.includes("code_review")) {
    db.exec(`
      CREATE TABLE goals_new (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'in_progress', 'code_review', 'completed', 'cancelled')),
        priority    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        project_id  TEXT
      );
      INSERT INTO goals_new SELECT id, title, description, status, priority, created_at, updated_at, project_id FROM goals;
      DROP TABLE goals;
      ALTER TABLE goals_new RENAME TO goals;
      CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
      CREATE INDEX IF NOT EXISTS idx_goals_project_id ON goals(project_id);
    `);
  }
}

function migrateTokenUsageCacheColumns(db: BetterSqlite3.Database): void {
  const columns = db.pragma("table_info(token_usage)") as ReadonlyArray<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("cache_read_tokens")) {
    db.exec("ALTER TABLE token_usage ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnNames.has("cache_creation_tokens")) {
    db.exec("ALTER TABLE token_usage ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnNames.has("cost_usd")) {
    db.exec("ALTER TABLE token_usage ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0");
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
