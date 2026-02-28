import path from "node:path";
import { logger } from "../../config/logger.js";

const DEFAULT_ALLOWED_WRITE_GLOBS: readonly string[] = [
  "src/",
  "app/",
  "apps/",
  "components/",
  "packages/",
  "tests/",
  "test/",
  "lib/",
  "modules/",
  "pages/",
  "views/",
  "routes/",
  "middleware/",
  "utils/",
  "helpers/",
  "hooks/",
  "styles/",
  "public/",
];

const FORBIDDEN_PATH_PREFIXES: readonly string[] = [
  ".git/",
  "node_modules/",
  ".pnpm/",
  "docker/",
  "infra/",
  ".github/",
  ".vscode/",
  ".cursor/",
];

const FORBIDDEN_EXACT_FILES: readonly string[] = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.staging",
  ".env.development",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  "manifest.yaml",
  "docker-compose.yml",
  "Dockerfile",
  "node_modules",
];

const FORBIDDEN_EXTENSIONS: ReadonlySet<string> = new Set([
  ".pem",
  ".key",
  ".cert",
  ".crt",
  ".p12",
  ".pfx",
  ".jks",
]);

const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".css",
  ".scss",
  ".html",
  ".md",
  ".sql",
  ".yaml",
  ".yml",
]);

export interface FileEdit {
  readonly search: string;
  readonly replace: string;
  readonly line?: number;
  readonly endLine?: number;
}

export interface FileChange {
  readonly path: string;
  readonly action: "create" | "modify";
  readonly content: string;
  readonly edits?: readonly FileEdit[];
}

export interface PathValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly requiresApproval: boolean;
}

export function validateProjectFilePaths(
  files: readonly FileChange[],
  workspacePath: string,
): PathValidationResult {
  const errors: string[] = [];
  let requiresApproval = false;

  for (const file of files) {
    const error = validateSingleFilePath(file.path, workspacePath);
    if (error) {
      errors.push(error);
      continue;
    }

    const normalized = path.normalize(file.path);
    if (!isInAllowedDirectory(normalized)) {
      requiresApproval = true;
      logger.info(
        { path: file.path },
        "File outside standard directories, will require approval",
      );
    }
  }

  return { valid: errors.length === 0, errors, requiresApproval };
}

function validateSingleFilePath(filePath: string, workspacePath: string): string | null {
  const normalized = path.normalize(filePath);

  if (path.isAbsolute(normalized)) return `Absolute path not allowed: ${filePath}`;
  if (normalized.includes("..")) return `Path traversal detected: ${filePath}`;

  const resolved = path.resolve(workspacePath, normalized);
  const relative = path.relative(workspacePath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return `Path escapes workspace: ${filePath}`;
  if (isForbiddenPath(normalized)) return `Forbidden path: ${filePath}`;

  const ext = path.extname(normalized);
  if (FORBIDDEN_EXTENSIONS.has(ext)) return `Forbidden extension (secret/cert): ${ext} (${filePath})`;
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) return `File extension not allowed: ${ext} (${filePath})`;

  return null;
}

export function sanitizeWorkspacePath(workspacePath: string, filePath: string): string {
  const normalized = path.normalize(filePath);

  if (path.isAbsolute(normalized)) {
    throw new ProjectSecurityError(`Absolute path not allowed: ${filePath}`);
  }

  if (normalized.includes("..")) {
    throw new ProjectSecurityError(`Path traversal detected: ${filePath}`);
  }

  const resolved = path.resolve(workspacePath, normalized);
  const relative = path.relative(workspacePath, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProjectSecurityError(`Path escapes workspace: ${filePath}`);
  }

  return resolved;
}

function isForbiddenPath(normalizedPath: string): boolean {
  for (const prefix of FORBIDDEN_PATH_PREFIXES) {
    if (normalizedPath.startsWith(prefix)) return true;
  }

  const basename = path.basename(normalizedPath);
  for (const forbidden of FORBIDDEN_EXACT_FILES) {
    if (basename === forbidden || normalizedPath === forbidden) return true;
  }

  if (normalizedPath.startsWith(".env")) return true;

  return false;
}

function isInAllowedDirectory(normalizedPath: string): boolean {
  return DEFAULT_ALLOWED_WRITE_GLOBS.some((dir) => normalizedPath.startsWith(dir));
}

export class ProjectSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectSecurityError";
  }
}
