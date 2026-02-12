import { logger } from "../../config/logger.js";

export interface OpenClawRequest {
  readonly agentId: string;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly traceId?: string;
}

export interface TokenUsageInfo {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface OpenClawResponse {
  readonly status: "completed" | "failed";
  readonly text: string;
  readonly usage?: TokenUsageInfo;
}

export type OpenClawErrorKind = "infra" | "auth" | "request";

export interface OpenClawError {
  readonly kind: OpenClawErrorKind;
  readonly message: string;
  readonly httpStatus?: number;
  readonly attempts: number;
}

export type OpenClawResult =
  | { readonly ok: true; readonly response: OpenClawResponse }
  | { readonly ok: false; readonly error: OpenClawError };

interface OpenClawClientConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
}

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const MIN_PORT = 1024;
const MAX_PORT = 65535;

const MAX_INFRA_RETRIES = 3;
const BACKOFF_MS: readonly number[] = [250, 750, 1500];
const HEALTHCHECK_TIMEOUT_MS = 500;

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
    throw new Error(`OPENCLAW_ENDPOINT must be localhost or 127.0.0.1, got: "${parsed.hostname}"`);
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
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

function buildHeaders(
  config: OpenClawClientConfig,
  agentId: string,
  traceId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-openclaw-agent-id": agentId,
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  if (traceId) {
    headers["x-trace-id"] = traceId;
  }

  return headers;
}

function buildMessages(request: OpenClawRequest): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  if (request.systemPrompt) {
    messages.push({ role: "system", content: request.systemPrompt });
  }

  messages.push({ role: "user", content: request.prompt });

  return messages;
}

function mapUsage(raw: ChatCompletionResponse["usage"]): TokenUsageInfo | undefined {
  if (!raw) return undefined;

  return {
    inputTokens: raw.prompt_tokens,
    outputTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
  };
}

function classifyHttpError(status: number): OpenClawErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "infra";
  return "request";
}

function classifyNetworkError(error: Error): OpenClawErrorKind {
  const msg = error.message.toLowerCase();
  if (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  ) {
    return "infra";
  }
  return "request";
}

type RequestAttemptResult =
  | { readonly ok: true; readonly response: OpenClawResponse }
  | { readonly ok: false; readonly kind: OpenClawErrorKind; readonly message: string; readonly httpStatus?: number };

async function tryExecuteRequest(
  config: OpenClawClientConfig,
  request: OpenClawRequest,
): Promise<RequestAttemptResult> {
  const url = `${config.endpoint}/v1/chat/completions`;
  const headers = buildHeaders(config, request.agentId, request.traceId);
  const messages = buildMessages(request);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: `openclaw:${request.agentId}`,
        messages,
        stream: false,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { ok: false, kind: classifyNetworkError(err), message: err.message };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable body)");
    const kind = classifyHttpError(response.status);
    return { ok: false, kind, message: `OpenClaw API ${String(response.status)}: ${body}`, httpStatus: response.status };
  }

  let data: ChatCompletionResponse;
  try {
    data = (await response.json()) as ChatCompletionResponse;
  } catch {
    return { ok: false, kind: "request", message: "Failed to parse OpenClaw JSON response" };
  }

  const text = data.choices[0]?.message?.content;
  if (!text) {
    return { ok: false, kind: "request", message: "OpenClaw returned empty content" };
  }

  const usage = mapUsage(data.usage);
  logger.info({ chars: text.length, usage, traceId: request.traceId }, "OpenClaw response received");

  return { ok: true, response: { status: "completed", text, usage } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callOpenClaw(request: OpenClawRequest): Promise<OpenClawResult> {
  const config = loadConfig();
  let lastMessage = "";
  let lastHttpStatus: number | undefined;
  let lastKind: OpenClawErrorKind = "infra";

  for (let attempt = 1; attempt <= MAX_INFRA_RETRIES; attempt++) {
    logger.info({ attempt, agent: request.agentId, traceId: request.traceId }, "Calling OpenClaw");

    const result = await tryExecuteRequest(config, request);

    if (result.ok) {
      return { ok: true, response: result.response };
    }

    lastMessage = result.message;
    lastHttpStatus = result.httpStatus;
    lastKind = result.kind;

    if (result.kind === "auth") {
      logger.error(
        { httpStatus: result.httpStatus, traceId: request.traceId },
        "OpenClaw authentication failed — aborting (no retry)",
      );
      return {
        ok: false,
        error: { kind: "auth", message: result.message, httpStatus: result.httpStatus, attempts: attempt },
      };
    }

    if (result.kind === "request") {
      logger.warn(
        { attempt, message: result.message, traceId: request.traceId },
        "OpenClaw request error — aborting (no retry)",
      );
      return {
        ok: false,
        error: { kind: "request", message: result.message, httpStatus: result.httpStatus, attempts: attempt },
      };
    }

    logger.warn(
      { attempt, message: result.message, traceId: request.traceId },
      "OpenClaw infra error — will retry",
    );

    if (attempt < MAX_INFRA_RETRIES) {
      await sleep(BACKOFF_MS[attempt - 1]);
    }
  }

  logger.error(
    { attempts: MAX_INFRA_RETRIES, lastMessage, traceId: request.traceId },
    "OpenClaw infra failed after all retries",
  );

  return {
    ok: false,
    error: {
      kind: lastKind,
      message: `OpenClaw infra failed after ${String(MAX_INFRA_RETRIES)} attempts: ${lastMessage}`,
      httpStatus: lastHttpStatus,
      attempts: MAX_INFRA_RETRIES,
    },
  };
}

export async function checkOpenClawHealth(): Promise<boolean> {
  try {
    const config = loadConfig();
    const response = await fetch(`${config.endpoint}/health`, {
      signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
