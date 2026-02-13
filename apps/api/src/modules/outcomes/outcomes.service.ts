import { Inject, Injectable } from "@nestjs/common";
import { DATABASE_TOKEN, DatabaseConnection } from "../../database/database.provider";

interface OutcomeFilters {
  readonly agent?: string;
  readonly status?: string;
  readonly traceId?: string;
  readonly limit: number;
  readonly offset: number;
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
}
