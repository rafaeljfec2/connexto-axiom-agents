import { logger } from "../config/logger.js";

export interface OpenClawRequest {
  readonly model: string;
  readonly input: string;
  readonly instructions?: string;
}

interface OpenClawOutputItem {
  readonly type: string;
  readonly role?: string;
  readonly content?: {
    readonly type: string;
    readonly text: string;
  };
}

export interface OpenClawResponse {
  readonly status: "completed" | "failed" | "created";
  readonly output: readonly OpenClawOutputItem[];
}

interface OpenClawClientConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

function loadConfig(): OpenClawClientConfig {
  const endpoint = process.env.OPENCLAW_ENDPOINT;
  if (!endpoint) {
    throw new Error("OPENCLAW_ENDPOINT is required");
  }

  return {
    endpoint,
    apiKey: process.env.OPENCLAW_API_KEY ?? "",
    timeoutMs: 120_000,
    maxRetries: 2,
  };
}

export async function callOpenClaw(request: OpenClawRequest): Promise<OpenClawResponse> {
  const config = loadConfig();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      logger.info({ attempt, model: request.model }, "Calling OpenClaw");

      const url = `${config.endpoint}/v1/responses`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: request.model,
          input: request.input,
          instructions: request.instructions,
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenClaw API ${response.status}: ${body}`);
      }

      const data = (await response.json()) as OpenClawResponse;
      logger.info({ status: data.status }, "OpenClaw response received");
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn({ attempt, error: lastError.message }, "OpenClaw call failed");
    }
  }

  throw new Error(`OpenClaw failed after ${config.maxRetries} attempts: ${lastError?.message}`);
}

export function extractTextFromResponse(response: OpenClawResponse): string {
  for (const item of response.output) {
    if (item.type === "message" && item.content?.type === "text" && item.content.text) {
      return item.content.text;
    }
  }
  throw new Error("OpenClaw response contains no text output");
}
