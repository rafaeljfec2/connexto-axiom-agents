import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { logger } from "../config/logger.js";
import {
  validateManifest,
  ManifestValidationError,
  type ProjectManifest,
} from "./manifest.schema.js";

const PROJECTS_DIR = path.resolve("projects");
const MANIFEST_FILENAME = "manifest.yaml";

export function loadManifest(projectId: string): ProjectManifest {
  const manifestPath = path.resolve(PROJECTS_DIR, projectId, MANIFEST_FILENAME);

  if (!fs.existsSync(manifestPath)) {
    throw new ManifestValidationError(
      `Manifest not found for project "${projectId}" at ${manifestPath}`,
    );
  }

  const raw = fs.readFileSync(manifestPath, "utf-8");
  const parsed: unknown = parseYaml(raw);

  return validateManifest(parsed);
}

export function loadAllManifests(): readonly ProjectManifest[] {
  if (!fs.existsSync(PROJECTS_DIR)) {
    logger.info("No projects directory found, skipping manifest loading");
    return [];
  }

  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const manifests: ProjectManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.resolve(PROJECTS_DIR, entry.name, MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const parsed: unknown = parseYaml(raw);
      const manifest = validateManifest(parsed);
      manifests.push(manifest);
      logger.info({ projectId: manifest.projectId, status: manifest.status }, "Manifest loaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ directory: entry.name, error: message }, "Failed to load manifest, skipping");
    }
  }

  return manifests;
}

export function getProjectDir(projectId: string): string {
  return path.resolve(PROJECTS_DIR, projectId);
}

export function getProjectManifestPath(projectId: string): string {
  return path.resolve(PROJECTS_DIR, projectId, MANIFEST_FILENAME);
}
