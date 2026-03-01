import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import type { ForgeExecutorMode, ProjectManifest, ProjectStatus } from "../projects/manifest.schema.js";

export interface Project {
  readonly id: string;
  readonly project_id: string;
  readonly repo_source: string;
  readonly language: string;
  readonly framework: string;
  readonly risk_profile: string;
  readonly autonomy_level: number;
  readonly token_budget_monthly: number;
  readonly status: string;
  readonly forge_executor: ForgeExecutorMode;
  readonly base_branch: string;
  readonly push_enabled: number | null;
  readonly tokens_used_month: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly git_repository_url: string | null;
  readonly onboarding_status: string;
  readonly onboarding_error: string | null;
  readonly stack_detected: string | null;
  readonly files_total: number;
  readonly files_indexed: number;
  readonly docs_status: string;
  readonly index_status: string;
  readonly onboarding_started_at: string | null;
  readonly onboarding_completed_at: string | null;
}

const COLUMNS = `id, project_id, repo_source, language, framework, risk_profile, autonomy_level, token_budget_monthly, status, forge_executor, base_branch, push_enabled, tokens_used_month, created_at, updated_at, git_repository_url, onboarding_status, onboarding_error, stack_detected, files_total, files_indexed, docs_status, index_status, onboarding_started_at, onboarding_completed_at`;

export function saveProject(db: BetterSqlite3.Database, manifest: ProjectManifest): void {
  const existing = getProjectById(db, manifest.projectId);

  let pushEnabledValue: number | null = null;
  if (manifest.pushEnabled === true) pushEnabledValue = 1;
  else if (manifest.pushEnabled === false) pushEnabledValue = 0;

  const baseBranchValue = manifest.baseBranch ?? "main";

  if (existing) {
    db.prepare(
      `UPDATE projects SET
        repo_source = ?,
        language = ?,
        framework = ?,
        risk_profile = ?,
        autonomy_level = ?,
        token_budget_monthly = ?,
        status = ?,
        forge_executor = ?,
        base_branch = ?,
        push_enabled = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE project_id = ?`,
    ).run(
      manifest.repoSource,
      manifest.stack.language,
      manifest.stack.framework,
      manifest.riskProfile,
      manifest.autonomyLevel,
      manifest.tokenBudgetMonthly,
      manifest.status,
      manifest.forgeExecutor,
      baseBranchValue,
      pushEnabledValue,
      manifest.projectId,
    );
  } else {
    db.prepare(
      `INSERT INTO projects (id, project_id, repo_source, language, framework, risk_profile, autonomy_level, token_budget_monthly, status, forge_executor, base_branch, push_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      manifest.projectId,
      manifest.repoSource,
      manifest.stack.language,
      manifest.stack.framework,
      manifest.riskProfile,
      manifest.autonomyLevel,
      manifest.tokenBudgetMonthly,
      manifest.status,
      manifest.forgeExecutor,
      baseBranchValue,
      pushEnabledValue,
    );
  }
}

export function getActiveProject(db: BetterSqlite3.Database): Project | null {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM projects WHERE status = 'active' ORDER BY created_at ASC`,
    )
    .all() as Project[];

  if (rows.length === 0) return null;

  if (rows.length > 1) {
    logger.warn(
      { activeCount: rows.length, selected: rows[0].project_id },
      "Multiple active projects found, using first by creation date",
    );
  }

  return rows[0];
}

export function getAllProjects(db: BetterSqlite3.Database): readonly Project[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM projects ORDER BY status ASC, created_at ASC`)
    .all() as Project[];
}

export function getProjectById(
  db: BetterSqlite3.Database,
  projectId: string,
): Project | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM projects WHERE project_id = ?`)
    .get(projectId) as Project | undefined;

  return row ?? null;
}

export function updateProjectStatus(
  db: BetterSqlite3.Database,
  projectId: string,
  status: ProjectStatus,
): void {
  db.prepare(
    `UPDATE projects SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ?`,
  ).run(status, projectId);
}

