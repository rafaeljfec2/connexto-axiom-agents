import type BetterSqlite3 from "better-sqlite3";
import { generateEmbeddings } from "../agents/indexing/embeddingClient.js";

interface EmbeddingRow {
  readonly id: string;
  readonly project_id: string;
  readonly file_path: string;
  readonly chunk_index: number;
  readonly chunk_text: string;
  readonly embedding: Buffer;
  readonly tokens_count: number;
}

export interface SearchResult {
  readonly filePath: string;
  readonly chunkIndex: number;
  readonly chunkText: string;
  readonly score: number;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

function bufferToFloat32Array(buffer: Buffer): Float32Array {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return new Float32Array(arrayBuffer);
}

export async function vectorSearch(
  db: BetterSqlite3.Database,
  projectId: string,
  query: string,
  topK: number = 10,
): Promise<readonly SearchResult[]> {
  const [queryEmbedding] = await generateEmbeddings([query]);
  if (!queryEmbedding) {
    return [];
  }

  const rows = db
    .prepare("SELECT * FROM project_embeddings WHERE project_id = ?")
    .all(projectId) as EmbeddingRow[];

  const scored = rows.map((row) => {
    const rowEmbedding = bufferToFloat32Array(row.embedding);
    const score = cosineSimilarity(queryEmbedding.embedding, rowEmbedding);
    return {
      filePath: row.file_path,
      chunkIndex: row.chunk_index,
      chunkText: row.chunk_text,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const keywordLower = query.toLowerCase();
  const topResults = scored.slice(0, topK * 2);
  const reranked = topResults.map((result) => {
    const textLower = result.chunkText.toLowerCase();
    const keywordBoost = textLower.includes(keywordLower) ? 0.05 : 0;
    return { ...result, score: result.score + keywordBoost };
  });

  reranked.sort((a, b) => b.score - a.score);
  return reranked.slice(0, topK);
}
