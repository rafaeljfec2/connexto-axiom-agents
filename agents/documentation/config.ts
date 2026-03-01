import fs from "node:fs";
import path from "node:path";

export const DOCUMENTATION_AGENT_CONFIG = {
  model: "claude-sonnet-4-20250514",
  maxOutputTokens: 8192,
  timeoutMs: 120_000,
  maxRetries: 2,
  maxContextTokens: 100_000,
  chunkSizeChars: 300_000,
} as const;

export const DOC_FILES = [
  "architecture.md",
  "implementation.md",
  "interfaces.md",
  "config.md",
  "domain.md",
] as const;

export function loadSystemPrompt(): string {
  const candidates = [
    path.resolve(__dirname, "SYSTEM.md"),
    path.resolve("agents", "documentation", "SYSTEM.md"),
    path.resolve("..", "..", "agents", "documentation", "SYSTEM.md"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf-8");
    }
  }

  throw new Error(
    `SYSTEM.md not found for DocumentationAgent. Searched: ${candidates.join(", ")}`,
  );
}
