import type BetterSqlite3 from "better-sqlite3";

export type EventLevel = "info" | "warn" | "error" | "debug";

export interface ExecutionEventInput {
  readonly traceId: string;
  readonly agent: string;
  readonly eventType: string;
  readonly message: string;
  readonly phase?: string;
  readonly metadata?: Record<string, unknown>;
  readonly level?: EventLevel;
}

export interface ExecutionEventRow {
  readonly id: number;
  readonly trace_id: string;
  readonly agent: string;
  readonly event_type: string;
  readonly phase: string | null;
  readonly message: string;
  readonly metadata: string | null;
  readonly level: EventLevel;
  readonly created_at: string;
}

export interface TraceSummaryRow {
  readonly trace_id: string;
  readonly agent_count: number;
  readonly event_count: number;
  readonly first_event_at: string;
  readonly last_event_at: string;
  readonly has_errors: number;
  readonly agents: string;
}

export function emitExecutionEvent(
  db: BetterSqlite3.Database,
  event: ExecutionEventInput,
): number {
  const metadataJson = event.metadata ? JSON.stringify(event.metadata) : null;

  const result = db.prepare(
    `INSERT INTO execution_events (trace_id, agent, event_type, phase, message, metadata, level)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.traceId,
    event.agent,
    event.eventType,
    event.phase ?? null,
    event.message,
    metadataJson,
    event.level ?? "info",
  );

  return Number(result.lastInsertRowid);
}

export function getEventsSince(
  db: BetterSqlite3.Database,
  lastId: number,
  options?: { readonly traceId?: string; readonly limit?: number },
): readonly ExecutionEventRow[] {
  const limit = options?.limit ?? 100;

  if (options?.traceId) {
    return db.prepare(
      `SELECT id, trace_id, agent, event_type, phase, message, metadata, level, created_at
       FROM execution_events
       WHERE id > ? AND trace_id = ?
       ORDER BY id ASC
       LIMIT ?`,
    ).all(lastId, options.traceId, limit) as ExecutionEventRow[];
  }

  return db.prepare(
    `SELECT id, trace_id, agent, event_type, phase, message, metadata, level, created_at
     FROM execution_events
     WHERE id > ?
     ORDER BY id ASC
     LIMIT ?`,
  ).all(lastId, limit) as ExecutionEventRow[];
}

export function getEventsByTraceId(
  db: BetterSqlite3.Database,
  traceId: string,
): readonly ExecutionEventRow[] {
  return db.prepare(
    `SELECT id, trace_id, agent, event_type, phase, message, metadata, level, created_at
     FROM execution_events
     WHERE trace_id = ?
     ORDER BY id ASC`,
  ).all(traceId) as ExecutionEventRow[];
}

export function getRecentTraces(
  db: BetterSqlite3.Database,
  limit: number = 20,
): readonly TraceSummaryRow[] {
  return db.prepare(
    `SELECT
       trace_id,
       COUNT(DISTINCT agent) AS agent_count,
       COUNT(*) AS event_count,
       MIN(created_at) AS first_event_at,
       MAX(created_at) AS last_event_at,
       MAX(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS has_errors,
       GROUP_CONCAT(DISTINCT agent) AS agents
     FROM execution_events
     GROUP BY trace_id
     ORDER BY MAX(id) DESC
     LIMIT ?`,
  ).all(limit) as TraceSummaryRow[];
}

export function cleanupOldEvents(
  db: BetterSqlite3.Database,
  daysToKeep: number = 30,
): number {
  const result = db.prepare(
    `DELETE FROM execution_events
     WHERE created_at < datetime('now', ? || ' days')`,
  ).run(`-${daysToKeep}`);

  return result.changes;
}
