import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../config/logger.js";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = process.cwd();
const GIT_TIMEOUT_MS = 15_000;
const GIT_BINARY = "git";

const ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "checkout",
  "add",
  "commit",
  "diff",
  "log",
  "branch",
  "rev-parse",
]);

const FORBIDDEN_ARGS: ReadonlySet<string> = new Set([
  "--force",
  "--hard",
  "--amend",
  "push",
  "remote",
  "tag",
  "rebase",
  "pull",
  "fetch",
  "clone",
]);

const BRANCH_NAME_REGEX = /^forge\/task-[a-f0-9]{8}$/;

export interface BranchCommit {
  readonly hash: string;
  readonly message: string;
}

function validateGitArgs(subcommand: string, args: readonly string[]): void {
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`Git subcommand not allowed: ${subcommand}`);
  }

  for (const arg of args) {
    const lowerArg = arg.toLowerCase();
    if (FORBIDDEN_ARGS.has(lowerArg)) {
      throw new Error(`Git argument forbidden: ${arg}`);
    }
  }
}

function validateBranchName(branchName: string): void {
  if (!BRANCH_NAME_REGEX.test(branchName)) {
    throw new Error(
      `Invalid branch name: "${branchName}". Must match pattern forge/task-<8 hex chars>`,
    );
  }
}

async function execGit(subcommand: string, args: readonly string[]): Promise<string> {
  validateGitArgs(subcommand, args);

  const fullArgs = [subcommand, ...args];

  logger.debug({ subcommand, args }, "Executing git command");

  const { stdout, stderr } = await execFileAsync(GIT_BINARY, fullArgs, {
    cwd: PROJECT_ROOT,
    timeout: GIT_TIMEOUT_MS,
  });

  if (stderr && !stderr.includes("Switched to") && !stderr.includes("Already on")) {
    logger.debug({ stderr: stderr.trim() }, "Git stderr output");
  }

  return stdout.trim();
}

export function buildBranchName(taskId: string): string {
  const shortId = taskId.slice(0, 8).toLowerCase();
  return `forge/task-${shortId}`;
}

export async function getCurrentBranch(): Promise<string> {
  return execGit("rev-parse", ["--abbrev-ref", "HEAD"]);
}

export async function branchExists(branchName: string): Promise<boolean> {
  validateBranchName(branchName);
  try {
    const result = await execGit("branch", ["--list", branchName]);
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export async function switchToMain(): Promise<void> {
  const current = await getCurrentBranch();
  if (current === "main") return;

  await execGit("checkout", ["main"]);
  logger.info("Switched to main branch");
}

export async function createBranch(branchName: string): Promise<void> {
  validateBranchName(branchName);

  const exists = await branchExists(branchName);
  if (exists) {
    await execGit("checkout", [branchName]);
    logger.info({ branchName }, "Switched to existing forge branch");
    return;
  }

  await switchToMain();
  await execGit("checkout", ["-b", branchName]);
  logger.info({ branchName }, "Created and switched to new forge branch");
}

export async function switchBranch(branchName: string): Promise<void> {
  validateBranchName(branchName);
  await execGit("checkout", [branchName]);
  logger.info({ branchName }, "Switched to branch");
}

export async function stageFiles(filePaths: readonly string[]): Promise<void> {
  if (filePaths.length === 0) return;
  await execGit("add", [...filePaths]);
  logger.info({ fileCount: filePaths.length }, "Files staged for commit");
}

export async function commitChanges(message: string): Promise<string> {
  const sanitizedMessage = message.slice(0, 200).replaceAll('"', "'");
  const output = await execGit("commit", ["-m", sanitizedMessage]);

  const hashMatch = /\[[\w/]+ ([a-f0-9]+)\]/.exec(output);
  const hash = hashMatch?.[1] ?? "unknown";

  logger.info({ hash, message: sanitizedMessage }, "Changes committed");
  return hash;
}

export async function getBranchDiff(branchName: string): Promise<string> {
  validateBranchName(branchName);
  try {
    return await execGit("diff", [`main...${branchName}`]);
  } catch {
    return "";
  }
}

export async function getBranchCommits(branchName: string): Promise<readonly BranchCommit[]> {
  validateBranchName(branchName);
  try {
    const output = await execGit("log", [`main..${branchName}`, "--oneline"]);
    if (!output) return [];

    return output.split("\n").map((line) => {
      const spaceIndex = line.indexOf(" ");
      return {
        hash: line.slice(0, spaceIndex),
        message: line.slice(spaceIndex + 1),
      };
    });
  } catch {
    return [];
  }
}

export async function deleteBranch(branchName: string): Promise<void> {
  validateBranchName(branchName);

  const current = await getCurrentBranch();
  if (current === branchName) {
    await switchToMain();
  }

  try {
    await execGit("branch", ["-D", branchName]);
    logger.info({ branchName }, "Branch deleted");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ branchName, error: message }, "Failed to delete branch (may not exist)");
  }
}

export async function listForgeBranches(): Promise<readonly string[]> {
  try {
    const output = await execGit("branch", ["--list", "forge/*"]);
    if (!output) return [];

    return output
      .split("\n")
      .map((line) => line.trim().replace("* ", ""))
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
