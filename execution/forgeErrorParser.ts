export interface StructuredError {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly source: "tsc" | "eslint" | "build";
}

const TSC_ERROR_REGEX = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

export function parseTscErrors(raw: string): readonly StructuredError[] {
  const errors: StructuredError[] = [];

  for (const line of raw.split("\n")) {
    const match = TSC_ERROR_REGEX.exec(line.trim());
    if (!match) continue;

    errors.push({
      file: match[1].trim(),
      line: Number(match[2]),
      column: Number(match[3]),
      severity: match[4] === "warning" ? "warning" : "error",
      code: match[5],
      message: match[6].trim(),
      source: "tsc",
    });
  }

  return errors;
}

const ESLINT_FILE_REGEX = /^\/.*\.\w+$|^[a-zA-Z].*\.\w+$/;
const ESLINT_ERROR_REGEX = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/;

export function parseEslintErrors(raw: string): readonly StructuredError[] {
  const errors: StructuredError[] = [];
  let currentFile = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    if (ESLINT_FILE_REGEX.test(trimmed) && !trimmed.includes(" ")) {
      currentFile = trimmed;
      continue;
    }

    const match = ESLINT_ERROR_REGEX.exec(line);
    if (match && currentFile) {
      errors.push({
        file: currentFile,
        line: Number(match[1]),
        column: Number(match[2]),
        severity: match[3] === "warning" ? "warning" : "error",
        message: match[4].trim(),
        code: match[5],
        source: "eslint",
      });
    }
  }

  return errors;
}

export function parseAllErrors(
  tscOutput: string,
  eslintOutput: string,
): readonly StructuredError[] {
  const tscErrors = parseTscErrors(tscOutput);
  const eslintErrors = parseEslintErrors(eslintOutput);
  return [...tscErrors, ...eslintErrors];
}

export function separateErrorsAndWarnings(
  errors: readonly StructuredError[],
): { readonly errors: readonly StructuredError[]; readonly warnings: readonly StructuredError[] } {
  const errs: StructuredError[] = [];
  const warns: StructuredError[] = [];

  for (const e of errors) {
    if (e.severity === "warning") {
      warns.push(e);
    } else {
      errs.push(e);
    }
  }

  return { errors: errs, warnings: warns };
}

export function formatErrorsForPrompt(
  errors: readonly StructuredError[],
  touchedFiles: readonly string[],
  maxChars: number,
): string {
  const touchedSet = new Set(touchedFiles);

  const prioritized = [...errors].sort((a, b) => {
    const aRelevant = isRelevantFile(a.file, touchedSet) ? 0 : 1;
    const bRelevant = isRelevantFile(b.file, touchedSet) ? 0 : 1;
    if (aRelevant !== bRelevant) return aRelevant - bRelevant;

    const aSeverity = a.severity === "error" ? 0 : 1;
    const bSeverity = b.severity === "error" ? 0 : 1;
    return aSeverity - bSeverity;
  });

  const lines: string[] = [];
  let totalChars = 0;

  for (const err of prioritized) {
    const formatted = formatSingleError(err);
    if (totalChars + formatted.length > maxChars) break;
    lines.push(formatted);
    totalChars += formatted.length + 1;
  }

  return lines.join("\n");
}

function isRelevantFile(errorFile: string, touchedSet: ReadonlySet<string>): boolean {
  for (const touched of touchedSet) {
    if (errorFile.endsWith(touched) || touched.endsWith(errorFile)) return true;
  }
  return false;
}

function formatSingleError(err: StructuredError): string {
  const sourceTag = `[${err.source.toUpperCase()}]`;
  const severity = err.severity === "error" ? "ERROR" : "WARN";
  return `${sourceTag} ${severity} ${err.file}:${err.line}:${err.column} - ${err.code}: ${err.message}`;
}

export function extractTypeNamesFromErrors(
  errors: readonly StructuredError[],
): readonly string[] {
  const TYPE_MISMATCH_CODES = new Set(["TS2345", "TS2322", "TS2741", "TS2559", "TS2304"]);
  const typeNames = new Set<string>();
  const typeRegex = /type '([A-Z]\w+)'/gi;

  for (const err of errors) {
    if (!TYPE_MISMATCH_CODES.has(err.code)) continue;

    for (const match of err.message.matchAll(typeRegex)) {
      const name = match[1];
      if (name.length >= 3 && !isPrimitiveType(name)) {
        typeNames.add(name);
      }
    }
  }

  return [...typeNames];
}

function isPrimitiveType(name: string): boolean {
  const primitives = new Set([
    "String", "Number", "Boolean", "Null", "Undefined",
    "Object", "Array", "Function", "Promise", "Record",
    "Partial", "Required", "Readonly", "Pick", "Omit",
  ]);
  return primitives.has(name);
}
