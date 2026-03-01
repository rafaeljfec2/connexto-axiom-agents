import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";
import { callLLM, type LLMClientConfig, type LLMUsage } from "../../llm/client.js";
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

interface GenerateResult {
  readonly text: string;
  readonly usage: LLMUsage;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n... [truncated due to context limit]";
}

async function generateDocument(
  llmConfig: LLMClientConfig,
  systemPrompt: string,
  docType: string,
  fileTree: string,
  relevantFiles: readonly ProjectFile[],
  existingDocs: string,
): Promise<GenerateResult> {
  const { maxContextChars, maxFileTreeChars } = DOCUMENTATION_AGENT_CONFIG;

  const truncatedTree = truncateText(fileTree, maxFileTreeChars);

  let contextText = "";
  let currentSize = 0;
  for (const file of relevantFiles) {
    const entry = `--- ${file.relativePath} [${file.category}] ---\n${file.content}\n`;
    if (currentSize + entry.length > maxContextChars && currentSize > 0) break;
    contextText += entry;
    currentSize += entry.length;
  }

  if (contextText.length === 0) {
    contextText = "No relevant source files available for this document type.";
  }

  const existingSection = existingDocs
    ? `\n\n## Existing Documentation (preserve and enhance):\n${existingDocs}`
    : "";

  const userMessage = [
    `Generate the "${docType}" documentation for this project.`,
    "",
    "## Project structure (summary):",
    truncatedTree,
    existingSection,
    "",
    "## Source code context:",
    "",
    contextText,
    "",
    `Output ONLY the markdown content for ${docType}. Do not include any preamble or explanation outside the document.`,
  ].join("\n");

  logger.info(
    { docType, contextChars: contextText.length, treeChars: truncatedTree.length, filesIncluded: relevantFiles.length },
    "Prepared LLM prompt",
  );

  const response = await callLLM(llmConfig, {
    system: systemPrompt,
    userMessage,
    maxOutputTokens: DOCUMENTATION_AGENT_CONFIG.maxOutputTokens,
  });

  return { text: response.text, usage: response.usage };
}

function calculateRateLimitDelay(inputTokensUsed: number): number {
  const { rateLimitInputTokensPerMinute, rateLimitBufferMs } = DOCUMENTATION_AGENT_CONFIG;
  const minutesNeeded = inputTokensUsed / rateLimitInputTokensPerMinute;
  return Math.ceil(minutesNeeded * 60_000) + rateLimitBufferMs;
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

  const docsPath = path.join(workspacePath, "docs");
  if (!fs.existsSync(docsPath)) {
    fs.mkdirSync(docsPath, { recursive: true });
  }

  const llmConfig = getLLMConfig();
  const systemPrompt = loadSystemPrompt();

  let pendingDelayMs = 0;

  for (let i = 0; i < DOC_FILES.length; i++) {
    if (i > 0 && pendingDelayMs > 0) {
      const waitSec = Math.ceil(pendingDelayMs / 1_000);
      notify(`Waiting ${String(waitSec)}s before next document (rate limit)...`);
      logger.info({ waitMs: pendingDelayMs, nextDoc: DOC_FILES[i] }, "Rate limit cooldown");
      await new Promise((resolve) => setTimeout(resolve, pendingDelayMs));
    }

    const docFile = DOC_FILES[i];
    const docType = docFile.replace(".md", "");
    notify(`Generating ${docType} documentation (${String(i + 1)}/${String(DOC_FILES.length)})...`);

    let existingContent = "";
    const existingPath = path.join(docsPath, docFile);
    if (fs.existsSync(existingPath)) {
      existingContent = fs.readFileSync(existingPath, "utf-8");
    }

    try {
      const relevantFiles = filterFilesForDocType(docType, files);

      const result = await generateDocument(
        llmConfig,
        systemPrompt,
        docType,
        fileTree,
        relevantFiles,
        existingContent,
      );

      await fsPromises.writeFile(existingPath, result.text, "utf-8");
      logger.info({ docFile, inputTokens: result.usage.inputTokens }, "Documentation generated");
      notify(`Completed ${docType} documentation`);

      pendingDelayMs = calculateRateLimitDelay(result.usage.inputTokens);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ docFile, error: msg }, "Failed to generate documentation");
      notify(`Failed to generate ${docType}: ${msg}`);
      pendingDelayMs = DOCUMENTATION_AGENT_CONFIG.rateLimitBufferMs;
    }
  }

  logger.info({ workspacePath }, "DocumentationAgent completed");
}

const CATEGORY_PRIORITY: Record<string, readonly ProjectFile["category"][]> = {
  architecture: ["implementation", "config", "interface"],
  implementation: ["implementation", "test"],
  interfaces: ["interface", "implementation"],
  config: ["config", "other"],
  domain: ["implementation", "docs", "interface"],
  database: ["implementation", "config", "interface"],
  security: ["implementation", "config", "interface"],
  frontend: ["implementation", "interface", "config"],
  backend: ["implementation", "config", "interface"],
};

const PATH_PATTERNS: Record<string, readonly RegExp[]> = {
  database: [/migrat/i, /schema/i, /model/i, /entit/i, /repositor/i, /prisma/i, /drizzle/i, /typeorm/i, /\.sql$/i, /seed/i, /database/i, /db\./i],
  security: [/auth/i, /guard/i, /middlewar/i, /encrypt/i, /hash/i, /jwt/i, /token/i, /permission/i, /role/i, /policy/i, /secur/i, /csrf/i, /cors/i],
  frontend: [/component/i, /page/i, /hook/i, /context/i, /store/i, /style/i, /\.tsx$/i, /\.css$/i, /\.scss$/i, /layout/i, /view/i, /ui\//i],
  backend: [/controller/i, /service/i, /module/i, /middlewar/i, /resolver/i, /handler/i, /route/i, /worker/i, /queue/i, /job/i, /cron/i],
};

function filterFilesForDocType(
  docType: string,
  files: readonly ProjectFile[],
): readonly ProjectFile[] {
  const priorities = CATEGORY_PRIORITY[docType] ?? ["implementation"];
  const patterns = PATH_PATTERNS[docType];

  let filtered: ProjectFile[];

  if (patterns) {
    filtered = files.filter(
      (f) => patterns.some((p) => p.test(f.relativePath)) || priorities.includes(f.category),
    );
  } else {
    filtered = files.filter((f) => priorities.includes(f.category));
  }

  if (filtered.length === 0) return [...files];

  filtered.sort((a, b) => {
    const aMatch = patterns ? patterns.some((p) => p.test(a.relativePath)) : false;
    const bMatch = patterns ? patterns.some((p) => p.test(b.relativePath)) : false;
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return a.sizeBytes - b.sizeBytes;
  });

  return filtered;
}
