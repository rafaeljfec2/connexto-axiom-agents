import { logger } from "../config/logger.js";
import type { KairosDelegation } from "../orchestration/types.js";
import type { FileChange } from "./projectSecurity.js";
import type { ForgeCodeOutput, ForgePlan } from "./forgeTypes.js";

export function parsePlanningOutput(text: string): ForgePlan | null {
  try {
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    if (!jsonMatch) {
      logger.error("No JSON object found in planning LLM output");
      return null;
    }

    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    if (typeof raw.plan !== "string" || raw.plan.length === 0) {
      logger.error("Missing or invalid plan in planning output");
      return null;
    }

    const filesToRead = parseStringArray(raw.files_to_read);
    const filesToModify = parseStringArray(raw.files_to_modify);
    const filesToCreate = parseStringArray(raw.files_to_create);

    if (filesToRead.length === 0 && filesToModify.length === 0 && filesToCreate.length === 0) {
      logger.error("Planning output has no files to read, modify, or create");
      return null;
    }

    const estimatedRisk = typeof raw.estimated_risk === "number"
      ? Math.min(5, Math.max(1, raw.estimated_risk))
      : 2;

    return {
      plan: raw.plan.slice(0, 200),
      filesToRead,
      filesToModify,
      filesToCreate,
      approach: typeof raw.approach === "string" ? raw.approach.slice(0, 300) : raw.plan.slice(0, 300),
      estimatedRisk,
      dependencies: parseStringArray(raw.dependencies),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Failed to parse planning LLM output");
    return null;
  }
}

export function parseCodeOutput(text: string): ForgeCodeOutput | null {
  try {
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    if (!jsonMatch) {
      logger.error("No JSON object found in project code LLM output");
      return null;
    }

    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    if (typeof raw.description !== "string" || raw.description.length === 0) {
      logger.error("Missing or invalid description in project code output");
      return null;
    }

    if (typeof raw.risk !== "number" || raw.risk < 1 || raw.risk > 5) {
      logger.error({ risk: raw.risk }, "Invalid risk value in project code output");
      return null;
    }

    if (!Array.isArray(raw.files)) {
      logger.error("Missing files array in project code output");
      return null;
    }

    if (raw.files.length === 0) {
      logger.info("LLM returned empty files array (task may already be done)");
      return {
        description: raw.description.slice(0, 200),
        risk: raw.risk,
        rollback: typeof raw.rollback === "string" ? raw.rollback : "",
        files: [],
      };
    }

    const files = parseFileChanges(raw.files as ReadonlyArray<Record<string, unknown>>);
    if (!files) return null;

    return {
      description: raw.description.slice(0, 200),
      risk: raw.risk,
      rollback: typeof raw.rollback === "string" ? raw.rollback : "",
      files,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Failed to parse project code LLM output");
    return null;
  }
}

export function buildFallbackPlan(delegation: KairosDelegation): ForgePlan {
  return {
    plan: delegation.task.slice(0, 200),
    filesToRead: [],
    filesToModify: [],
    filesToCreate: [],
    approach: delegation.expected_output.slice(0, 300),
    estimatedRisk: 2,
    dependencies: [],
  };
}

function parseFileChanges(
  rawFiles: ReadonlyArray<Record<string, unknown>>,
): readonly FileChange[] | null {
  const files: FileChange[] = [];

  for (const file of rawFiles) {
    const parsed = parseSingleFileChange(file);
    if (!parsed) {
      logger.warn({ path: file.path }, "Skipping invalid file entry from LLM output");
      continue;
    }
    files.push(parsed);
  }

  if (files.length === 0) {
    logger.error("All file entries were invalid in LLM output");
    return null;
  }

  return files;
}

function parseEditsArray(
  rawEdits: ReadonlyArray<Record<string, unknown>>,
  filePath: string,
): readonly { readonly search: string; readonly replace: string }[] | null {
  const edits: { readonly search: string; readonly replace: string }[] = [];

  for (const edit of rawEdits) {
    if (typeof edit.search !== "string" || edit.search.length === 0) {
      logger.warn({ path: filePath }, "Skipping edit with invalid search string");
      continue;
    }
    if (typeof edit.replace !== "string") {
      logger.warn({ path: filePath }, "Skipping edit with invalid replace string");
      continue;
    }
    edits.push({ search: edit.search, replace: edit.replace });
  }

  if (edits.length === 0) {
    logger.error({ path: filePath }, "All edits were invalid for file");
    return null;
  }

  return edits;
}

function parseModifyAction(file: Record<string, unknown>): FileChange | null {
  const filePath = file.path as string;

  if (Array.isArray(file.edits) && file.edits.length > 0) {
    const edits = parseEditsArray(file.edits as ReadonlyArray<Record<string, unknown>>, filePath);
    if (!edits) return null;
    return { path: filePath, action: "modify", content: "", edits };
  }

  if (typeof file.content === "string" && file.content.length > 0) {
    logger.debug({ path: filePath }, "Modify action using full content fallback (no edits)");
    return { path: filePath, action: "modify", content: file.content };
  }

  logger.error({ path: filePath }, "Modify action has neither edits nor content");
  return null;
}

function parseSingleFileChange(file: Record<string, unknown>): FileChange | null {
  if (typeof file.path !== "string" || file.path.length === 0) {
    logger.error("Invalid file path in project code output");
    return null;
  }
  if (file.action !== "create" && file.action !== "modify") {
    logger.error({ action: file.action }, "Invalid file action in project code output");
    return null;
  }

  if (file.action === "create") {
    if (typeof file.content !== "string") {
      logger.error("Missing content for create action in project code output");
      return null;
    }
    return { path: file.path, action: file.action, content: file.content };
  }

  return parseModifyAction(file);
}

function parseStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}
