export type RiskProfile = "low" | "medium" | "high";
export type AutonomyLevel = 1 | 2 | 3;
export type ProjectStatus = "active" | "maintenance" | "paused";

export interface ProjectStack {
  readonly language: string;
  readonly framework: string;
}

export interface ProjectManifest {
  readonly projectId: string;
  readonly repoSource: string;
  readonly stack: ProjectStack;
  readonly riskProfile: RiskProfile;
  readonly autonomyLevel: AutonomyLevel;
  readonly tokenBudgetMonthly: number;
  readonly status: ProjectStatus;
}

const PROJECT_ID_REGEX = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const MIN_PROJECT_ID_LENGTH = 2;
const MAX_PROJECT_ID_LENGTH = 64;

const VALID_RISK_PROFILES: readonly RiskProfile[] = ["low", "medium", "high"];
const VALID_AUTONOMY_LEVELS: readonly AutonomyLevel[] = [1, 2, 3];
const VALID_STATUSES: readonly ProjectStatus[] = ["active", "maintenance", "paused"];

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

  return {
    projectId,
    repoSource,
    stack,
    riskProfile,
    autonomyLevel,
    tokenBudgetMonthly,
    status,
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

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestValidationError";
  }
}
