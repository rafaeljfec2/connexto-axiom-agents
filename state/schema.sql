PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS goals (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS decisions (
  id         TEXT PRIMARY KEY,
  task_id    TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  agent_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  reasoning  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS metrics (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL,
  metric_name  TEXT NOT NULL,
  metric_value REAL NOT NULL,
  recorded_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_id ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_decisions_agent_id ON decisions(agent_id);
CREATE INDEX IF NOT EXISTS idx_decisions_task_id ON decisions(task_id);
CREATE INDEX IF NOT EXISTS idx_metrics_agent_id ON metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);

CREATE TABLE IF NOT EXISTS outcomes (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL,
  task                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  output              TEXT,
  error               TEXT,
  execution_time_ms   INTEGER,
  tokens_used         INTEGER,
  artifact_size_bytes INTEGER,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_outcomes_agent_id ON outcomes(agent_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_status ON outcomes(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id                 TEXT PRIMARY KEY,
  agent_id           TEXT NOT NULL,
  action             TEXT NOT NULL,
  input_hash         TEXT NOT NULL,
  output_hash        TEXT,
  sanitizer_warnings TEXT,
  runtime            TEXT NOT NULL CHECK (runtime IN ('local', 'openclaw')),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_id ON audit_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_runtime ON audit_log(runtime);

CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY,
  period       TEXT NOT NULL UNIQUE,
  total_tokens INTEGER NOT NULL,
  used_tokens  INTEGER NOT NULL DEFAULT 0,
  hard_limit   INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(period);

CREATE TABLE IF NOT EXISTS token_usage (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens  INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_token_usage_agent_id ON token_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);

CREATE TABLE IF NOT EXISTS agent_feedback (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  task_type  TEXT NOT NULL,
  grade      TEXT NOT NULL CHECK (grade IN ('SUCCESS', 'PARTIAL', 'FAILURE')),
  reasons    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_feedback_agent_id ON agent_feedback(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_task_type ON agent_feedback(task_type);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_created_at ON agent_feedback(created_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('post', 'newsletter', 'landing', 'editorial_calendar', 'analysis')),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  metadata   TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_artifacts_agent_id ON artifacts(agent_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
