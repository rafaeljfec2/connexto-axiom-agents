import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { logger } from "../config/logger.js";

const PROJECTS_DIR = path.resolve("projects");

const projectId = process.argv[2];

if (!projectId) {
  logger.error("Usage: pnpm tsx scripts/register-project.ts <project-id>");
  logger.error("Example: pnpm tsx scripts/register-project.ts meu-saas");
  process.exit(1);
}

const PROJECT_ID_REGEX = /^[a-z][a-z0-9-]*[a-z0-9]$/;

if (!PROJECT_ID_REGEX.test(projectId) || projectId.length < 2 || projectId.length > 64) {
  logger.error(
    { projectId },
    "Invalid project ID. Must be kebab-case, 2-64 chars, start with letter",
  );
  process.exit(1);
}

const projectDir = path.resolve(PROJECTS_DIR, projectId);

if (fs.existsSync(projectDir)) {
  logger.error({ projectDir }, "Project directory already exists");
  process.exit(1);
}

const subdirs = ["forge", "workspace", "state"];

fs.mkdirSync(projectDir, { recursive: true });
for (const sub of subdirs) {
  fs.mkdirSync(path.join(projectDir, sub), { recursive: true });
}

const manifestTemplate = {
  project_id: projectId,
  repo_source: ".",
  stack: {
    language: "typescript",
    framework: "node",
  },
  risk_profile: "medium",
  autonomy_level: 2,
  token_budget_monthly: 100000,
  status: "paused",
};

const manifestPath = path.join(projectDir, "manifest.yaml");
fs.writeFileSync(manifestPath, stringifyYaml(manifestTemplate), "utf-8");

logger.info({ projectId, projectDir }, "Project registered successfully");
logger.info({ manifestPath }, "Edit the manifest to configure your project");
logger.info("Change status to 'active' when ready to start processing");
