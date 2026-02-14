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
  readonly tool_calls?: readonly ChatToolCall[];
}

interface ChatToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
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
  readonly rawAssistantMessage?: ChatCompletionMessage;
}

interface ChatCompletionMessage {
  readonly role: string;
  readonly content: string | null;
  readonly tool_calls?: readonly ChatToolCall[];
}

interface ChatCompletionResponse {
  readonly choices: ReadonlyArray<{
    readonly message: ChatCompletionMessage;
    readonly finish_reason: string;
  }>;
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

interface ClientConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
}

const MAX_RETRIES = 3;
const BACKOFF_MS: readonly number[] = [300, 900, 2000];

function loadConfig(): ClientConfig {
  const endpoint = process.env.OPENCLAW_ENDPOINT;
  if (!endpoint) {
    throw new Error("OPENCLAW_ENDPOINT is required");
  }

  return {
    endpoint,
    apiKey: process.env.OPENCLAW_API_KEY ?? "",
    timeoutMs: 600_000,
  };
}

function buildHeaders(
  config: ClientConfig,
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

function buildChatMessages(
  request: OpenClawToolRequest,
): readonly Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];

  messages.push({ role: "system", content: request.instructions });

  for (const item of request.input) {
    if (item.role === "tool" && item.tool_call_id) {
      messages.push({
        role: "tool",
        content: item.content,
        tool_call_id: item.tool_call_id,
      });
    } else if (item.role === "assistant" && item.tool_calls) {
      messages.push({
        role: "assistant",
        content: item.content || null,
        tool_calls: item.tool_calls,
      });
    } else {
      messages.push({ role: item.role, content: item.content });
    }
  }

  return messages;
}

function buildRequestBody(request: OpenClawToolRequest): Record<string, unknown> {
  return {
    model: `openclaw:${request.agentId}`,
    messages: buildChatMessages(request),
    tools: request.tools,
    tool_choice: "auto",
    max_tokens: request.maxOutputTokens,
    stream: false,
  };
}

function mapUsage(raw: ChatCompletionResponse["usage"]): TokenUsageInfo | undefined {
  if (!raw) return undefined;

  return {
    inputTokens: raw.prompt_tokens,
    outputTokens: raw.completion_tokens,
    totalTokens: raw.prompt_tokens + raw.completion_tokens,
  };
}

function parseChatResponse(data: ChatCompletionResponse): OpenClawToolResponse {
  const choice = data.choices[0];
  if (!choice) {
    return { status: "failed", text: "No choices in response" };
  }

  const message = choice.message;
  const usage = mapUsage(data.usage);

  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolCalls: readonly ToolCall[] = message.tool_calls.map((tc) => ({
      callId: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      status: "requires_action",
      text: message.content ?? undefined,
      toolCalls,
      usage,
      rawAssistantMessage: message,
    };
  }

  return {
    status: "completed",
    text: message.content ?? "",
    usage,
    rawAssistantMessage: message,
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
  config: ClientConfig,
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
    logger.warn({ attempt, error: msg, traceId }, "OpenClaw tool call network error");

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
    "OpenClaw tool call HTTP error",
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
  let data: ChatCompletionResponse;
  try {
    data = (await response.json()) as ChatCompletionResponse;
  } catch {
    return { retry: false, response: { status: "failed", text: "Failed to parse OpenClaw JSON response" } };
  }

  const result = parseChatResponse(data);

  logger.info(
    {
      status: result.status,
      toolCallCount: result.toolCalls?.length ?? 0,
      hasText: Boolean(result.text),
      usage: result.usage,
      traceId,
    },
    "OpenClaw tool call completed",
  );

  return { retry: false, response: result };
}

export async function callOpenClawWithTools(
  request: OpenClawToolRequest,
): Promise<OpenClawToolResponse> {
  const config = loadConfig();
  const url = `${config.endpoint}/v1/chat/completions`;
  const headers = buildHeaders(config, request.agentId, request.traceId);
  const body = buildRequestBody(request);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info(
      { attempt, agent: request.agentId, traceId: request.traceId, toolCount: request.tools.length },
      "Calling OpenClaw with tools",
    );

    const result = await trySingleAttempt(url, headers, body, config, attempt, request.traceId);

    if (result.retry) continue;
    return result.response;
  }

  return { status: "failed", text: `Failed after ${String(MAX_RETRIES)} attempts` };
}
