import { logger } from "../config/logger.js";

export interface OpenClawRequest {
  readonly agentId: string;
  readonly prompt: string;
  readonly systemPrompt?: string;
}

export interface OpenClawResponse {
  readonly status: "completed" | "failed";
  readonly text: string;
}

interface OpenClawClientConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const MIN_PORT = 1024;
const MAX_PORT = 65535;

function validateEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(`Invalid OPENCLAW_ENDPOINT URL: "${endpoint}"`);
  }

  if (parsed.protocol !== "http:") {
    throw new Error(
      `OPENCLAW_ENDPOINT must use http protocol (loopback only), got: "${parsed.protocol}"`,
    );
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `OPENCLAW_ENDPOINT must be localhost or 127.0.0.1, got: "${parsed.hostname}"`,
    );
  }

  const port = parsed.port ? Number(parsed.port) : 80;
  if (port < MIN_PORT || port > MAX_PORT) {
    throw new Error(
      `OPENCLAW_ENDPOINT port must be between ${MIN_PORT} and ${MAX_PORT}, got: ${port}`,
    );
  }
}

function loadConfig(): OpenClawClientConfig {
  const endpoint = process.env.OPENCLAW_ENDPOINT;
  if (!endpoint) {
    throw new Error("OPENCLAW_ENDPOINT is required");
  }

  validateEndpoint(endpoint);

  return {
    endpoint,
    apiKey: process.env.OPENCLAW_API_KEY ?? "",
    timeoutMs: 120_000,
    maxRetries: 2,
  };
}

interface ChatCompletionResponse {
  readonly choices: ReadonlyArray<{
    readonly message: {
      readonly role: string;
      readonly content: string;
    };
    readonly finish_reason: string;
  }>;
}

export async function callOpenClaw(request: OpenClawRequest): Promise<OpenClawResponse> {
  const config = loadConfig();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      logger.info({ attempt, agent: request.agentId }, "Calling OpenClaw");

      const url = `${config.endpoint}/v1/chat/completions`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-openclaw-agent-id": request.agentId,
      };

      if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }

      const messages: Array<{ role: string; content: string }> = [];

      if (request.systemPrompt) {
        messages.push({ role: "system", content: request.systemPrompt });
      }

      messages.push({ role: "user", content: request.prompt });

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: `openclaw:${request.agentId}`,
          messages,
          stream: false,
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenClaw API ${response.status}: ${body}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const text = data.choices[0]?.message?.content;

      if (!text) {
        throw new Error("OpenClaw returned empty content");
      }

      logger.info({ chars: text.length }, "OpenClaw response received");

      return { status: "completed", text };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn({ attempt, error: lastError.message }, "OpenClaw call failed");
    }
  }

  throw new Error(`OpenClaw failed after ${config.maxRetries} attempts: ${lastError?.message}`);
}
