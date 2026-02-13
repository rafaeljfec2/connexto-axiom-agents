import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../config/logger.js";
import type { ToolCall } from "../shared/openclawResponsesClient.js";

const execFileAsync = promisify(execFile);

export interface ToolExecutorConfig {
  readonly workspacePath: string;
  readonly allowedDirs: readonly string[];
  readonly maxFileSize: number;
  readonly commandTimeout: number;
  readonly blockedCommands: ReadonlySet<string>;
  readonly maxSearchResults: number;
}

interface ToolArguments {
  readonly [key: string]: unknown;
}

function extractStringArg(args: ToolArguments, key: string, fallback: string = ""): string {
  const value = args[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined || value === null) return fallback;
  return fallback;
}

const DEFAULT_BLOCKED_COMMANDS: ReadonlySet<string> = new Set([
  "rm -rf /",
  "rm -rf *",
  "rm -rf .",
  "rm -rf ~",
  "rm -rf ~/",
  "mkfs",
  "dd if=/dev/zero",
  "git push",
  "git push --force",
  "git push -f",
  "npm publish",
  "npx npm publish",
  "pnpm publish",
  "yarn publish",
  "docker push",
  "kubectl apply",
  "kubectl delete",
  "shutdown",
  "reboot",
  "halt",
  "init 0",
  "chmod -R 777",
  "chown -R",
]);

const BLOCKED_COMMAND_PATTERNS: readonly RegExp[] = [
  /^rm\s+-[^i]*r[^i]*f/,
  /curl\s+.*\|\s*(bash|sh)/,
  /wget\s+.*\|\s*(bash|sh)/,
  /\|\s*bash\b/,
  /\|\s*sh\b/,
  /git\s+push/,
  /npm\s+publish/,
  /pnpm\s+publish/,
  /yarn\s+publish/,
  /docker\s+push/,
  /kubectl\s+(apply|delete)/,
  />\s*\/dev\/sd/,
  /dd\s+if=/,
];

const MAX_READ_FILE_SIZE = 512_000;
const MAX_WRITE_FILE_SIZE = 256_000;
const DEFAULT_LIST_DEPTH = 2;
const MAX_LIST_DEPTH = 5;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_OUTPUT_CHARS = 50_000;

export function createDefaultConfig(workspacePath: string): ToolExecutorConfig {
  return {
    workspacePath,
    allowedDirs: ["."],
    maxFileSize: MAX_WRITE_FILE_SIZE,
    commandTimeout: 30_000,
    blockedCommands: DEFAULT_BLOCKED_COMMANDS,
    maxSearchResults: 100,
  };
}

export async function executeTool(
  config: ToolExecutorConfig,
  toolCall: ToolCall,
): Promise<string> {
  let args: ToolArguments;
  try {
    args = JSON.parse(toolCall.arguments) as ToolArguments;
  } catch {
    return formatError(`Invalid JSON arguments: ${toolCall.arguments.slice(0, 200)}`);
  }

  logger.debug(
    { tool: toolCall.name, args: truncateArgs(args) },
    "Executing tool call",
  );

  switch (toolCall.name) {
    case "read_file":
      return handleReadFile(config, args);
    case "write_file":
      return handleWriteFile(config, args);
    case "edit_file":
      return handleEditFile(config, args);
    case "run_command":
      return handleRunCommand(config, args);
    case "list_directory":
      return handleListDirectory(config, args);
    case "search_code":
      return handleSearchCode(config, args);
    default:
      return formatError(`Unknown tool: ${toolCall.name}`);
  }
}