export function getProjectTokenUsage(
  db: BetterSqlite3.Database,
  projectId: string,
): number {
  const row = db
    .prepare(`SELECT tokens_used_month FROM projects WHERE project_id = ?`)
    .get(projectId) as { tokens_used_month: number } | undefined;

  return row?.tokens_used_month ?? 0;
}

export function incrementProjectTokens(
  db: BetterSqlite3.Database,
  projectId: string,
  tokens: number,
): void {
  db.prepare(
    `UPDATE projects SET tokens_used_month = tokens_used_month + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ?`,
  ).run(tokens, projectId);
}

export function syncProjectsFromManifests(
  db: BetterSqlite3.Database,
  manifests: readonly ProjectManifest[],
): void {
  if (manifests.length === 0) {
    logger.info("No manifests to sync");
    return;
  }

  for (const manifest of manifests) {
    saveProject(db, manifest);
    logger.info({ projectId: manifest.projectId, status: manifest.status }, "Project synced from manifest");
  }

  logger.info({ count: manifests.length }, "Projects synced from manifests");
}

function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^a-z0-9-]/g, "");
  if (slug.length >= 2 && /^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return slug;
  }
  const fallback = slug || "project";
  return "project-" + fallback.replaceAll(/(?:^-+)|(?:-+$)/g, "").slice(0, 50);
}

export function createProjectFromUI(
  db: BetterSqlite3.Database,
  params: { projectName: string; gitRepositoryUrl: string },
): Project {
  const projectId = slugifyProjectName(params.projectName);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO projects (
      id, project_id, repo_source, language, framework, risk_profile,
      autonomy_level, token_budget_monthly, status, forge_executor, base_branch,
      push_enabled, git_repository_url, onboarding_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    params.gitRepositoryUrl,
    "unknown",
    "unknown",
    "medium",
    1,
    100000,
    "paused",
    "legacy",
    "main",
    null,
    params.gitRepositoryUrl,
    "pending",
  );
  const created = getProjectById(db, projectId);
  if (!created) {
    throw new Error("Failed to create project");
  }
  return created;
}

export function updateOnboardingStatus(
  db: BetterSqlite3.Database,
  projectId: string,
  status: string,
  error?: string,
): void {
  const updates: string[] = ["onboarding_status = ?", "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"];
  const values: (string | null)[] = [status];
  if (error !== undefined) {
    updates.push("onboarding_error = ?");
    values.push(error);
  }
  values.push(projectId);
  db.prepare(
    `UPDATE projects SET ${updates.join(", ")} WHERE project_id = ?`,
  ).run(...values);
}

export function updateOnboardingProgress(
  db: BetterSqlite3.Database,
  projectId: string,
  updates: {
    files_total?: number;
    files_indexed?: number;
    docs_status?: string;
    index_status?: string;
    stack_detected?: string;
  },
): void {
  const setClauses: string[] = ["updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"];
  const values: (number | string)[] = [];
  if (updates.files_total !== undefined) {
    setClauses.push("files_total = ?");
    values.push(updates.files_total);
  }
  if (updates.files_indexed !== undefined) {
    setClauses.push("files_indexed = ?");
    values.push(updates.files_indexed);
  }
  if (updates.docs_status !== undefined) {
    setClauses.push("docs_status = ?");
    values.push(updates.docs_status);
  }
  if (updates.index_status !== undefined) {
    setClauses.push("index_status = ?");
    values.push(updates.index_status);
  }
  if (updates.stack_detected !== undefined) {
    setClauses.push("stack_detected = ?");
    values.push(updates.stack_detected);
  }
  if (setClauses.length <= 1) return;
  values.push(projectId);
  db.prepare(
    `UPDATE projects SET ${setClauses.join(", ")} WHERE project_id = ?`,
  ).run(...values);
}
