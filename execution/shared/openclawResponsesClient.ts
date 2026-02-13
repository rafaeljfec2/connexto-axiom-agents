import { logger } from "../../config/logger.js";
import type { TokenUsageInfo } from "./openclawClient.js";

export interface ToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface ResponseItem {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly tool_call_id?: string;
}

export interface OpenClawToolRequest {
  readonly agentId: string;
  readonly input: readonly ResponseItem[];
  readonly instructions: string;
  readonly tools: readonly ToolDefinition[];
  readonly maxOutputTokens: number;
  readonly traceId?: string;
}

export interface ToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
}

export interface OpenClawToolResponse {
  readonly status: "completed" | "requires_action" | "failed";
  readonly text?: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly usage?: TokenUsageInfo;
  readonly rawOutput?: readonly Record<string, unknown>[];
}

interface ResponsesApiOutput {
  readonly id?: string;
  readonly type?: string;
  readonly name?: string;
  readonly call_id?: string;
  readonly arguments?: string;
  readonly text?: string;
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly role?: string;
}

interface ResponsesApiResult {
  readonly id: string;
  readonly status: string;
  readonly output: readonly ResponsesApiOutput[];
  readonly usage?: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly total_tokens: number;
  };
}

interface ResponsesClientConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
}

const MAX_RETRIES = 3;
const BACKOFF_MS: readonly number[] = [300, 900, 2000];

function loadConfig(): ResponsesClientConfig {
  const endpoint = process.env.OPENCLAW_ENDPOINT;
  if (!endpoint) {
    throw new Error("OPENCLAW_ENDPOINT is required");
  }

  return {
    endpoint,
    apiKey: process.env.OPENCLAW_API_KEY ?? "",
    timeoutMs: 180_000,
  };
}

function buildHeaders(
  config: ResponsesClientConfig,
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

function buildRequestBody(
  request: OpenClawToolRequest,
): Record<string, unknown> {
  const messages = request.input.map((item) => {
    if (item.tool_call_id) {
      return {
        role: item.role,
        content: item.content,
        tool_call_id: item.tool_call_id,
      };
    }
    return { role: item.role, content: item.content };
  });

  return {
    model: `openclaw:${request.agentId}`,
    input: messages,
    instructions: request.instructions,
    tools: request.tools.map((t) => ({
      type: t.type,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    })),
    tool_choice: "auto",
    max_output_tokens: request.maxOutputTokens,
  };
}

function mapUsage(raw: ResponsesApiResult["usage"]): TokenUsageInfo | undefined {
  if (!raw) return undefined;

  return {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    totalTokens: raw.total_tokens,
  };
}

function extractToolCalls(output: readonly ResponsesApiOutput[]): readonly ToolCall[] {
  return output
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      callId: item.call_id ?? "",
      name: item.name ?? "",
      arguments: item.arguments ?? "{}",
    }));
}

function extractTextContent(output: readonly ResponsesApiOutput[]): string | undefined {
  for (const item of output) {
    if (item.type === "message" && item.content) {
      for (const part of item.content) {
        if (part.type === "output_text" && part.text) {
          return part.text;
        }
      }
    }

    if (item.type === "text" && item.text) {
      return item.text;
    }
  }

  return undefined;
}

function parseApiResponse(data: ResponsesApiResult): OpenClawToolResponse {
  const toolCalls = extractToolCalls(data.output);
  const text = extractTextContent(data.output);
  const usage = mapUsage(data.usage);

  if (toolCalls.length > 0) {
    return {
      status: "requires_action",
      toolCalls,
      usage,
      rawOutput: data.output as readonly Record<string, unknown>[],
    };
  }

  if (text) {
    return {
      status: "completed",
      text,
      usage,
      rawOutput: data.output as readonly Record<string, unknown>[],
    };
  }

  if (data.status === "failed") {
    return { status: "failed", usage };
  }

  return {
    status: "completed",
    text: "",
    usage,
    rawOutput: data.output as readonly Record<string, unknown>[],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(status: number): boolean {
  return status >= 500 || status === 429;
}

type AttemptResult =
  | { readonly retry: true }
  | { readonly retry: false; readonly response: OpenClawToolResponse };

async function trySingleAttempt(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  config: ResponsesClientConfig,
  attempt: number,
  traceId?: string,
): Promise<AttemptResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ attempt, error: msg, traceId }, "OpenClaw /v1/responses network error");

    if (attempt < MAX_RETRIES) {
      await sleep(BACKOFF_MS[attempt - 1]);
      return { retry: true };
    }
    return { retry: false, response: { status: "failed", text: `Network error after ${String(MAX_RETRIES)} attempts: ${msg}` } };
  }

  if (!response.ok) {
    return handleHttpError(response, attempt, traceId);
  }

  return parseSuccessResponse(response, traceId);
}

async function handleHttpError(
  response: Response,
  attempt: number,
  traceId?: string,
): Promise<AttemptResult> {
  const errorBody = await response.text().catch(() => "(unreadable)");
  logger.warn(
    { attempt, httpStatus: response.status, body: errorBody.slice(0, 300), traceId },
    "OpenClaw /v1/responses HTTP error",
  );

  if (isRetryableError(response.status) && attempt < MAX_RETRIES) {
    await sleep(BACKOFF_MS[attempt - 1]);
    return { retry: true };
  }

  return {
    retry: false,
    response: { status: "failed", text: `OpenClaw API ${String(response.status)}: ${errorBody.slice(0, 500)}` },
  };
}

async function parseSuccessResponse(
  response: Response,
  traceId?: string,
): Promise<AttemptResult> {
  let data: ResponsesApiResult;
  try {
    data = (await response.json()) as ResponsesApiResult;
  } catch {
    return { retry: false, response: { status: "failed", text: "Failed to parse OpenClaw /v1/responses JSON" } };
  }

  const result = parseApiResponse(data);

  logger.info(
    {
      status: result.status,
      toolCallCount: result.toolCalls?.length ?? 0,
      hasText: Boolean(result.text),
      usage: result.usage,
      traceId,
    },
    "OpenClaw /v1/responses completed",
  );

  return { retry: false, response: result };
}

export async function callOpenClawWithTools(
  request: OpenClawToolRequest,
): Promise<OpenClawToolResponse> {
  const config = loadConfig();
  const url = `${config.endpoint}/v1/responses`;
  const headers = buildHeaders(config, request.agentId, request.traceId);
  const body = buildRequestBody(request);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info(
      { attempt, agent: request.agentId, traceId: request.traceId, toolCount: request.tools.length },
      "Calling OpenClaw /v1/responses",
    );

    const result = await trySingleAttempt(url, headers, body, config, attempt, request.traceId);

    if (result.retry) continue;
    return result.response;
  }

  return { status: "failed", text: `Failed after ${String(MAX_RETRIES)} attempts` };
}