function resolveSafePath(config: ToolExecutorConfig, relativePath: string): string | null {
  const normalized = path.normalize(relativePath);

  if (path.isAbsolute(normalized)) return null;
  if (normalized.includes("..")) return null;

  const resolved = path.resolve(config.workspacePath, normalized);
  const relative = path.relative(config.workspacePath, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  const forbidden = [".git/", "node_modules/", ".env"];
  for (const prefix of forbidden) {
    if (relative.startsWith(prefix) || relative === prefix.replace("/", "")) return null;
  }

  return resolved;
}

async function handleReadFile(config: ToolExecutorConfig, args: ToolArguments): Promise<string> {
  const filePath = extractStringArg(args, "path");
  if (!filePath) return formatError("Missing required parameter: path");

  const resolved = resolveSafePath(config, filePath);
  if (!resolved) return formatError(`Path not allowed: ${filePath}`);

  try {
    const stat = await fs.stat(resolved);
    if (stat.size > MAX_READ_FILE_SIZE) {
      return formatError(`File too large: ${String(stat.size)} bytes (max ${String(MAX_READ_FILE_SIZE)})`);
    }

    const content = await fs.readFile(resolved, "utf-8");

    const lines = content.split("\n");
    const numbered = lines.map((line, i) => `${String(i + 1).padStart(4)}| ${line}`).join("\n");

    return numbered;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return formatError(`Failed to read file: ${msg}`);
  }
}

async function handleWriteFile(config: ToolExecutorConfig, args: ToolArguments): Promise<string> {
  const filePath = extractStringArg(args, "path");
  const content = extractStringArg(args, "content");

  if (!filePath) return formatError("Missing required parameter: path");

  const resolved = resolveSafePath(config, filePath);
  if (!resolved) return formatError(`Path not allowed: ${filePath}`);

  if (content.length > config.maxFileSize) {
    return formatError(`Content too large: ${String(content.length)} chars (max ${String(config.maxFileSize)})`);
  }

  try {
    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");

    logger.info({ path: filePath, size: content.length }, "Tool: write_file completed");
    return `File written successfully: ${filePath} (${String(content.length)} chars)`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return formatError(`Failed to write file: ${msg}`);
  }
}

async function handleEditFile(config: ToolExecutorConfig, args: ToolArguments): Promise<string> {
  const filePath = extractStringArg(args, "path");
  const search = extractStringArg(args, "search");
  const replace = extractStringArg(args, "replace");

  if (!filePath) return formatError("Missing required parameter: path");
  if (!search) return formatError("Missing required parameter: search");

  const resolved = resolveSafePath(config, filePath);
  if (!resolved) return formatError(`Path not allowed: ${filePath}`);

  try {
    const content = await fs.readFile(resolved, "utf-8");

    if (!content.includes(search)) {
      const preview = search.length > 100 ? `${search.slice(0, 100)}...` : search;
      return formatError(
        `Search string not found in ${filePath}. ` +
        `Make sure it matches exactly (including whitespace). ` +
        `Search preview: "${preview}"`,
      );
    }

    const occurrences = content.split(search).length - 1;
    const updated = content.replace(search, replace);

    await fs.writeFile(resolved, updated, "utf-8");

    logger.info(
      { path: filePath, occurrences, searchLen: search.length, replaceLen: replace.length },
      "Tool: edit_file completed",
    );

    return `Edit applied to ${filePath}: replaced ${String(occurrences)} occurrence(s)`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return formatError(`Failed to edit file: ${msg}`);
  }
}

function isCommandBlocked(command: string, blockedCommands: ReadonlySet<string>): boolean {
  const trimmed = command.trim().toLowerCase();

  for (const blocked of blockedCommands) {
    if (trimmed.startsWith(blocked.toLowerCase())) return true;
  }

  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

async function handleRunCommand(config: ToolExecutorConfig, args: ToolArguments): Promise<string> {
  const command = extractStringArg(args, "command");
  if (!command) return formatError("Missing required parameter: command");

  if (isCommandBlocked(command, config.blockedCommands)) {
    return formatError(`Command blocked for security: ${command}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      ["-c", command],
      { cwd: config.workspacePath, timeout: config.commandTimeout },
    );

    const output = `${stdout}${stderr}`.trim();
    const truncated = output.length > MAX_SEARCH_OUTPUT_CHARS
      ? `${output.slice(0, MAX_SEARCH_OUTPUT_CHARS)}\n... (output truncated)`
      : output;

    logger.info(
      { command: command.slice(0, 80), outputLen: output.length, exitCode: 0 },
      "Tool: run_command completed",
    );

    return truncated.length > 0 ? truncated : "(no output)";
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    const output = `${execError.stdout ?? ""}${execError.stderr ?? ""}`.trim();

    if (output.length > 0) {
      const truncated = output.length > MAX_SEARCH_OUTPUT_CHARS
        ? `${output.slice(0, MAX_SEARCH_OUTPUT_CHARS)}\n... (output truncated)`
        : output;
      return `Command exited with error:\n${truncated}`;
    }

    return formatError(`Command failed: ${execError.message ?? "unknown error"}`);
  }
}

async function handleListDirectory(config: ToolExecutorConfig, args: ToolArguments): Promise<string> {
  const dirPath = extractStringArg(args, "path", ".");
  const rawDepth = args["depth"];
  const depth = Math.min(typeof rawDepth === "number" ? rawDepth : DEFAULT_LIST_DEPTH, MAX_LIST_DEPTH);

  const resolved = resolveSafePath(config, dirPath);
  if (!resolved) return formatError(`Path not allowed: ${dirPath}`);

  try {
    const entries: string[] = [];
    await listRecursive(resolved, config.workspacePath, depth, 0, entries);

    if (entries.length === 0) return "(empty directory)";

    return entries.join("\n");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return formatError(`Failed to list directory: ${msg}`);
  }
}

async function listRecursive(
  dirPath: string,
  workspacePath: string,
  maxDepth: number,
  currentDepth: number,
  entries: string[],
): Promise<void> {
  if (currentDepth > maxDepth || entries.length >= MAX_LIST_ENTRIES) return;

  const items = await fs.readdir(dirPath, { withFileTypes: true });
  const indent = "  ".repeat(currentDepth);

  const skipDirs = new Set(["node_modules", ".git", ".next", "dist", "build", ".turbo", ".cache"]);

  for (const item of items) {
    if (entries.length >= MAX_LIST_ENTRIES) {
      entries.push(`${indent}... (truncated at ${String(MAX_LIST_ENTRIES)} entries)`);
      return;
    }

    if (item.isDirectory()) {
      if (skipDirs.has(item.name)) continue;

      const relativePath = path.relative(workspacePath, path.join(dirPath, item.name));
      entries.push(`${indent}${relativePath}/`);

      if (currentDepth < maxDepth) {
        await listRecursive(
          path.join(dirPath, item.name),
          workspacePath,
          maxDepth,
          currentDepth + 1,
          entries,
        );
      }
    } else {
      const relativePath = path.relative(workspacePath, path.join(dirPath, item.name));
      entries.push(`${indent}${relativePath}`);
    }
  }
}

async function handleSearchCode(config: ToolExecutorConfig, args: ToolArguments): Promise<string> {
  const pattern = extractStringArg(args, "pattern");
  const rawGlob = args["glob"];
  const glob = typeof rawGlob === "string" && rawGlob.length > 0 ? rawGlob : undefined;

  if (!pattern) return formatError("Missing required parameter: pattern");

  const rgArgs = [
    "--line-number",
    "--no-heading",
    "--color", "never",
    "--max-count", String(config.maxSearchResults),
    "--max-columns", "200",
  ];

  if (glob) {
    rgArgs.push("--glob", glob);
  }

  rgArgs.push(
    "--glob", "!node_modules/**",
    "--glob", "!.git/**",
    "--glob", "!dist/**",
    "--glob", "!build/**",
    "--glob", "!.next/**",
    pattern,
  );

  try {
    const { stdout } = await execFileAsync(
      "rg",
      rgArgs,
      { cwd: config.workspacePath, timeout: config.commandTimeout },
    );

    const trimmed = stdout.trim();
    if (!trimmed) return "No matches found";

    const truncated = trimmed.length > MAX_SEARCH_OUTPUT_CHARS
      ? `${trimmed.slice(0, MAX_SEARCH_OUTPUT_CHARS)}\n... (output truncated)`
      : trimmed;

    return truncated;
  } catch (error) {
    const execError = error as { code?: number; stdout?: string; stderr?: string; message?: string };

    if (execError.code === 1) return "No matches found";

    const errOutput = execError.stderr ?? execError.message ?? "unknown error";
    return formatError(`Search failed: ${errOutput}`);
  }
}

function formatError(message: string): string {
  return `ERROR: ${message}`;
}

function truncateArgs(args: ToolArguments): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    const str = String(value);
    result[key] = str.length > 100 ? `${str.slice(0, 100)}...` : str;
  }
  return result;
}

export { isCommandBlocked, resolveSafePath };
