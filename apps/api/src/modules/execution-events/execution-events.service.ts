import { Inject, Injectable } from "@nestjs/common";
import { DATABASE_TOKEN, type DatabaseConnection } from "../../database/database.provider";

export interface ExecutionEventRow {
  readonly id: number;
  readonly trace_id: string;
  readonly agent: string;
  readonly event_type: string;
  readonly phase: string | null;
  readonly message: string;
  readonly metadata: string | null;
  readonly level: string;
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

interface EventsQuery {
  readonly traceId?: string;
  readonly agent?: string;
  readonly level?: string;
  readonly limit?: number;
  readonly offset?: number;
}

@Injectable()
export class ExecutionEventsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: DatabaseConnection) {}

  getEventsSince(lastId: number, traceId?: string, limit: number = 100): readonly ExecutionEventRow[] {
    if (traceId) {
      return this.db.prepare(
        `SELECT id, trace_id, agent, event_type, phase, message, metadata, level, created_at
         FROM execution_events
         WHERE id > ? AND trace_id = ?
         ORDER BY id ASC
         LIMIT ?`,
      ).all(lastId, traceId, limit) as ExecutionEventRow[];
    }

    return this.db.prepare(
      `SELECT id, trace_id, agent, event_type, phase, message, metadata, level, created_at
       FROM execution_events
       WHERE id > ?
       ORDER BY id ASC
       LIMIT ?`,
    ).all(lastId, limit) as ExecutionEventRow[];
  }

  getEvents(query: EventsQuery): readonly ExecutionEventRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.traceId) {
      conditions.push("trace_id = ?");
      params.push(query.traceId);
    }
    if (query.agent) {
      conditions.push("agent = ?");
      params.push(query.agent);
    }
    if (query.level) {
      conditions.push("level = ?");
      params.push(query.level);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    return this.db.prepare(
      `SELECT id, trace_id, agent, event_type, phase, message, metadata, level, created_at
       FROM execution_events
       ${where}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as ExecutionEventRow[];
  }

  getRecentTraces(limit: number = 20): readonly TraceSummaryRow[] {
    return this.db.prepare(
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

  getEventsByTraceId(traceId: string): readonly ExecutionEventRow[] {
    return this.db.prepare(
      `SELECT id, trace_id, agent, event_type, phase, message, metadata, level, created_at
       FROM execution_events
       WHERE trace_id = ?
       ORDER BY id ASC`,
    ).all(traceId) as ExecutionEventRow[];
  }

  tableExists(): boolean {
    const row = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='execution_events'",
    ).get() as { name: string } | undefined;
    return Boolean(row);
  }
}
