import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";

export type ReviewSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface ReviewFinding {
  readonly severity: ReviewSeverity;
  readonly rule: string;
  readonly file: string;
  readonly line?: number;
  readonly message: string;
}

export interface ReviewResult {
  readonly passed: boolean;
  readonly findings: readonly ReviewFinding[];
  readonly criticalCount: number;
  readonly warningCount: number;
}

const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*["'][^"']{8,}/i,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}/i,
  /(?:token|bearer)\s*[:=]\s*["'][^"']{10,}/i,
  /(?:aws_access_key_id|aws_secret_access_key)\s*[:=]\s*["'][^"']+/i,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
];

const ANY_TYPE_PATTERN = /:\s*any\b(?!\w)/;
const OR_ASSIGNMENT_PATTERN = /(?<!\|\|)\s*\|\|\s*(?!.*(?:&&|console\.|logger\.))/;

const CONSOLE_LOG_PATTERN = /\bconsole\.(log|warn|error|info|debug)\s*\(/;
const HARDCODED_URL_PATTERN = /['"`]https?:\/\/[^'"`\s]+['"`]/;
const MAX_FUNCTION_PARAMS = 5;
const FUNCTION_PARAMS_PATTERN = /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?)\s*\(([^)]*)\)/;

const MAX_FILE_LINES = 800;

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz",
  ".lock",
]);

function shouldSkipFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

async function readFileLines(
  workspacePath: string,
  relativePath: string,
): Promise<readonly string[] | null> {
  try {
    const fullPath = path.join(workspacePath, relativePath);
    const content = await fsPromises.readFile(fullPath, "utf-8");
    return content.split("\n");
  } catch {
    return null;
  }
}

function checkSecrets(
  lines: readonly string[],
  filePath: string,
): readonly ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          severity: "CRITICAL",
          rule: "no-secrets",
          file: filePath,
          line: i + 1,
          message: "Possible secret or credential detected in source code",
        });
        break;
      }
    }
  }

  return findings;
}

function checkAnyType(
  lines: readonly string[],
  filePath: string,
): readonly ReviewFinding[] {
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return [];

  const findings: ReviewFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (ANY_TYPE_PATTERN.test(lines[i])) {
      findings.push({
        severity: "WARNING",
        rule: "no-any-type",
        file: filePath,
        line: i + 1,
        message: "Usage of `any` type — define a proper type instead",
      });
    }
  }

  return findings;
}

function checkOrAssignment(
  lines: readonly string[],
  filePath: string,
): readonly ReviewFinding[] {
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return [];

  const findings: ReviewFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (OR_ASSIGNMENT_PATTERN.test(line) && /=.*\|\|/.test(line)) {
      findings.push({
        severity: "WARNING",
        rule: "prefer-nullish-coalescing",
        file: filePath,
        line: i + 1,
        message: "Use `??` instead of `||` for nullish coalescing",
      });
    }
  }

  return findings;
}

function checkFileLength(
  lines: readonly string[],
  filePath: string,
): readonly ReviewFinding[] {
  if (lines.length > MAX_FILE_LINES) {
    return [{
      severity: "WARNING",
      rule: "max-file-lines",
      file: filePath,
      message: `File has ${String(lines.length)} lines (max ${String(MAX_FILE_LINES)}) — consider splitting`,
    }];
  }
  return [];
}

function isTestFile(filePath: string): boolean {
  return /\.(test|spec|e2e)\.[jt]sx?$/.test(filePath)
    || filePath.includes("__test__")
    || filePath.includes("__tests__")
    || filePath.includes("__e2e__");
}

function checkConsoleLog(
  lines: readonly string[],
  filePath: string,
): readonly ReviewFinding[] {
  if (isTestFile(filePath)) return [];
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx") && !filePath.endsWith(".js") && !filePath.endsWith(".jsx")) return [];

  const findings: ReviewFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (CONSOLE_LOG_PATTERN.test(lines[i])) {
      findings.push({
        severity: "WARNING",
        rule: "no-console-log",
        file: filePath,
        line: i + 1,
        message: "Use a structured logger instead of console methods in production code",
      });
    }
  }

  return findings;
}

function checkHardcodedUrl(
  lines: readonly string[],
  filePath: string,
): readonly ReviewFinding[] {
  if (isTestFile(filePath)) return [];
  if (filePath.endsWith(".md") || filePath.endsWith(".json") || filePath.endsWith(".yaml") || filePath.endsWith(".yml")) return [];
  if (filePath.includes("config") || filePath.includes(".env")) return [];

  const findings: ReviewFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (HARDCODED_URL_PATTERN.test(line) && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")) {
      findings.push({
        severity: "WARNING",
        rule: "no-hardcoded-url",
        file: filePath,
        line: i + 1,
        message: "Hardcoded URL detected — use environment variables or configuration",
      });
    }
  }

  return findings;
}

function checkFloatingPromise(
  lines: readonly string[],
  filePath: string,
): readonly ReviewFinding[] {
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return [];

  const findings: ReviewFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      /^\w+\.\w+\(/.test(line)
      && !line.startsWith("await ")
      && !line.startsWith("return ")
      && !line.startsWith("const ")
      && !line.startsWith("let ")
      && !line.startsWith("var ")
      && !line.includes(".then(")
      && !line.includes(".catch(")
      && line.endsWith(";")
      && /(?:async|promise|fetch|save|create|update|delete|send|post|get|put|patch)/i.test(line)
    ) {
      findings.push({
        severity: "WARNING",
        rule: "no-floating-promise",
        file: filePath,
        line: i + 1,
        message: "Possible floating promise — add `await`, `.then()`, or `.catch()`",
      });
    }
  }

  return findings;
}

function checkFunctionParams(
  lines: readonly string[],
  filePath: string,
): readonly ReviewFinding[] {
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return [];

  const findings: ReviewFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = FUNCTION_PARAMS_PATTERN.exec(lines[i]);
    if (match?.[1]) {
      const params = match[1].split(",").filter((p) => p.trim().length > 0);
      if (params.length > MAX_FUNCTION_PARAMS) {
        findings.push({
          severity: "INFO",
          rule: "max-function-params",
          file: filePath,
          line: i + 1,
          message: `Function has ${String(params.length)} parameters (max ${String(MAX_FUNCTION_PARAMS)}) — consider using an options object`,
        });
      }
    }
  }

  return findings;
}

export interface ReviewStackContext {
  readonly language?: string;
  readonly framework?: string;
}

export async function runHeuristicReview(
  workspacePath: string,
  changedFiles: readonly string[],
  _stackContext?: ReviewStackContext,
): Promise<ReviewResult> {
  const allFindings: ReviewFinding[] = [];

  for (const filePath of changedFiles) {
    if (shouldSkipFile(filePath)) continue;

    const lines = await readFileLines(workspacePath, filePath);
    if (!lines) continue;

    allFindings.push(
      ...checkSecrets(lines, filePath),
      ...checkAnyType(lines, filePath),
      ...checkOrAssignment(lines, filePath),
      ...checkFileLength(lines, filePath),
      ...checkConsoleLog(lines, filePath),
      ...checkHardcodedUrl(lines, filePath),
      ...checkFloatingPromise(lines, filePath),
      ...checkFunctionParams(lines, filePath),
    );
  }

  const criticalCount = allFindings.filter((f) => f.severity === "CRITICAL").length;
  const warningCount = allFindings.filter((f) => f.severity === "WARNING").length;
  const passed = criticalCount === 0;

  logger.info(
    { passed, criticalCount, warningCount, totalFindings: allFindings.length, filesReviewed: changedFiles.length },
    "Heuristic code review completed",
  );

  return { passed, findings: allFindings, criticalCount, warningCount };
}

export function formatReviewForCorrection(review: ReviewResult): string {
  const criticalFindings = review.findings.filter((f) => f.severity === "CRITICAL");
  if (criticalFindings.length === 0) return "";

  const lines = [
    "CRITICAL CODE REVIEW FINDINGS — you MUST fix these before the task can be completed:",
    "",
  ];

  for (const finding of criticalFindings) {
    const location = finding.line ? `${finding.file}:${String(finding.line)}` : finding.file;
    lines.push(`- [${finding.rule}] ${location}: ${finding.message}`);
  }

  return lines.join("\n");
}
