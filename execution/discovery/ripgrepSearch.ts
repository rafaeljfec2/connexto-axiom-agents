import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../config/logger.js";

const execFileAsync = promisify(execFile);

const RIPGREP_TIMEOUT_MS = 10_000;
const RIPGREP_MAX_RESULTS = 100;

const RIPGREP_IGNORE_GLOBS = [
  "-g", "!node_modules",
  "-g", "!.git",
  "-g", "!dist",
  "-g", "!build",
  "-g", "!.next",
  "-g", "!coverage",
] as const;

export interface RipgrepResult {
  readonly path: string;
  readonly matchCount: number;
  readonly matchLines: readonly string[];
}

interface RipgrepJsonMatch {
  readonly type: string;
  readonly data?: {
    readonly path?: { readonly text?: string };
    readonly lines?: { readonly text?: string };
  };
}

let ripgrepAvailable: boolean | null = null;

export async function isRipgrepAvailable(): Promise<boolean> {
  if (ripgrepAvailable !== null) return ripgrepAvailable;
  try {
    await execFileAsync("rg", ["--version"], { cwd: "/tmp", timeout: 3000 });
    ripgrepAvailable = true;
  } catch {
    ripgrepAvailable = false;
    logger.debug("ripgrep (rg) not available, falling back to manual grep");
  }
  return ripgrepAvailable;
}

export async function ripgrepSearch(
  workspacePath: string,
  pattern: string,
  options?: {
    readonly maxResults?: number;
    readonly glob?: string;
    readonly caseSensitive?: boolean;
  },
): Promise<readonly RipgrepResult[]> {
  const available = await isRipgrepAvailable();
  if (!available) return [];

  const maxResults = options?.maxResults ?? RIPGREP_MAX_RESULTS;
  const args = [
    "--json",
    "--max-count", "5",
    "--max-filesize", "50K",
    ...RIPGREP_IGNORE_GLOBS,
  ];

  if (!options?.caseSensitive) args.push("-i");
  if (options?.glob) args.push("-g", options.glob);
  args.push(pattern);

  try {
    const { stdout } = await execFileAsync("rg", args, {
      cwd: workspacePath,
      timeout: RIPGREP_TIMEOUT_MS,
    });
    return parseRipgrepOutput(stdout, maxResults);
  } catch (error) {
    const execError = error as { stdout?: string };
    if (execError.stdout) {
      return parseRipgrepOutput(execError.stdout, maxResults);
    }
    return [];
  }
}

function parseRipgrepOutput(stdout: string, maxResults: number): readonly RipgrepResult[] {
  const resultsByPath = new Map<string, { matchCount: number; matchLines: string[] }>();

  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as RipgrepJsonMatch;
      if (parsed.type === "match" && parsed.data?.path?.text) {
        const filePath = parsed.data.path.text;
        const existing = resultsByPath.get(filePath) ?? { matchCount: 0, matchLines: [] };
        existing.matchCount++;
        if (parsed.data.lines?.text && existing.matchLines.length < 3) {
          existing.matchLines.push(parsed.data.lines.text.trim());
        }
        resultsByPath.set(filePath, existing);
      }
    } catch {
      continue;
    }
  }

  const results: RipgrepResult[] = [];
  for (const [filePath, data] of resultsByPath) {
    if (results.length >= maxResults) break;
    results.push({ path: filePath, matchCount: data.matchCount, matchLines: data.matchLines });
  }

  return results;
}

export async function findSymbolDefinitions(
  workspacePath: string,
  symbolName: string,
): Promise<readonly RipgrepResult[]> {
  const wordBoundary = String.raw`\b`;
  const patterns = [
    String.raw`(function|const|let|var|class|interface|type|enum|export)\s+` + symbolName + wordBoundary,
    String.raw`export\s+\{[^}]*\b` + symbolName + wordBoundary,
  ];

  const allResults: RipgrepResult[] = [];
  const seenPaths = new Set<string>();

  for (const pattern of patterns) {
    const results = await ripgrepSearch(workspacePath, pattern, {
      glob: "*.{ts,tsx,js,jsx}",
      maxResults: 20,
    });
    for (const r of results) {
      if (seenPaths.has(r.path)) continue;
      seenPaths.add(r.path);
      allResults.push(r);
    }
  }

  return allResults;
}

export async function globSearch(
  workspacePath: string,
  patterns: readonly string[],
): Promise<readonly string[]> {
  const available = await isRipgrepAvailable();
  if (!available) return [];

  const results = new Set<string>();

  for (const pattern of patterns) {
    try {
      const { stdout } = await execFileAsync("rg", [
        "--files",
        "-g", pattern,
        ...RIPGREP_IGNORE_GLOBS.slice(0, 8),
      ], { cwd: workspacePath, timeout: RIPGREP_TIMEOUT_MS });

      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) results.add(trimmed);
      }
    } catch {
      continue;
    }
  }

  return [...results];
}
