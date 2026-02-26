PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS goals (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'in_progress', 'completed', 'cancelled')),
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
  status              TEXT NOT NULL CHECK (status IN ('success', 'failed', 'infra_unavailable')),
  output              TEXT,
  error               TEXT,
  execution_time_ms   INTEGER,
  tokens_used         INTEGER,
  artifact_size_bytes INTEGER,
  project_id          TEXT,
  trace_id            TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_outcomes_agent_id ON outcomes(agent_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_status ON outcomes(status);
CREATE INDEX IF NOT EXISTS idx_outcomes_project_id ON outcomes(project_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_created_at ON outcomes(created_at);

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
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('post', 'newsletter', 'landing', 'editorial_calendar', 'analysis')),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'published')),
  metadata    TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_artifacts_agent_id ON artifacts(agent_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);

CREATE TABLE IF NOT EXISTS publications (
  id           TEXT PRIMARY KEY,
  artifact_id  TEXT NOT NULL REFERENCES artifacts(id),
  channel      TEXT NOT NULL CHECK (channel IN ('x', 'linkedin', 'stub')),
  status       TEXT NOT NULL CHECK (status IN ('published', 'failed')),
  external_id  TEXT,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  error        TEXT,
  impressions  INTEGER,
  clicks       INTEGER,
  likes        INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_publications_artifact_id ON publications(artifact_id);
CREATE INDEX IF NOT EXISTS idx_publications_channel ON publications(channel);
CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(status);

CREATE TABLE IF NOT EXISTS marketing_metrics (
  id               TEXT PRIMARY KEY,
  artifact_id      TEXT NOT NULL REFERENCES artifacts(id),
  channel          TEXT NOT NULL,
  impressions      INTEGER NOT NULL DEFAULT 0,
  clicks           INTEGER NOT NULL DEFAULT 0,
  engagement_score REAL NOT NULL DEFAULT 0,
  source           TEXT NOT NULL CHECK (source IN ('stub', 'manual', 'api')),
  collected_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_marketing_metrics_artifact_id ON marketing_metrics(artifact_id);
CREATE INDEX IF NOT EXISTS idx_marketing_metrics_collected_at ON marketing_metrics(collected_at);

CREATE TABLE IF NOT EXISTS marketing_feedback (
  id               TEXT PRIMARY KEY,
  artifact_id      TEXT NOT NULL REFERENCES artifacts(id),
  message_type     TEXT NOT NULL,
  grade            TEXT NOT NULL CHECK (grade IN ('STRONG', 'AVERAGE', 'WEAK')),
  engagement_score REAL NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_marketing_feedback_message_type ON marketing_feedback(message_type);
CREATE INDEX IF NOT EXISTS idx_marketing_feedback_grade ON marketing_feedback(grade);
CREATE INDEX IF NOT EXISTS idx_marketing_feedback_created_at ON marketing_feedback(created_at);

CREATE TABLE IF NOT EXISTS code_changes (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL,
  description      TEXT NOT NULL,
  files_changed    TEXT NOT NULL,
  diff             TEXT,
  risk             INTEGER NOT NULL CHECK (risk BETWEEN 1 AND 5),
  status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'pending_approval', 'approved', 'applied', 'failed', 'rolled_back', 'rejected')),
  test_output      TEXT,
  error            TEXT,
  approved_by      TEXT,
  approved_at      TEXT,
  applied_at       TEXT,
  branch_name      TEXT,
  commits          TEXT,
  pending_files    TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_code_changes_status ON code_changes(status);
CREATE INDEX IF NOT EXISTS idx_code_changes_created_at ON code_changes(created_at);

CREATE TABLE IF NOT EXISTS pull_requests (
  id              TEXT PRIMARY KEY,
  code_change_id  TEXT NOT NULL REFERENCES code_changes(id),
  repo            TEXT NOT NULL,
  branch_name     TEXT NOT NULL,
  pr_number       INTEGER,
  pr_url          TEXT,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_push'
    CHECK (status IN ('pending_push', 'pending_approval', 'open', 'closed', 'merged')),
  risk            INTEGER NOT NULL,
  merge_status    TEXT,
  merge_report    TEXT,
  merge_checked_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_pull_requests_status ON pull_requests(status);
CREATE INDEX IF NOT EXISTS idx_pull_requests_code_change_id ON pull_requests(code_change_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_created_at ON pull_requests(created_at);

CREATE TABLE IF NOT EXISTS nexus_research (
  id              TEXT PRIMARY KEY,
  goal_id         TEXT NOT NULL,
  question        TEXT NOT NULL,
  options         TEXT NOT NULL,
  pros_cons       TEXT NOT NULL,
  risk_analysis   TEXT NOT NULL,
  recommendation  TEXT NOT NULL,
  raw_output      TEXT NOT NULL,
  tokens_used     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_nexus_research_goal_id ON nexus_research(goal_id);
CREATE INDEX IF NOT EXISTS idx_nexus_research_created_at ON nexus_research(created_at);

CREATE TABLE IF NOT EXISTS projects (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL UNIQUE,
  repo_source           TEXT NOT NULL,
  language              TEXT NOT NULL,
  framework             TEXT NOT NULL,
  risk_profile          TEXT NOT NULL CHECK (risk_profile IN ('low', 'medium', 'high')),
  autonomy_level        INTEGER NOT NULL CHECK (autonomy_level BETWEEN 1 AND 3),
  token_budget_monthly  INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'paused')),
  forge_executor        TEXT NOT NULL DEFAULT 'legacy' CHECK (forge_executor IN ('openclaw', 'legacy')),
  push_enabled          INTEGER,
  tokens_used_month     INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_project_id ON projects(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS governance_decisions (
  id                      TEXT PRIMARY KEY,
  cycle_id                TEXT NOT NULL,
  complexity              INTEGER NOT NULL,
  risk                    INTEGER NOT NULL,
  cost                    INTEGER NOT NULL,
  historical_stability    TEXT NOT NULL CHECK (historical_stability IN ('stable', 'moderate', 'unstable')),
  selected_model          TEXT NOT NULL,
  model_tier              TEXT NOT NULL CHECK (model_tier IN ('economy', 'standard', 'premium')),
  nexus_pre_research      INTEGER NOT NULL DEFAULT 0,
  nexus_research_id       TEXT,
  human_approval_required INTEGER NOT NULL DEFAULT 0,
  post_validation_status  TEXT CHECK (post_validation_status IN ('match', 'mismatch', 'escalation_needed')),
  post_validation_notes   TEXT,
  reasons                 TEXT NOT NULL,
  tokens_used             INTEGER,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_governance_decisions_created_at ON governance_decisions(created_at);
CREATE INDEX IF NOT EXISTS idx_governance_decisions_model_tier ON governance_decisions(model_tier);
