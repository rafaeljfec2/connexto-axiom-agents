import { logger } from "../config/logger.js";

type LLMProvider = "claude" | "openai";

export interface LLMRequest {
  readonly system: string;
  readonly userMessage: string;
  readonly maxOutputTokens?: number;
}

export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface LLMResponse {
  readonly text: string;
  readonly usage: LLMUsage;
}

export interface LLMClientConfig {
  readonly provider: LLMProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

export function createLLMConfig(): LLMClientConfig {
  const provider = process.env.LLM_PROVIDER;
  if (provider !== "claude" && provider !== "openai") {
    throw new Error(`LLM_PROVIDER must be "claude" or "openai", got: "${provider ?? "undefined"}"`);
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_API_KEY is required");
  }

  return {
    provider,
    apiKey,
    model: process.env.LLM_MODEL ?? (provider === "claude" ? "claude-sonnet-4-20250514" : "gpt-4o"),
    timeoutMs: 30_000,
    maxRetries: 2,
  };
}

export async function callLLM(config: LLMClientConfig, request: LLMRequest): Promise<LLMResponse> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      logger.info({ attempt, provider: config.provider, model: config.model }, "Calling LLM");

      const result =
        config.provider === "claude"
          ? await callClaude(config, request)
          : await callOpenAI(config, request);

      logger.info(
        {
          chars: result.text.length,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
        "LLM response received",
      );
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn({ attempt, error: lastError.message }, "LLM call failed");
    }
  }

  throw new Error(`LLM failed after ${config.maxRetries} attempts: ${lastError?.message}`);
}

interface ClaudeResponse {
  readonly content: ReadonlyArray<{ readonly text: string }>;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
}

async function callClaude(config: LLMClientConfig, request: LLMRequest): Promise<LLMResponse> {
  const maxTokens = request.maxOutputTokens ?? 1024;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.userMessage }],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API ${response.status}: ${body}`);
  }

  const data = (await response.json()) as ClaudeResponse;
  const text = data.content[0]?.text;
  if (!text) {
    throw new Error("Claude returned empty content");
  }

  return {
    text,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

interface OpenAIMessage {
  readonly role: string;
  readonly content: string | null;
  readonly refusal?: string | null;
}

interface OpenAIResponse {
  readonly choices: ReadonlyArray<{
    readonly message: OpenAIMessage;
    readonly finish_reason: string;
  }>;
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

const MODELS_REQUIRING_COMPLETION_TOKENS: ReadonlySet<string> = new Set([
  "gpt-5",
  "gpt-5.2",
  "gpt-5.3",
  "gpt-5.3-codex",
  "o1",
  "o1-mini",
  "o1-preview",
  "o3",
  "o3-mini",
  "o4-mini",
]);

function requiresMaxCompletionTokens(model: string): boolean {
  if (MODELS_REQUIRING_COMPLETION_TOKENS.has(model)) return true;
  return model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4") || model.startsWith("gpt-5");
}

function buildTokenLimit(model: string, maxTokens: number): Record<string, number> {
  if (requiresMaxCompletionTokens(model)) {
    return { max_completion_tokens: maxTokens };
  }
  return { max_tokens: maxTokens };
}

function usesDeveloperRole(model: string): boolean {
  return requiresMaxCompletionTokens(model);
}

function buildOpenAIMessages(
  model: string,
  system: string,
  userMessage: string,
): ReadonlyArray<{ readonly role: string; readonly content: string }> {
  const systemRole = usesDeveloperRole(model) ? "developer" : "system";
  return [
    { role: systemRole, content: system },
    { role: "user", content: userMessage },
  ];
}

async function callOpenAI(config: LLMClientConfig, request: LLMRequest): Promise<LLMResponse> {
  const maxTokens = request.maxOutputTokens ?? 1024;
  const messages = buildOpenAIMessages(config.model, request.system, request.userMessage);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      ...buildTokenLimit(config.model, maxTokens),
      messages,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${body}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  const choice = data.choices[0];

  if (!choice) {
    throw new Error("OpenAI returned no choices");
  }

  if (choice.message.refusal) {
    throw new Error(`OpenAI refused: ${choice.message.refusal}`);
  }

  const text = choice.message.content;
  if (!text) {
    logger.warn(
      { finishReason: choice.finish_reason, model: config.model },
      "OpenAI returned null content",
    );
    throw new Error(
      `OpenAI returned empty content (finish_reason: ${choice.finish_reason})`,
    );
  }

  return {
    text,
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    },
  };
}
