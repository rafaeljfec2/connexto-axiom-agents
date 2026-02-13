import { Inject, Injectable } from "@nestjs/common";
import { DATABASE_TOKEN, DatabaseConnection } from "../../database/database.provider";

interface OutcomeFilters {
  readonly agent?: string;
  readonly status?: string;
  readonly traceId?: string;
  readonly limit: number;
  readonly offset: number;
}

interface CycleFilters {
  readonly agent?: string;
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface CycleOutcome {
  readonly id: string;
  readonly agent_id: string;
  readonly task: string;
  readonly status: string;
  readonly error: string | null;
  readonly execution_time_ms: number | null;
  readonly tokens_used: number | null;
  readonly created_at: string;
}

interface CycleRow {
  readonly trace_id: string;
  readonly started_at: string;
  readonly ended_at: string;
  readonly outcome_count: number;
  readonly success_count: number;
  readonly failed_count: number;
  readonly total_tokens: number;
  readonly total_duration_ms: number;
}

export interface OutcomeCycle {
  readonly trace_id: string;
  readonly started_at: string;
  readonly ended_at: string;
  readonly duration_ms: number;
  readonly total_tokens: number;
  readonly success_count: number;
  readonly failed_count: number;
  readonly outcome_count: number;
  readonly outcomes: ReadonlyArray<CycleOutcome>;
}

@Injectable()
export class OutcomesService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: DatabaseConnection) {}

  findAll(filters: OutcomeFilters) {
    let query = "SELECT * FROM outcomes WHERE 1=1";
    let countQuery = "SELECT COUNT(*) as total FROM outcomes WHERE 1=1";
    const params: Record<string, string | number> = {};

    if (filters.agent) {
      const clause = " AND agent_id = @agent";
      query += clause;
      countQuery += clause;
      params.agent = filters.agent;
    }

    if (filters.status) {
      const clause = " AND status = @status";
      query += clause;
      countQuery += clause;
      params.status = filters.status;
    }

    if (filters.traceId) {
      const clause = " AND trace_id = @traceId";
      query += clause;
      countQuery += clause;
      params.traceId = filters.traceId;
    }

    const { total } = this.db.prepare(countQuery).get(params) as { total: number };

    query += " ORDER BY created_at DESC LIMIT @limit OFFSET @offset";
    params.limit = filters.limit;
    params.offset = filters.offset;

    const data = this.db.prepare(query).all(params);

    return { data, total, limit: filters.limit, offset: filters.offset };
  }

  findCycles(filters: CycleFilters) {
    const hasAgentFilter = !!filters.agent;
    const hasStatusFilter = !!filters.status;

    let traceQuery = `
      SELECT
        trace_id,
        MIN(created_at) as started_at,
        MAX(created_at) as ended_at,
        COUNT(*) as outcome_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as failed_count,
        COALESCE(SUM(tokens_used), 0) as total_tokens,
        COALESCE(SUM(execution_time_ms), 0) as total_duration_ms
      FROM outcomes
      WHERE trace_id IS NOT NULL
    `;

    const params: Record<string, string | number> = {};

    if (hasAgentFilter) {
      traceQuery += ` AND trace_id IN (SELECT DISTINCT trace_id FROM outcomes WHERE agent_id = @agent AND trace_id IS NOT NULL)`;
      params.agent = filters.agent!;
    }

    if (hasStatusFilter) {
      traceQuery += ` AND trace_id IN (SELECT DISTINCT trace_id FROM outcomes WHERE status = @status AND trace_id IS NOT NULL)`;
      params.status = filters.status!;
    }

    traceQuery += ` GROUP BY trace_id ORDER BY started_at DESC`;

    const countQuery = `SELECT COUNT(*) as total FROM (${traceQuery})`;
    const { total } = this.db.prepare(countQuery).get(params) as { total: number };

    traceQuery += ` LIMIT @limit OFFSET @offset`;
    params.limit = filters.limit;
    params.offset = filters.offset;

    const cycles = this.db.prepare(traceQuery).all(params) as ReadonlyArray<CycleRow>;

    if (cycles.length === 0) {
      return { data: [], total, limit: filters.limit, offset: filters.offset };
    }

    const traceIds = cycles.map((c) => c.trace_id);
    const placeholders = traceIds.map((_, i) => `@t${i}`).join(",");
    const outcomeParams: Record<string, string> = {};
    traceIds.forEach((id, i) => {
      outcomeParams[`t${i}`] = id;
    });

    const outcomes = this.db
      .prepare(
        `SELECT id, agent_id, task, status, error, execution_time_ms, tokens_used, trace_id, created_at
         FROM outcomes
         WHERE trace_id IN (${placeholders})
         ORDER BY created_at ASC`,
      )
      .all(outcomeParams) as ReadonlyArray<CycleOutcome & { trace_id: string }>;

    const outcomesByTrace = new Map<string, Array<CycleOutcome>>();
    for (const o of outcomes) {
      const list = outcomesByTrace.get(o.trace_id) ?? [];
      list.push(o);
      outcomesByTrace.set(o.trace_id, list);
    }

    const data: ReadonlyArray<OutcomeCycle> = cycles.map((c) => ({
      trace_id: c.trace_id,
      started_at: c.started_at,
      ended_at: c.ended_at,
      duration_ms: c.total_duration_ms,
      total_tokens: c.total_tokens,
      success_count: c.success_count,
      failed_count: c.failed_count,
      outcome_count: c.outcome_count,
      outcomes: outcomesByTrace.get(c.trace_id) ?? [],
    }));

    return { data, total, limit: filters.limit, offset: filters.offset };
  }
}
