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
  readonly push_enabled: number | null;
  readonly tokens_used_month: number;
  readonly created_at: string;
  readonly updated_at: string;
}

const COLUMNS = `id, project_id, repo_source, language, framework, risk_profile, autonomy_level, token_budget_monthly, status, forge_executor, push_enabled, tokens_used_month, created_at, updated_at`;

export function saveProject(db: BetterSqlite3.Database, manifest: ProjectManifest): void {
  const existing = getProjectById(db, manifest.projectId);

  let pushEnabledValue: number | null = null;
  if (manifest.pushEnabled === true) pushEnabledValue = 1;
  else if (manifest.pushEnabled === false) pushEnabledValue = 0;

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
      pushEnabledValue,
      manifest.projectId,
    );
  } else {
    db.prepare(
      `INSERT INTO projects (id, project_id, repo_source, language, framework, risk_profile, autonomy_level, token_budget_monthly, status, forge_executor, push_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
