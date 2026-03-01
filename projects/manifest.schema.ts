export type RiskProfile = "low" | "medium" | "high";
export type AutonomyLevel = 1 | 2 | 3;
export type ProjectStatus = "active" | "maintenance" | "paused";
export type ForgeExecutorMode = "openclaw" | "legacy" | "claude-cli";

export interface ProjectStack {
  readonly language: string;
  readonly framework: string;
}

export interface ReferencesConfig {
  readonly maxTokens: number;
  readonly includeGlobal: boolean;
}

export interface ProjectManifest {
  readonly projectId: string;
  readonly repoSource: string;
  readonly stack: ProjectStack;
  readonly riskProfile: RiskProfile;
  readonly autonomyLevel: AutonomyLevel;
  readonly tokenBudgetMonthly: number;
  readonly status: ProjectStatus;
  readonly forgeExecutor: ForgeExecutorMode;
  readonly baseBranch?: string;
  readonly pushEnabled?: boolean;
  readonly references?: ReferencesConfig;
}

const PROJECT_ID_REGEX = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const MIN_PROJECT_ID_LENGTH = 2;
const MAX_PROJECT_ID_LENGTH = 64;

const VALID_RISK_PROFILES: readonly RiskProfile[] = ["low", "medium", "high"];
const VALID_AUTONOMY_LEVELS: readonly AutonomyLevel[] = [1, 2, 3];
const VALID_STATUSES: readonly ProjectStatus[] = ["active", "maintenance", "paused"];
const VALID_FORGE_EXECUTORS: readonly ForgeExecutorMode[] = ["openclaw", "legacy", "claude-cli"];

export function validateManifest(raw: unknown): ProjectManifest {
  if (raw === null || typeof raw !== "object") {
    throw new ManifestValidationError("Manifest must be a non-null object");
  }

  const record = raw as Record<string, unknown>;

  const projectId = validateProjectId(record["project_id"] ?? record["projectId"]);
  const repoSource = validateNonEmptyString(record["repo_source"] ?? record["repoSource"], "repo_source");
  const stack = validateStack(record["stack"]);
  const riskProfile = validateRiskProfile(record["risk_profile"] ?? record["riskProfile"]);
  const autonomyLevel = validateAutonomyLevel(record["autonomy_level"] ?? record["autonomyLevel"]);
  const tokenBudgetMonthly = validateTokenBudget(record["token_budget_monthly"] ?? record["tokenBudgetMonthly"]);
  const status = validateStatus(record["status"]);
  const forgeExecutor = validateForgeExecutor(record["forge_executor"] ?? record["forgeExecutor"]);
  const baseBranch = validateBaseBranch(record["base_branch"] ?? record["baseBranch"]);
  const pushEnabled = validatePushEnabled(record["push_enabled"] ?? record["pushEnabled"]);
  const references = validateReferencesConfig(record["references"]);

  return {
    projectId,
    repoSource,
    stack,
    riskProfile,
    autonomyLevel,
    tokenBudgetMonthly,
    status,
    forgeExecutor,
    baseBranch,
    pushEnabled,
    references,
  };
}

function validateProjectId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ManifestValidationError("project_id must be a non-empty string");
  }

  const id = value.trim();

  if (id.length < MIN_PROJECT_ID_LENGTH || id.length > MAX_PROJECT_ID_LENGTH) {
    throw new ManifestValidationError(
      `project_id must be between ${String(MIN_PROJECT_ID_LENGTH)} and ${String(MAX_PROJECT_ID_LENGTH)} characters, got ${String(id.length)}`,
    );
  }

  if (!PROJECT_ID_REGEX.test(id)) {
    throw new ManifestValidationError(
      `project_id must be kebab-case (lowercase letters, numbers, hyphens): "${id}"`,
    );
  }

  return id;
}

function validateNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ManifestValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function validateStack(value: unknown): ProjectStack {
  if (value === null || typeof value !== "object") {
    throw new ManifestValidationError("stack must be an object with language and framework");
  }

  const record = value as Record<string, unknown>;
  const language = validateNonEmptyString(record["language"], "stack.language");
  const framework = validateNonEmptyString(record["framework"], "stack.framework");

  return { language, framework };
}

function validateRiskProfile(value: unknown): RiskProfile {
  if (typeof value !== "string" || !VALID_RISK_PROFILES.includes(value as RiskProfile)) {
    throw new ManifestValidationError(
      `risk_profile must be one of: ${VALID_RISK_PROFILES.join(", ")}. Got: "${String(value)}"`,
    );
  }
  return value as RiskProfile;
}

function validateAutonomyLevel(value: unknown): AutonomyLevel {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !VALID_AUTONOMY_LEVELS.includes(num as AutonomyLevel)) {
    throw new ManifestValidationError(
      `autonomy_level must be one of: ${VALID_AUTONOMY_LEVELS.join(", ")}. Got: "${String(value)}"`,
    );
  }
  return num as AutonomyLevel;
}

function validateTokenBudget(value: unknown): number {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || num <= 0) {
    throw new ManifestValidationError(
      `token_budget_monthly must be a positive number. Got: "${String(value)}"`,
    );
  }
  return num;
}

function validateStatus(value: unknown): ProjectStatus {
  if (value === undefined || value === null) {
    return "active";
  }
  if (typeof value !== "string" || !VALID_STATUSES.includes(value as ProjectStatus)) {
    throw new ManifestValidationError(
      `status must be one of: ${VALID_STATUSES.join(", ")}. Got: "${String(value)}"`,
    );
  }
  return value as ProjectStatus;
}

function validateForgeExecutor(value: unknown): ForgeExecutorMode {
  if (value === undefined || value === null) {
    return "legacy";
  }
  if (typeof value !== "string" || !VALID_FORGE_EXECUTORS.includes(value as ForgeExecutorMode)) {
    throw new ManifestValidationError(
      `forge_executor must be one of: ${VALID_FORGE_EXECUTORS.join(", ")}. Got: "${String(value)}"`,
    );
  }
  return value as ForgeExecutorMode;
}

const BASE_BRANCH_REGEX = /^[a-zA-Z0-9._/-]+$/;

function validateBaseBranch(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ManifestValidationError(
      `base_branch must be a non-empty string. Got: "${String(value)}"`,
    );
  }
  const trimmed = value.trim();
  if (!BASE_BRANCH_REGEX.test(trimmed)) {
    throw new ManifestValidationError(
      `base_branch contains invalid characters: "${trimmed}"`,
    );
  }
  return trimmed;
}

function validatePushEnabled(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ManifestValidationError(
      `push_enabled must be a boolean. Got: "${String(value)}"`,
    );
  }
  return value;
}

function validateReferencesConfig(value: unknown): ReferencesConfig | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value !== "object") {
    throw new ManifestValidationError("references must be an object with max_tokens and include_global");
  }

  const record = value as Record<string, unknown>;

  const rawMaxTokens = record["max_tokens"] ?? record["maxTokens"];
  const maxTokens = rawMaxTokens === undefined || rawMaxTokens === null
    ? 3000
    : Number(rawMaxTokens);

  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new ManifestValidationError(
      `references.max_tokens must be a positive number. Got: "${String(rawMaxTokens)}"`,
    );
  }

  const rawIncludeGlobal = record["include_global"] ?? record["includeGlobal"];
  const includeGlobal = rawIncludeGlobal === undefined || rawIncludeGlobal === null
    ? true
    : Boolean(rawIncludeGlobal);

  return { maxTokens, includeGlobal };
}

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestValidationError";
  }
}
