import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../config/logger.js";

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

  if (params.base !== "main") {
    throw new Error(`PR base must be "main", got: "${params.base}"`);
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

export function isGitHubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN) && Boolean(process.env.GITHUB_REPO);
}
