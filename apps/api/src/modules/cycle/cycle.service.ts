import { Inject, Injectable } from "@nestjs/common";
import { DATABASE_TOKEN, DatabaseConnection } from "../../database/database.provider";

@Injectable()
export class CycleService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: DatabaseConnection) {}

  run() {
    return {
      status: "queued",
      message: "Cycle execution will be integrated in Phase 3",
      timestamp: new Date().toISOString(),
    };
  }

  getLatest() {
    const latestTraceId = this.db
      .prepare(
        `SELECT trace_id FROM outcomes
        WHERE trace_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      )
      .get() as { trace_id: string } | undefined;

    if (!latestTraceId) {
      return { trace_id: null, outcomes: [] };
    }

    const outcomes = this.db
      .prepare(
        `SELECT * FROM outcomes
        WHERE trace_id = ?
        ORDER BY created_at ASC`,
      )
      .all(latestTraceId.trace_id);

    return {
      trace_id: latestTraceId.trace_id,
      outcomes,
    };
  }
}
