import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../config/logger.js";
import type { StructuredError } from "./forgeErrorParser.js";

export interface AutoFixResult {
  readonly fixedCount: number;
  readonly remainingErrors: readonly StructuredError[];
  readonly fixedFiles: readonly string[];
}

export async function applyAutoFixes(
  errors: readonly StructuredError[],
  workspacePath: string,
): Promise<AutoFixResult> {
  const fixableByFile = groupFixableErrors(errors);
  const fixedFiles: string[] = [];
  let fixedCount = 0;

  for (const [filePath, fileErrors] of fixableByFile) {
    const fullPath = path.join(workspacePath, filePath);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const result = applyFixesToContent(content, fileErrors);

      if (result.fixedCount > 0) {
        await fs.writeFile(fullPath, result.content, "utf-8");
        fixedFiles.push(filePath);
        fixedCount += result.fixedCount;
        logger.info(
          { path: filePath, fixed: result.fixedCount },
          "Auto-fix applied without LLM",
        );
      }
    } catch {
      logger.debug({ path: filePath }, "Could not apply auto-fixes to file");
    }
  }

  const fixedCodes = collectFixedCodes(fixableByFile);
  const remaining = errors.filter((e) => !isAutoFixed(e, fixedCodes, fixedFiles));

  return { fixedCount, remainingErrors: remaining, fixedFiles };
}

function groupFixableErrors(
  errors: readonly StructuredError[],
): Map<string, readonly StructuredError[]> {
  const byFile = new Map<string, StructuredError[]>();

  for (const err of errors) {
    if (!isFixableError(err)) continue;

    const existing = byFile.get(err.file) ?? [];
    existing.push(err);
    byFile.set(err.file, existing);
  }

  return byFile;
}

function isFixableError(err: StructuredError): boolean {
  if (err.code === "no-unused-vars" || err.code === "@typescript-eslint/no-unused-vars") return true;
  if (err.code === "TS6133") return true;
  if (err.code === "TS1484") return true;
  if (err.code === "semi" || err.code === "@typescript-eslint/semi") return true;
  return false;
}

interface ContentFixResult {
  readonly content: string;
  readonly fixedCount: number;
}

function applyFixesToContent(
  content: string,
  errors: readonly StructuredError[],
): ContentFixResult {
  let result = content;
  let fixedCount = 0;

  const unusedVars = errors.filter(
    (e) => e.code === "no-unused-vars"
      || e.code === "@typescript-eslint/no-unused-vars"
      || e.code === "TS6133",
  );
  if (unusedVars.length > 0) {
    const fix = fixUnusedImportsAndVars(result, unusedVars);
    result = fix.content;
    fixedCount += fix.fixedCount;
  }

  const importTypeErrors = errors.filter((e) => e.code === "TS1484");
  if (importTypeErrors.length > 0) {
    const fix = fixMissingImportType(result, importTypeErrors);
    result = fix.content;
    fixedCount += fix.fixedCount;
  }

  const semiErrors = errors.filter(
    (e) => e.code === "semi" || e.code === "@typescript-eslint/semi",
  );
  if (semiErrors.length > 0) {
    const fix = fixMissingSemicolons(result, semiErrors);
    result = fix.content;
    fixedCount += fix.fixedCount;
  }

  return { content: result, fixedCount };
}

function fixUnusedImportsAndVars(
  content: string,
  errors: readonly StructuredError[],
): ContentFixResult {
  const unusedNames = extractUnusedNames(errors);
  if (unusedNames.size === 0) return { content, fixedCount: 0 };

  const lines = content.split("\n");
  const result: string[] = [];
  let fixedCount = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trimStart().startsWith("import")) {
      const prefixed = tryPrefixUnusedVar(line, unusedNames, errors, i + 1);
      if (prefixed === null) {
        result.push(line);
      } else {
        result.push(prefixed);
        fixedCount++;
      }
      i++;
      continue;
    }

    let importBlock = line;
    let endIdx = i;
    while (!importBlock.includes("from") && endIdx < lines.length - 1) {
      endIdx++;
      importBlock += "\n" + lines[endIdx];
    }

    const cleaned = cleanImportStatement(importBlock, unusedNames);
    if (cleaned === importBlock) {
      result.push(importBlock);
    } else if (cleaned === null) {
      fixedCount++;
    } else {
      result.push(cleaned);
      fixedCount++;
    }

    i = endIdx + 1;
  }

  return { content: result.join("\n"), fixedCount };
}

