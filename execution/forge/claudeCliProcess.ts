import { spawn } from "node:child_process";
import path from "node:path";
import { logger } from "../../config/logger.js";
import type { ExecutionEventEmitter } from "../shared/executionEventEmitter.js";
import type {
  ClaudeCliExecutorConfig,
  ClaudeStreamEvent,
  SpawnClaudeCliOptions,
} from "./claudeCliTypes.js";
import { INACTIVITY_TIMEOUT_MS } from "./claudeCliTypes.js";
import { parseStreamLine } from "./claudeCliOutputParser.js";

const IDE_ENV_PREFIXES = ["VSCODE_", "CURSOR_", "ELECTRON_"];
const TOOL_EVENT_THROTTLE_MS = 2_000;

function buildCleanEnv(workspacePath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    const shouldStrip = IDE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (!shouldStrip) {
      env[key] = value;
    }
  }

  env.CLAUDE_CODE_ENTRYPOINT = "cli";
  env.GIT_CEILING_DIRECTORIES = path.dirname(workspacePath);

  return env;
}

function summarizeToolInput(input?: Record<string, unknown>): string {
  if (!input) return "";
  const filePath = input.file_path ?? input.path ?? input.command ?? input.pattern;
  if (typeof filePath === "string") return filePath.slice(0, 120);
  return JSON.stringify(input).slice(0, 120);
}

function createStreamProgressHandler(emitter?: ExecutionEventEmitter) {
  let lastToolEmitTs = 0;
  let turnCounter = 0;

  return (event: ClaudeStreamEvent): void => {
    if (!emitter) return;

    if (event.type === "assistant" && event.message?.content) {
      turnCounter++;
      for (const block of event.message.content) {
        if (block.type === "tool_use" && block.name) {
          const now = Date.now();
          if (now - lastToolEmitTs < TOOL_EVENT_THROTTLE_MS) continue;
          lastToolEmitTs = now;

          emitter.info("forge", "forge:cli_tool_use", `${block.name}: ${summarizeToolInput(block.input)}`, {
            phase: "cli_execution",
            metadata: { tool: block.name, input: summarizeToolInput(block.input), turn: turnCounter },
          });
        }
      }
    }

    if (event.type === "result") {
      const costUsd = event.total_cost_usd ?? 0;
      const turns = event.num_turns ?? turnCounter;
      emitter.info("forge", "forge:cli_progress", `Turn ${turns} completed (cost: $${costUsd.toFixed(4)})`, {
        phase: "cli_execution",
        metadata: { turns, costUsd, durationMs: event.duration_ms },
      });
    }
  };
}

export async function spawnClaudeCli(
  config: ClaudeCliExecutorConfig,
  workspacePath: string,
  prompt: string,
  options?: SpawnClaudeCliOptions,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const effectiveModel = options?.model ?? config.model;

  const args: string[] = [
    "-p",
    prompt,
    "--output-format", "stream-json",
    "--model", effectiveModel,
    "--max-turns", String(config.maxTurns),
    "--max-budget-usd", String(config.maxBudgetUsd),
    "--allowedTools", "Edit,Write,Bash,Read,Glob,Grep",
    "--dangerously-skip-permissions",
  ];

  if (options?.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  }

  logger.info(
    {
      cli: config.cliPath,
      model: effectiveModel,
      maxTurns: config.maxTurns,
      timeoutMs: config.timeoutMs,
      inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
      resumeSession: options?.resumeSessionId ?? null,
      workspacePath,
    },
    "Spawning Claude CLI process",
  );

  const onStreamEvent = createStreamProgressHandler(options?.emitter);

  return new Promise((resolve) => {
    const cleanEnv = buildCleanEnv(workspacePath);
    const singleQuoteEscape = String.raw`'\''`;
    const escapedArgs = args.map((a) => "'" + a.replaceAll("'", singleQuoteEscape) + "'").join(" ");
    const shellCmd = `for fd in /proc/$$/fd/*; do fd_num=$(basename "$fd"); [ "$fd_num" -gt 2 ] 2>/dev/null && eval "exec $fd_num>&-" 2>/dev/null; done; exec ${config.cliPath} ${escapedArgs}`;

    const child = spawn("/bin/bash", ["-c", shellCmd], {
      cwd: workspacePath,
      env: cleanEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let lineBuffer = "";
    let lastActivityTs = Date.now();
    let settled = false;

    const processNdjsonLines = (chunk: string) => {
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseStreamLine(line);
        if (event) {
          try { onStreamEvent(event); } catch { /* defensive */ }
        }
      }
    };

    const finish = (exitCode: number, signal?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(globalTimer);
      clearInterval(inactivityChecker);

      if (lineBuffer.trim()) {
        const event = parseStreamLine(lineBuffer);
        if (event) {
          try { onStreamEvent(event); } catch { /* defensive */ }
        }
      }

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      if (signal === "SIGTERM") {
        logger.warn({ timeoutMs: config.timeoutMs }, "Claude CLI process timed out (global)");
      }

      resolve({ stdout, stderr, exitCode });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      lastActivityTs = Date.now();
      processNdjsonLines(chunk.toString("utf-8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      lastActivityTs = Date.now();
    });

    child.on("close", (code, signal) => {
      finish(code ?? 1, signal ?? undefined);
    });

    child.on("error", (err) => {
      logger.error({ error: err.message }, "Claude CLI process error");
      finish(1);
    });

    const globalTimer = setTimeout(() => {
      if (!settled) {
        logger.warn({ timeoutMs: config.timeoutMs }, "Claude CLI global timeout — sending SIGTERM");
        child.kill("SIGTERM");
      }
    }, config.timeoutMs);

    const inactivityChecker = setInterval(() => {
      if (settled) return;
      const idle = Date.now() - lastActivityTs;
      if (idle >= INACTIVITY_TIMEOUT_MS) {
        const stdoutSize = stdoutChunks.reduce((acc, b) => acc + b.length, 0);
        const stderrSize = stderrChunks.reduce((acc, b) => acc + b.length, 0);
        logger.warn(
          { idleMs: idle, stdoutBytes: stdoutSize, stderrBytes: stderrSize },
          "Claude CLI inactivity timeout — process produced no output, killing",
        );
        child.kill("SIGTERM");
      }
    }, 10_000);
  });
}
