import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../config/logger.js";

const execFileAsync = promisify(execFile);

const PUSH_TIMEOUT_MS = 30_000;
const API_TIMEOUT_MS = 15_000;
const GITHUB_API_BASE = "https://api.github.com";
const BRANCH_NAME_REGEX = /^forge\/task-[a-f0-9]{8}$/;

const FORBIDDEN_PUSH_ARGS: ReadonlySet<string> = new Set([
  "--force",
  "--force-with-lease",
  "--delete",
  "--mirror",
  "--all",
  "--tags",
]);

interface GitHubConfig {
  readonly token: string;
  readonly repo: string;
}

export interface CreatePRParams {
  readonly title: string;
  readonly body: string;
  readonly head: string;
  readonly base: string;
}

export interface PRResponse {
  readonly number: number;
  readonly html_url: string;
  readonly state: string;
  readonly title: string;
  readonly merged: boolean;
}

export interface PRDetails extends PRResponse {
  readonly mergeable: boolean | null;
  readonly mergeable_state: string;
  readonly head_sha: string;
  readonly base_ref: string;
  readonly changed_files: number;
  readonly additions: number;
  readonly deletions: number;
}

export interface CheckRunsStatus {
  readonly totalCount: number;
  readonly passed: number;
  readonly failed: number;
  readonly pending: number;
  readonly allPassed: boolean;
}

function loadConfig(): GitHubConfig {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token) {
    throw new Error("GITHUB_TOKEN is required for remote operations");
  }
  if (!repo) {
    throw new Error("GITHUB_REPO is required (format: owner/repo)");
  }

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error(`Invalid GITHUB_REPO format: "${repo}". Expected: owner/repo`);
  }

  return { token, repo };
}

function buildPushUrl(config: GitHubConfig): string {
  return `https://x-access-token:${config.token}@github.com/${config.repo}.git`;
}

function validateBranchForPush(branchName: string): void {
  if (!BRANCH_NAME_REGEX.test(branchName)) {
    throw new Error(
      `Push rejected: branch "${branchName}" does not match pattern forge/task-<8 hex chars>`,
    );
  }
}

export async function pushBranch(branchName: string): Promise<void> {
  validateBranchForPush(branchName);

  const config = loadConfig();
  const pushUrl = buildPushUrl(config);

  const args = ["push", pushUrl, branchName];

  for (const arg of args) {
    if (FORBIDDEN_PUSH_ARGS.has(arg.toLowerCase())) {
      throw new Error(`Forbidden push argument: ${arg}`);
    }
  }

  logger.info({ branchName }, "Pushing branch to remote");

  try {
    await execFileAsync("git", args, {
      cwd: process.cwd(),
      timeout: PUSH_TIMEOUT_MS,
    });
    logger.info({ branchName }, "Branch pushed to remote successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Push failed for branch ${branchName}: ${message}`);
  }
}

export async function createPullRequest(params: CreatePRParams): Promise<PRResponse> {
  validateBranchForPush(params.head);

  if (!params.base || params.base.trim().length === 0) {
    throw new Error("PR base branch must be specified");
  }

  const config = loadConfig();
  const url = `${GITHUB_API_BASE}/repos/${config.repo}/pulls`;

  logger.info({ head: params.head, base: params.base }, "Creating pull request");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as PRResponse;

  logger.info({ prNumber: data.number, url: data.html_url }, "Pull request created successfully");

  return data;
}

export async function closePullRequest(prNumber: number): Promise<void> {
  const config = loadConfig();
  const url = `${GITHUB_API_BASE}/repos/${config.repo}/pulls/${prNumber}`;

  logger.info({ prNumber }, "Closing pull request");

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ state: "closed" }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error closing PR #${prNumber}: ${response.status} ${body}`);
  }

  logger.info({ prNumber }, "Pull request closed");
}

export async function getPullRequest(prNumber: number): Promise<PRResponse> {
  const config = loadConfig();
  const url = `${GITHUB_API_BASE}/repos/${config.repo}/pulls/${prNumber}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error fetching PR #${prNumber}: ${response.status} ${body}`);
  }

  return (await response.json()) as PRResponse;
}

export async function getPullRequestDetails(prNumber: number): Promise<PRDetails> {
  const config = loadConfig();
  const url = `${GITHUB_API_BASE}/repos/${config.repo}/pulls/${prNumber}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API error fetching PR details #${prNumber}: ${response.status} ${body}`,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  const head = data.head as Record<string, unknown> | undefined;
  const base = data.base as Record<string, unknown> | undefined;

  return {
    number: data.number as number,
    html_url: data.html_url as string,
    state: data.state as string,
    title: data.title as string,
    merged: (data.merged as boolean) ?? false,
    mergeable: (data.mergeable as boolean | null) ?? null,
    mergeable_state: (data.mergeable_state as string) ?? "unknown",
    head_sha: (head?.sha as string) ?? "",
    base_ref: (base?.ref as string) ?? "main",
    changed_files: (data.changed_files as number) ?? 0,
    additions: (data.additions as number) ?? 0,
    deletions: (data.deletions as number) ?? 0,
  };
}

export async function getCheckRunsStatus(ref: string): Promise<CheckRunsStatus> {
  const config = loadConfig();
  const url = `${GITHUB_API_BASE}/repos/${config.repo}/commits/${ref}/check-runs`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error fetching check runs for ${ref}: ${response.status} ${body}`);
  }

  const data = (await response.json()) as {
    readonly total_count: number;
    readonly check_runs: ReadonlyArray<{
      readonly status: string;
      readonly conclusion: string | null;
    }>;
  };

  let passed = 0;
  let failed = 0;
  let pending = 0;

  for (const run of data.check_runs) {
    if (run.status !== "completed") {
      pending++;
    } else if (run.conclusion === "success" || run.conclusion === "skipped") {
      passed++;
    } else {
      failed++;
    }
  }

  return {
    totalCount: data.total_count,
    passed,
    failed,
    pending,
    allPassed: data.total_count > 0 && failed === 0 && pending === 0,
  };
}

export function isGitHubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN) && Boolean(process.env.GITHUB_REPO);
}