function extractUnusedNames(errors: readonly StructuredError[]): Set<string> {
  const names = new Set<string>();
  const nameRegex = /'(\w+)' is (?:defined|declared|assigned)/;

  for (const err of errors) {
    const match = nameRegex.exec(err.message);
    if (match) names.add(match[1]);
  }

  return names;
}

function tryPrefixUnusedVar(
  line: string,
  unusedNames: ReadonlySet<string>,
  errors: readonly StructuredError[],
  lineNum: number,
): string | null {
  const varErrors = errors.filter(
    (e) => e.line === lineNum && (e.code === "TS6133" || e.code === "@typescript-eslint/no-unused-vars"),
  );
  if (varErrors.length === 0) return null;

  for (const err of varErrors) {
    const match = /'(\w+)'/.exec(err.message);
    if (!match) continue;
    const varName = match[1];

    if (!unusedNames.has(varName)) continue;
    if (line.trimStart().startsWith("import")) continue;

    const wordBoundary = String.raw`\b`;
    const declRegex = new RegExp(`${wordBoundary}(const|let|var)\\s+${varName}${wordBoundary}`);
    if (declRegex.test(line) && !varName.startsWith("_")) {
      return line.replace(new RegExp(`${wordBoundary}${varName}${wordBoundary}`), `_${varName}`);
    }
  }

  return null;
}

function cleanImportStatement(importBlock: string, unusedSet: ReadonlySet<string>): string | null {
  const namedMatch = /\{([^}]+)\}/.exec(importBlock);
  if (!namedMatch) return importBlock;

  const specifiers = namedMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const remaining = specifiers.filter((spec) => {
    const name = spec.includes(" as ") ? spec.split(" as ")[1].trim() : spec.replace("type ", "").trim();
    return !unusedSet.has(name);
  });

  if (remaining.length === specifiers.length) return importBlock;

  if (remaining.length === 0) {
    const hasDefault = /^import\s+\w+\s*,/.test(importBlock.trim());
    if (hasDefault) {
      return importBlock.replace(/,\s*\{[^}]*\}/, "");
    }
    return null;
  }

  const newSpecifiers = remaining.length <= 2
    ? `{ ${remaining.join(", ")} }`
    : `{\n  ${remaining.join(",\n  ")}\n}`;

  return importBlock.replace(/\{[^}]*\}/, newSpecifiers);
}

function fixMissingImportType(
  content: string,
  errors: readonly StructuredError[],
): ContentFixResult {
  const lines = content.split("\n");
  let fixedCount = 0;
  const errorLineSet = new Set(
    errors.filter((e) => e.code === "TS1484").map((e) => e.line),
  );

  for (let i = 0; i < lines.length; i++) {
    if (!errorLineSet.has(i + 1)) continue;
    const converted = tryConvertToImportType(lines[i]);
    if (converted === null) continue;
    lines[i] = converted;
    fixedCount++;
  }

  return { content: lines.join("\n"), fixedCount };
}

function tryConvertToImportType(line: string): string | null {
  if (!(/^import\s+\{/.test(line.trimStart()))) return null;
  if (line.includes("import type")) return null;

  const importNames = /\{([^}]+)\}/.exec(line);
  if (importNames) {
    const allTypeOnly = importNames[1].split(",").every((s) => s.trim().startsWith("type "));
    if (allTypeOnly) return null;
  }

  return line.replace(/^(\s*)import\s+\{/, "$1import type {");
}

function fixMissingSemicolons(
  content: string,
  errors: readonly StructuredError[],
): ContentFixResult {
  const lines = content.split("\n");
  let fixedCount = 0;
  const errorLines = new Set(errors.map((e) => e.line));

  for (const lineNum of errorLines) {
    const idx = lineNum - 1;
    if (idx >= 0 && idx < lines.length) {
      const line = lines[idx];
      if (!line.trimEnd().endsWith(";") && !line.trimEnd().endsWith("{") && !line.trimEnd().endsWith("}")) {
        lines[idx] = line.trimEnd() + ";";
        fixedCount++;
      }
    }
  }

  return { content: lines.join("\n"), fixedCount };
}

function collectFixedCodes(fixableByFile: Map<string, readonly StructuredError[]>): Set<string> {
  const codes = new Set<string>();
  for (const errors of fixableByFile.values()) {
    for (const err of errors) codes.add(err.code);
  }
  return codes;
}

function isAutoFixed(
  err: StructuredError,
  fixedCodes: ReadonlySet<string>,
  fixedFiles: readonly string[],
): boolean {
  return fixedCodes.has(err.code) && fixedFiles.some((f) => err.file.endsWith(f));
}
