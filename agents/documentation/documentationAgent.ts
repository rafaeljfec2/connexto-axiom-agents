import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";
import { callLLM, type LLMClientConfig } from "../../llm/client.js";
import { DOCUMENTATION_AGENT_CONFIG, DOC_FILES, loadSystemPrompt } from "./config.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "target",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
  ".rb", ".php", ".ex", ".exs", ".dart", ".swift", ".kt",
  ".cs", ".c", ".cpp", ".h", ".hpp", ".vue", ".svelte",
]);

const CONFIG_EXTENSIONS = new Set([
  ".json", ".yaml", ".yml", ".toml", ".ini", ".env",
  ".env.example", ".conf", ".cfg",
]);

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst"]);

interface ProjectFile {
  readonly relativePath: string;
  readonly content: string;
  readonly category: "implementation" | "config" | "docs" | "test" | "interface" | "other";
  readonly sizeBytes: number;
}

type ProgressCallback = (message: string) => void;

function categorizeFile(relativePath: string, ext: string): ProjectFile["category"] {
  if (relativePath.includes("test") || relativePath.includes("spec") || relativePath.includes("__tests__")) {
    return "test";
  }
  if (relativePath.includes("types") || relativePath.includes("interface") || ext === ".d.ts") {
    return "interface";
  }
  if (DOC_EXTENSIONS.has(ext)) return "docs";
  if (CONFIG_EXTENSIONS.has(ext)) return "config";
  if (CODE_EXTENSIONS.has(ext)) return "implementation";
  return "other";
}

async function collectProjectFiles(workspacePath: string): Promise<readonly ProjectFile[]> {
  const files: ProjectFile[] = [];
  const maxFileSize = 100_000;

  async function walk(dir: string, basePath: string): Promise<void> {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      if (entry.isDirectory()) {
        await walk(fullPath, basePath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const allExts = new Set([...CODE_EXTENSIONS, ...CONFIG_EXTENSIONS, ...DOC_EXTENSIONS]);

        if (!allExts.has(ext)) continue;

        const stat = await fsPromises.stat(fullPath);
        if (stat.size > maxFileSize) continue;

        const content = await fsPromises.readFile(fullPath, "utf-8");
        const category = categorizeFile(relativePath, ext);
        files.push({ relativePath, content, category, sizeBytes: stat.size });
      }
    }
  }

  await walk(workspacePath, workspacePath);
  return files;
}

function buildFileTree(files: readonly ProjectFile[]): string {
  const lines: string[] = ["Project structure:", ""];
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const file of sorted) {
    const depth = file.relativePath.split(path.sep).length - 1;
    const indent = "  ".repeat(depth);
    const name = path.basename(file.relativePath);
    lines.push(`${indent}${name} [${file.category}] (${String(file.sizeBytes)}b)`);
  }

  return lines.join("\n");
}

function buildContextChunks(
  files: readonly ProjectFile[],
  maxChars: number,
): readonly string[][] {
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;

  for (const file of files) {
    const entry = `--- ${file.relativePath} [${file.category}] ---\n${file.content}\n`;

    if (currentSize + entry.length > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(entry);
    currentSize += entry.length;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function getLLMConfig(): LLMClientConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY or LLM_API_KEY is required for DocumentationAgent");
  }

  return {
    provider: "claude",
    apiKey,
    model: DOCUMENTATION_AGENT_CONFIG.model,
    timeoutMs: DOCUMENTATION_AGENT_CONFIG.timeoutMs,
    maxRetries: DOCUMENTATION_AGENT_CONFIG.maxRetries,
  };
}

async function generateDocument(
  llmConfig: LLMClientConfig,
  systemPrompt: string,
  docType: string,
  fileTree: string,
  contextChunks: readonly string[][],
  existingDocs: string,
): Promise<string> {
  const contextText = contextChunks.length > 0
    ? contextChunks[0].join("\n")
    : "No source files available.";

  const existingSection = existingDocs
    ? `\n\n## Existing Documentation (preserve and enhance):\n${existingDocs}`
    : "";

  const userMessage = [
    `Generate the "${docType}" documentation for this project.`,
    "",
    fileTree,
    existingSection,
    "",
    "## Source code context:",
    "",
    contextText,
    "",
    `Output ONLY the markdown content for ${docType}. Do not include any preamble or explanation outside the document.`,
  ].join("\n");

  const response = await callLLM(llmConfig, {
    system: systemPrompt,
    userMessage,
    maxOutputTokens: DOCUMENTATION_AGENT_CONFIG.maxOutputTokens,
  });

  return response.text;
}

export async function runDocumentationAgent(
  workspacePath: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const notify = onProgress ?? (() => {});

  logger.info({ workspacePath }, "DocumentationAgent starting");
  notify("Collecting project files...");

  const files = await collectProjectFiles(workspacePath);
  logger.info({ fileCount: files.length }, "Project files collected");
  notify(`Found ${String(files.length)} files to analyze`);

  const fileTree = buildFileTree(files);
  const contextChunks = buildContextChunks(files, DOCUMENTATION_AGENT_CONFIG.chunkSizeChars);

  const docsPath = path.join(workspacePath, "docs");
  const docsExist = fs.existsSync(docsPath);

  if (!docsExist) {
    fs.mkdirSync(docsPath, { recursive: true });
  }

  const llmConfig = getLLMConfig();
  const systemPrompt = loadSystemPrompt();

  for (let i = 0; i < DOC_FILES.length; i++) {
    if (i > 0 && DOCUMENTATION_AGENT_CONFIG.delayBetweenCallsMs > 0) {
      const waitSec = DOCUMENTATION_AGENT_CONFIG.delayBetweenCallsMs / 1_000;
      notify(`Waiting ${String(waitSec)}s before next document (rate limit)...`);
      await new Promise((resolve) =>
        setTimeout(resolve, DOCUMENTATION_AGENT_CONFIG.delayBetweenCallsMs),
      );
    }

    const docFile = DOC_FILES[i];
    const docType = docFile.replace(".md", "");
    notify(`Generating ${docType} documentation...`);

    let existingContent = "";
    const existingPath = path.join(docsPath, docFile);
    if (fs.existsSync(existingPath)) {
      existingContent = fs.readFileSync(existingPath, "utf-8");
    }

    try {
      const relevantChunks = filterChunksForDocType(docType, contextChunks, files);

      const content = await generateDocument(
        llmConfig,
        systemPrompt,
        docType,
        fileTree,
        relevantChunks,
        existingContent,
      );

      await fsPromises.writeFile(existingPath, content, "utf-8");
      logger.info({ docFile, workspacePath }, "Documentation generated");
      notify(`Completed ${docType} documentation`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ docFile, error: msg }, "Failed to generate documentation");
      notify(`Failed to generate ${docType}: ${msg}`);
    }
  }

  logger.info({ workspacePath }, "DocumentationAgent completed");
}

function filterChunksForDocType(
  docType: string,
  allChunks: readonly string[][],
  files: readonly ProjectFile[],
): readonly string[][] {
  const categoryPriority: Record<string, readonly ProjectFile["category"][]> = {
    architecture: ["implementation", "config", "interface"],
    implementation: ["implementation", "test"],
    interfaces: ["interface", "implementation"],
    config: ["config", "other"],
    domain: ["implementation", "docs", "interface"],
  };

  const priorities = categoryPriority[docType] ?? ["implementation"];
  const relevantFiles = files.filter((f) => priorities.includes(f.category));

  if (relevantFiles.length === 0) return allChunks;

  return buildContextChunks(relevantFiles, DOCUMENTATION_AGENT_CONFIG.chunkSizeChars);
}
