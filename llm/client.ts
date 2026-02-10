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

interface OpenAIResponse {
  readonly choices: ReadonlyArray<{ readonly message: { readonly content: string } }>;
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

async function callOpenAI(config: LLMClientConfig, request: LLMRequest): Promise<LLMResponse> {
  const maxTokens = request.maxOutputTokens ?? 1024;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.userMessage },
      ],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${body}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  const text = data.choices[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned empty content");
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
