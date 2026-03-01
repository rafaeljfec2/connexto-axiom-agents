import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../config/logger.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 60_000;
const GIT_BINARY = "git";

const ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "checkout",
  "add",
  "commit",
  "diff",
  "log",
  "branch",
  "rev-parse",
  "clone",
  "pull",
  "status",
  "switch",
]);

const FORBIDDEN_ARGS: ReadonlySet<string> = new Set([
  "--force",
  "--hard",
  "--amend",
  "push",
  "remote",
  "tag",
  "rebase",
  "fetch",
]);

const TASK_BRANCH_REGEX = /^forge\/task-[a-f0-9]{8}$/;
const AUTO_BRANCH_REGEX = /^forge\/auto-\d{8}-\d{6}$/;

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

function isValidBranchName(branchName: string): boolean {
  return TASK_BRANCH_REGEX.test(branchName) || AUTO_BRANCH_REGEX.test(branchName);
}

function validateBranchName(branchName: string): void {
  if (!isValidBranchName(branchName)) {
    throw new Error(
      `Invalid branch name: "${branchName}". Must match forge/task-<8hex> or forge/auto-<YYYYMMDD>-<HHmmss>`,
    );
  }
}

async function execGit(subcommand: string, args: readonly string[], cwd: string): Promise<string> {
  validateGitArgs(subcommand, args);

  const fullArgs = [subcommand, ...args];

  logger.debug({ subcommand, args, cwd }, "Executing project git command");

  try {
    const { stdout, stderr } = await execFileAsync(GIT_BINARY, fullArgs, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      env: {
        ...process.env,
        HUSKY: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    });

    if (
      stderr &&
      !stderr.includes("Switched to") &&
      !stderr.includes("Already on") &&
      !stderr.includes("Cloning into")
    ) {
      logger.debug({ stderr: stderr.trim() }, "Project git stderr output");
    }

    return stdout.trim();
  } catch (error: unknown) {
    const execError = error as { stderr?: string; stdout?: string; message?: string };
    logger.error(
      {
        subcommand,
        args,
        cwd,
        stderr: execError.stderr?.trim(),
        stdout: execError.stdout?.trim(),
      },
      "Project git command failed",
    );
    throw error;
  }
}

export function buildBranchName(taskId: string): string {
  const shortId = taskId.slice(0, 8).toLowerCase();
  return `forge/task-${shortId}`;
}

export function buildAutoBranchName(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const datePart = `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `forge/auto-${datePart}-${timePart}`;
}

export async function cloneLocal(source: string, target: string): Promise<void> {
  await execGit("clone", ["--local", source, target], source);
  logger.info({ source, target }, "Local clone created");
}

export async function cloneRepo(repoSource: string, target: string): Promise<void> {
  const fullArgs = ["clone", repoSource, target];

  logger.info({ repoSource, target }, "Cloning repository");

  await execFileAsync(GIT_BINARY, fullArgs, {
    timeout: GIT_TIMEOUT_MS * 5,
  });

  logger.info({ repoSource, target }, "Repository cloned");
}

export async function pullLatest(cwd: string): Promise<void> {
  await execGit("pull", [], cwd);
  logger.info({ cwd }, "Pulled latest changes");
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  return execGit("rev-parse", ["--abbrev-ref", "HEAD"], cwd);
}

export async function switchToBaseBranch(cwd: string, baseBranch = "main"): Promise<void> {
  const current = await getCurrentBranch(cwd);
  if (current === baseBranch) return;

  await execGit("checkout", [baseBranch], cwd);
  logger.info({ cwd, baseBranch }, "Switched to base branch");
}

export async function createBranch(branchName: string, cwd: string, baseBranch = "main"): Promise<void> {
  validateBranchName(branchName);

  const exists = await branchExists(branchName, cwd);
  if (exists) {
    await execGit("checkout", [branchName], cwd);
    logger.info({ branchName, cwd }, "Switched to existing forge branch");
    return;
  }

  await switchToBaseBranch(cwd, baseBranch);
  await execGit("checkout", ["-b", branchName], cwd);
  logger.info({ branchName, cwd }, "Created and switched to new forge branch");
}

export async function branchExists(branchName: string, cwd: string): Promise<boolean> {
  validateBranchName(branchName);
  try {
    const result = await execGit("branch", ["--list", branchName], cwd);
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export async function stageFiles(filePaths: readonly string[], cwd: string): Promise<void> {
  if (filePaths.length === 0) return;
  await execGit("add", [...filePaths], cwd);
  logger.info({ fileCount: filePaths.length, cwd }, "Files staged for commit");
}

export async function commitChanges(message: string, cwd: string): Promise<string> {
  const sanitizedMessage = message
    .slice(0, 200)
    .replaceAll(/[\r\n]+/g, " ")
    .replaceAll('"', "'")
    .trim();
  const output = await execGit("commit", ["-m", sanitizedMessage], cwd);

  const hashMatch = /\[[\w/\-.]+ ([a-f0-9]+)\]/.exec(output);
  const hash = hashMatch?.[1] ?? "unknown";

  logger.info({ hash, message: sanitizedMessage, cwd }, "Changes committed");
  return hash;
}

export async function getBranchDiff(branchName: string, cwd: string, baseBranch = "main"): Promise<string> {
  validateBranchName(branchName);
  try {
    return await execGit("diff", [`${baseBranch}...${branchName}`], cwd);
  } catch {
    return "";
  }
}

export async function getBranchCommits(
  branchName: string,
  cwd: string,
  baseBranch = "main",
): Promise<readonly BranchCommit[]> {
  validateBranchName(branchName);
  try {
    const output = await execGit("log", [`${baseBranch}..${branchName}`, "--oneline"], cwd);
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

export async function deleteBranch(branchName: string, cwd: string, baseBranch = "main"): Promise<void> {
  validateBranchName(branchName);

  const current = await getCurrentBranch(cwd);
  if (current === branchName) {
    await switchToBaseBranch(cwd, baseBranch);
  }

  try {
    await execGit("branch", ["-D", branchName], cwd);
    logger.info({ branchName, cwd }, "Branch deleted");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ branchName, cwd, error: message }, "Failed to delete branch (may not exist)");
  }
}

export async function pushBranchToSource(
  branchName: string,
  repoSource: string,
  cwd: string,
): Promise<void> {
  validateBranchName(branchName);

  logger.info({ branchName, repoSource, cwd }, "Pushing forge branch to source repo");

  try {
    const { stderr } = await execFileAsync(
      GIT_BINARY,
      ["push", repoSource, `${branchName}:${branchName}`],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS * 2,
        env: {
          ...process.env,
          HUSKY: "0",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );

    if (stderr && !stderr.includes("->")) {
      logger.debug({ stderr: stderr.trim() }, "Push stderr output");
    }

    logger.info({ branchName, repoSource }, "Branch pushed to source repo");
  } catch (error: unknown) {
    const execError = error as { stderr?: string; message?: string };
    logger.error(
      { branchName, repoSource, stderr: execError.stderr?.trim() },
      "Failed to push branch to source repo",
    );
    throw new Error(`Push failed: ${execError.message ?? "unknown"}`);
  }
}
