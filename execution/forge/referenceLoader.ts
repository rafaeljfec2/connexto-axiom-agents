import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { logger } from "../../config/logger.js";
import type { ForgeTaskType } from "./openclawInstructions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROJECTS_DIR = path.resolve("projects");
const GLOBAL_REFERENCES_DIR = path.resolve(__dirname, "../../agents/forge/references");
const DEFAULT_MAX_TOKENS = 3000;
const CHARS_PER_TOKEN = 4;

export interface ReferenceFrontmatter {
  readonly tags: readonly string[];
  readonly applies_to: readonly ForgeTaskType[];
  readonly description: string;
}

export interface ReferenceFile {
  readonly filename: string;
  readonly frontmatter: ReferenceFrontmatter;
  readonly content: string;
  readonly source: "project" | "global";
  readonly charCount: number;
}

export interface ScoredReference {
  readonly reference: ReferenceFile;
  readonly score: number;
}

export interface ReferenceSelectionContext {
  readonly taskType: ForgeTaskType;
  readonly language: string;
  readonly framework: string;
  readonly taskDescription: string;
}

export interface ReferencesConfig {
  readonly maxTokens: number;
  readonly includeGlobal: boolean;
}

const DEFAULT_REFERENCES_CONFIG: ReferencesConfig = {
  maxTokens: DEFAULT_MAX_TOKENS,
  includeGlobal: true,
};

export function parseReferenceFrontmatter(raw: string): {
  readonly frontmatter: ReferenceFrontmatter | null;
  readonly content: string;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
  const match = frontmatterRegex.exec(raw);

  if (!match) {
    return { frontmatter: null, content: raw.trim() };
  }

  try {
    const parsed = parseYaml(match[1]) as Record<string, unknown>;

    const tags = Array.isArray(parsed["tags"])
      ? (parsed["tags"] as string[]).map((t) => String(t).toLowerCase())
      : [];

    const appliesTo = Array.isArray(parsed["applies_to"])
      ? (parsed["applies_to"] as string[]).filter(isValidTaskType)
      : (["IMPLEMENT", "FIX", "CREATE", "REFACTOR"] as ForgeTaskType[]);

    const description = typeof parsed["description"] === "string"
      ? parsed["description"]
      : "";

    return {
      frontmatter: { tags, applies_to: appliesTo, description },
      content: match[2].trim(),
    };
  } catch {
    return { frontmatter: null, content: raw.trim() };
  }
}

function isValidTaskType(value: string): value is ForgeTaskType {
  return ["IMPLEMENT", "FIX", "CREATE", "REFACTOR"].includes(value);
}

async function loadReferencesFromDir(
  dirPath: string,
  source: "project" | "global",
): Promise<readonly ReferenceFile[]> {
  if (!fs.existsSync(dirPath)) return [];

  const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
  const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".md"));

  const results: ReferenceFile[] = [];

  for (const file of mdFiles) {
    try {
      const raw = await fsPromises.readFile(path.join(dirPath, file.name), "utf-8");
      const { frontmatter, content } = parseReferenceFrontmatter(raw);

      if (!content) continue;

      results.push({
        filename: file.name,
        frontmatter: frontmatter ?? { tags: [], applies_to: ["IMPLEMENT", "FIX", "CREATE", "REFACTOR"], description: "" },
        content,
        source,
        charCount: content.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ file: file.name, source, error: msg }, "Failed to load reference file");
    }
  }

  return results;
}

export function scoreReference(
  ref: ReferenceFile,
  ctx: ReferenceSelectionContext,
): number {
  let score = 0;

  const taskTypeMatch = ref.frontmatter.applies_to.includes(ctx.taskType);
  if (!taskTypeMatch) return 0;

  score += 10;

  const stackKeywords = new Set(
    [
      ctx.language.toLowerCase(),
      ctx.framework.toLowerCase(),
      ...ctx.framework.toLowerCase().split("-"),
    ].filter(Boolean),
  );

  for (const tag of ref.frontmatter.tags) {
    if (stackKeywords.has(tag)) {
      score += 5;
    }
  }

  const taskWords = extractKeywords(ctx.taskDescription);
  for (const tag of ref.frontmatter.tags) {
    if (taskWords.has(tag)) {
      score += 3;
    }
  }

  if (ref.source === "project") {
    score += 2;
  }

  return score;
}

function extractKeywords(text: string): ReadonlySet<string> {
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "must", "for", "and",
    "but", "or", "nor", "not", "no", "so", "yet", "both", "either",
    "neither", "each", "every", "all", "any", "few", "more", "most",
    "other", "some", "such", "than", "too", "very", "just", "because",
    "as", "until", "while", "of", "at", "by", "from", "up", "about",
    "into", "through", "during", "before", "after", "above", "below",
    "to", "in", "on", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "with", "this",
    "that", "these", "those", "it", "its", "de", "do", "da", "em", "um",
    "uma", "para", "com", "por", "que", "no", "na", "se", "os", "as",
    "ao", "dos", "das", "nos", "nas", "ou",
  ]);

  return new Set(
    text
      .toLowerCase()
      .replaceAll(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w)),
  );
}

export function selectReferences(
  references: readonly ReferenceFile[],
  ctx: ReferenceSelectionContext,
  maxTokens: number,
): readonly ScoredReference[] {
  const scored: ScoredReference[] = references
    .map((ref) => ({ reference: ref, score: scoreReference(ref, ctx) }))
    .filter((sr) => sr.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const selected: ScoredReference[] = [];
  let totalChars = 0;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  for (const sr of scored) {
    if (totalChars + sr.reference.charCount > maxChars) continue;
    selected.push(sr);
    totalChars += sr.reference.charCount;
  }

  return selected;
}

export function formatReferencesForPrompt(
  selected: readonly ScoredReference[],
): string {
  if (selected.length === 0) return "";

  const lines: string[] = [
    "# Reference Examples",
    "",
    "> Follow these patterns when implementing similar code.",
  ];

  for (const sr of selected) {
    const title = sr.reference.frontmatter.description
      || sr.reference.filename.replace(/\.md$/, "");

    lines.push("", `## ${title}`, "", sr.reference.content);
  }

  return lines.join("\n");
}

export async function loadAndSelectReferences(
  projectId: string,
  ctx: ReferenceSelectionContext,
  config?: Partial<ReferencesConfig>,
): Promise<string> {
  const effectiveConfig: ReferencesConfig = {
    ...DEFAULT_REFERENCES_CONFIG,
    ...config,
  };

  const projectRefsDir = path.join(PROJECTS_DIR, projectId, "references");

  const loadTasks: Promise<readonly ReferenceFile[]>[] = [
    loadReferencesFromDir(projectRefsDir, "project"),
  ];

  if (effectiveConfig.includeGlobal) {
    loadTasks.push(loadReferencesFromDir(GLOBAL_REFERENCES_DIR, "global"));
  }

  const results = await Promise.all(loadTasks);
  const allReferences = results.flat();

  if (allReferences.length === 0) {
    logger.debug({ projectId }, "No reference files found");
    return "";
  }

  const selected = selectReferences(allReferences, ctx, effectiveConfig.maxTokens);

  logger.info(
    {
      projectId,
      totalAvailable: allReferences.length,
      selected: selected.length,
      maxTokens: effectiveConfig.maxTokens,
      scores: selected.map((s) => ({ file: s.reference.filename, score: s.score, source: s.reference.source })),
    },
    "Reference files selected for context injection",
  );

  return formatReferencesForPrompt(selected);
}
