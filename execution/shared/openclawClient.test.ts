import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const VALID_ENDPOINT = "http://127.0.0.1:3100";

describe("openclawClient", () => {
  let callOpenClaw: typeof import("./openclawClient.js").callOpenClaw;
  let checkOpenClawHealth: typeof import("./openclawClient.js").checkOpenClawHealth;

  beforeEach(async () => {
    vi.stubEnv("OPENCLAW_ENDPOINT", VALID_ENDPOINT);
    vi.stubEnv("OPENCLAW_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn());

    const mod = await import("./openclawClient.js");
    callOpenClaw = mod.callOpenClaw;
    checkOpenClawHealth = mod.checkOpenClawHealth;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("error classification", () => {
    it("should classify HTTP 401 as auth error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("auth");
        expect(result.error.httpStatus).toBe(401);
        expect(result.error.attempts).toBe(1);
      }
    });

    it("should classify HTTP 403 as auth error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("auth");
      }
    });

    it("should classify HTTP 500 as infra error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("infra");
        expect(result.error.attempts).toBe(3);
      }
    });

    it("should classify HTTP 400 as request error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => "Bad Request",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("request");
        expect(result.error.attempts).toBe(1);
      }
    });

    it("should classify network error as infra error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("infra");
        expect(result.error.attempts).toBe(3);
      }
    });

    it("should classify timeout as infra error", async () => {
      const timeoutError = new Error("timeout");
      timeoutError.name = "AbortError";
      const mockFetch = vi.fn().mockRejectedValue(timeoutError);
      vi.stubGlobal("fetch", mockFetch);

      const result = await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("infra");
      }
    });

    it("should classify empty content as request error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("request");
        expect(result.error.message).toContain("empty content");
      }
    });

    it("should return success with valid response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { role: "assistant", content: "Hello world" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response.text).toBe("Hello world");
        expect(result.response.usage?.totalTokens).toBe(15);
      }
    });
  });

  describe("retry with exponential backoff", () => {
    it("should retry infra errors up to 3 times", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => "Bad Gateway",
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("infra");
        expect(result.error.attempts).toBe(3);
      }
    });

    it("should not retry auth errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });
      vi.stubGlobal("fetch", mockFetch);

      await callOpenClaw({ agentId: "forge", prompt: "test" });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry request errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => "Unprocessable Entity",
      });
      vi.stubGlobal("fetch", mockFetch);

      await callOpenClaw({ agentId: "forge", prompt: "test" });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should succeed on second attempt after infra failure", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => "Service Unavailable",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: { role: "assistant", content: "Success after retry" },
                finish_reason: "stop",
              },
            ],
          }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const result = await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response.text).toBe("Success after retry");
      }
    });
  });

  describe("healthcheck", () => {
    it("should return true when endpoint is healthy", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      const healthy = await checkOpenClawHealth();

      expect(healthy).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${VALID_ENDPOINT}/health`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("should return false when endpoint is unreachable", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", mockFetch);

      const healthy = await checkOpenClawHealth();

      expect(healthy).toBe(false);
    });

    it("should return false when endpoint returns error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      vi.stubGlobal("fetch", mockFetch);

      const healthy = await checkOpenClawHealth();

      expect(healthy).toBe(false);
    });
  });

  describe("traceId propagation", () => {
    it("should include x-trace-id header when traceId is provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { role: "assistant", content: "response" },
              finish_reason: "stop",
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await callOpenClaw({
        agentId: "forge",
        prompt: "test",
        traceId: "abc12345",
      });

      const [, fetchOptions] = mockFetch.mock.calls[0];
      const headers = fetchOptions.headers as Record<string, string>;
      expect(headers["x-trace-id"]).toBe("abc12345");
    });

    it("should not include x-trace-id header when traceId is not provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { role: "assistant", content: "response" },
              finish_reason: "stop",
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await callOpenClaw({
        agentId: "forge",
        prompt: "test",
      });

      const [, fetchOptions] = mockFetch.mock.calls[0];
      const headers = fetchOptions.headers as Record<string, string>;
      expect(headers["x-trace-id"]).toBeUndefined();
    });
  });
});
