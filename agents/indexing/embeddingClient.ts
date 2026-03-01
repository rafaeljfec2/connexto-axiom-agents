import { logger } from "../../config/logger.js";
import { INDEX_AGENT_CONFIG } from "./config.js";

interface EmbeddingResponse {
  readonly data: ReadonlyArray<{
    readonly embedding: readonly number[];
    readonly index: number;
  }>;
  readonly usage: {
    readonly prompt_tokens: number;
    readonly total_tokens: number;
  };
}

export interface EmbeddingResult {
  readonly embedding: Float32Array;
  readonly tokensUsed: number;
}

function getOpenAIApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for embedding generation");
  }
  return key;
}

export async function generateEmbeddings(
  texts: readonly string[],
): Promise<readonly EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const apiKey = getOpenAIApiKey();

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: INDEX_AGENT_CONFIG.embeddingModel,
      input: texts,
      dimensions: INDEX_AGENT_CONFIG.embeddingDimensions,
    }),
    signal: AbortSignal.timeout(INDEX_AGENT_CONFIG.timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI Embeddings API ${String(response.status)}: ${body}`);
  }

  const data = (await response.json()) as EmbeddingResponse;

  const sorted = [...data.data].sort((a, b) => a.index - b.index);

  return sorted.map((item) => ({
    embedding: new Float32Array(item.embedding),
    tokensUsed: Math.ceil(data.usage.total_tokens / data.data.length),
  }));
}

async function generateWithRetry(
  batch: readonly string[],
  batchStart: number,
): Promise<readonly EmbeddingResult[]> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= INDEX_AGENT_CONFIG.maxRetries; attempt++) {
    try {
      return await generateEmbeddings(batch);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        { attempt, batchStart, batchSize: batch.length, error: lastError.message },
        "Embedding batch failed, retrying...",
      );

      if (attempt < INDEX_AGENT_CONFIG.maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw new Error(
    `Embedding batch failed after ${String(INDEX_AGENT_CONFIG.maxRetries)} retries: ${lastError?.message}`,
  );
}

export async function generateEmbeddingsBatch(
  texts: readonly string[],
  batchSize: number = INDEX_AGENT_CONFIG.batchSize,
): Promise<readonly EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await generateWithRetry(batch, i);
    results.push(...batchResults);
  }

  return results;
}
