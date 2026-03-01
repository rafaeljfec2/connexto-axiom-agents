import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import { generateEmbeddingsBatch } from "./embeddingClient.js";
import { INDEX_AGENT_CONFIG, INDEXABLE_EXTENSIONS, IGNORED_DIRS } from "./config.js";

interface FileChunk {
  readonly filePath: string;
  readonly chunkIndex: number;
  readonly text: string;
}

type ProgressCallback = (filesIndexed: number) => void;

function splitIntoChunks(content: string, maxChars: number): readonly string[] {
  const lines = content.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    if (current.length + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

async function collectFileChunks(workspacePath: string): Promise<readonly FileChunk[]> {
  const chunks: FileChunk[] = [];
  const maxFileSize = 200_000;

  async function walk(dir: string): Promise<void> {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const nameAsExt = entry.name.toLowerCase();

      if (!INDEXABLE_EXTENSIONS.has(ext) && !INDEXABLE_EXTENSIONS.has(`.${nameAsExt}`)) continue;

      const stat = await fsPromises.stat(fullPath);
      if (stat.size > maxFileSize || stat.size === 0) continue;

      const content = await fsPromises.readFile(fullPath, "utf-8");
      const relativePath = path.relative(workspacePath, fullPath);
      const fileChunks = splitIntoChunks(content, INDEX_AGENT_CONFIG.maxCharsPerChunk);

      for (let i = 0; i < fileChunks.length; i++) {
        chunks.push({
          filePath: relativePath,
          chunkIndex: i,
          text: `File: ${relativePath}\n\n${fileChunks[i]}`,
        });
      }
    }
  }

  await walk(workspacePath);
  return chunks;
}

function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

export async function runProjectIndexAgent(
  db: BetterSqlite3.Database,
  projectId: string,
  workspacePath: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  logger.info({ projectId, workspacePath }, "ProjectIndexAgent starting");

  db.prepare("DELETE FROM project_embeddings WHERE project_id = ?").run(projectId);

  const chunks = await collectFileChunks(workspacePath);
  logger.info({ projectId, chunkCount: chunks.length }, "File chunks collected");

  if (chunks.length === 0) {
    logger.info({ projectId }, "No files to index");
    return;
  }

  const insertStmt = db.prepare(`
    INSERT INTO project_embeddings (id, project_id, file_path, chunk_index, chunk_text, embedding, tokens_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let totalIndexed = 0;
  const uniqueFiles = new Set<string>();

  for (let i = 0; i < chunks.length; i += INDEX_AGENT_CONFIG.batchSize) {
    const batch = chunks.slice(i, i + INDEX_AGENT_CONFIG.batchSize);
    const texts = batch.map((c) => c.text);

    try {
      const embeddings = await generateEmbeddingsBatch(texts, texts.length);

      const insertMany = db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const embedding = embeddings[j];

          insertStmt.run(
            crypto.randomUUID(),
            projectId,
            chunk.filePath,
            chunk.chunkIndex,
            chunk.text,
            embeddingToBuffer(embedding.embedding),
            embedding.tokensUsed,
          );

          uniqueFiles.add(chunk.filePath);
        }
      });

      insertMany();
      totalIndexed += batch.length;

      if (onProgress) {
        onProgress(uniqueFiles.size);
      }

      logger.debug(
        { projectId, indexed: totalIndexed, total: chunks.length },
        "Embedding batch indexed",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ projectId, batchStart: i, error: msg }, "Embedding batch failed");
      throw err;
    }
  }

  logger.info(
    { projectId, totalChunks: totalIndexed, uniqueFiles: uniqueFiles.size },
    "ProjectIndexAgent completed",
  );
}
