import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger.js";

const AXIOM_HOME =
  process.env.AXIOM_HOME ?? path.join(os.homedir(), "connexto-axiom-agents");

export const REPOSITORIES_DIR = path.join(AXIOM_HOME, "repositories");
export const WORKSPACES_DIR = path.join(AXIOM_HOME, "workspaces", "forge");
export const INDEX_DIR = path.join(AXIOM_HOME, "index");

export function getAxiomHome(): string {
  return AXIOM_HOME;
}

export function ensureAxiomDirectories(): void {
  const dirs = [REPOSITORIES_DIR, WORKSPACES_DIR, INDEX_DIR];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info({ dir }, "Created Axiom directory");
    }
  }
}
