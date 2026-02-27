import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import { emitExecutionEvent } from "../../state/executionEvents.js";
import type { EventLevel } from "../../state/executionEvents.js";

export interface EmitOptions {
  readonly phase?: string;
  readonly metadata?: Record<string, unknown>;
  readonly level?: EventLevel;
}

export class ExecutionEventEmitter {
  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly traceId: string,
  ) {}

  emit(agent: string, eventType: string, message: string, opts?: EmitOptions): void {
    try {
      emitExecutionEvent(this.db, {
        traceId: this.traceId,
        agent,
        eventType,
        message,
        phase: opts?.phase,
        metadata: opts?.metadata,
        level: opts?.level,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { error: msg, agent, eventType, traceId: this.traceId },
        "Failed to emit execution event",
      );
    }
  }

  info(agent: string, eventType: string, message: string, opts?: Omit<EmitOptions, "level">): void {
    this.emit(agent, eventType, message, { ...opts, level: "info" });
  }

  warn(agent: string, eventType: string, message: string, opts?: Omit<EmitOptions, "level">): void {
    this.emit(agent, eventType, message, { ...opts, level: "warn" });
  }

  error(agent: string, eventType: string, message: string, opts?: Omit<EmitOptions, "level">): void {
    this.emit(agent, eventType, message, { ...opts, level: "error" });
  }

  getTraceId(): string {
    return this.traceId;
  }
}

export function createEventEmitter(
  db: BetterSqlite3.Database,
  traceId: string,
): ExecutionEventEmitter {
  return new ExecutionEventEmitter(db, traceId);
}
