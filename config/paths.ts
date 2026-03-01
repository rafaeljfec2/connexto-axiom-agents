import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger.js";

let _resolvedHome: string | null = null;

function resolveAxiomHome(): string {
  if (!_resolvedHome) {
    _resolvedHome =
      process.env.AXIOM_HOME ?? path.join(os.homedir(), "connexto-axiom-agents");
    logger.info({ axiomHome: _resolvedHome }, "AXIOM_HOME resolved");
  }
  return _resolvedHome;
}

export function getAxiomHome(): string {
  return resolveAxiomHome();
}

export function getRepositoriesDir(): string {
  return path.join(resolveAxiomHome(), "repositories");
}

export function getWorkspacesDir(): string {
  return path.join(resolveAxiomHome(), "workspaces", "forge");
}

export function getIndexDir(): string {
  return path.join(resolveAxiomHome(), "index");
}

export function ensureAxiomDirectories(): void {
  const dirs = [getRepositoriesDir(), getWorkspacesDir(), getIndexDir()];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info({ dir }, "Created Axiom directory");
    }
  }
}
