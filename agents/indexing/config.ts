export const INDEX_AGENT_CONFIG = {
  embeddingModel: "text-embedding-3-small",
  embeddingDimensions: 1536,
  maxTokensPerChunk: 512,
  maxCharsPerChunk: 2000,
  batchSize: 20,
  maxRetries: 3,
  timeoutMs: 30_000,
} as const;

export const INDEXABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
  ".rb", ".php", ".ex", ".exs", ".dart", ".swift", ".kt",
  ".cs", ".c", ".cpp", ".h", ".hpp", ".vue", ".svelte",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".mdx", ".txt", ".rst",
  ".sql", ".graphql", ".proto",
  ".sh", ".bash", ".zsh",
  ".css", ".scss", ".less",
  ".html", ".xml",
  ".dockerfile", ".env.example",
]);

export const IGNORED_DIRS = new Set([
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
  ".cache",
]);
