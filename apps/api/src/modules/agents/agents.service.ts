import { Inject, Injectable } from "@nestjs/common";
import { DATABASE_TOKEN, DatabaseConnection } from "../../database/database.provider";

const KNOWN_AGENTS = ["forge", "nexus", "vector", "kairos"] as const;

export interface AgentRow {
  readonly agent_id: string;
  readonly total: number;
  readonly success: number;
  readonly failed: number;
  readonly success_rate: number;
  readonly tokens_used: number;
}

@Injectable()
export class AgentsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: DatabaseConnection) {}

  findAll() {
    return KNOWN_AGENTS.map((agentId) => {
      const stats = this.db
        .prepare(
          `SELECT
            agent_id,
            COUNT(*) as total,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
            ROUND(SUM(CASE WHEN status = 'success' THEN 1.0 ELSE 0 END) / COUNT(*) * 100, 1) as success_rate,
            COALESCE(SUM(tokens_used), 0) as tokens_used
          FROM outcomes
          WHERE agent_id = ? AND created_at >= datetime('now', '-7 days')`,
        )
        .get(agentId) as AgentRow | undefined;

      const recentFailures = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM outcomes
          WHERE agent_id = ? AND status = 'failed' AND created_at >= datetime('now', '-24 hours')`,
        )
        .get(agentId) as { count: number };

      return {
        id: agentId,
        name: agentId.toUpperCase(),
        active: true,
        stats: stats ?? { total: 0, success: 0, failed: 0, success_rate: 0, tokens_used: 0 },
        alerts: recentFailures.count > 3 ? [`${recentFailures.count} failures in last 24h`] : [],
      };
    });
  }

  getHistory(agentId: string) {
    return this.db
      .prepare(
        `SELECT * FROM outcomes
        WHERE agent_id = ?
        ORDER BY created_at DESC
        LIMIT 50`,
      )
      .all(agentId);
  }

  updateConfig(_agentId: string, _config: Record<string, unknown>) {
    return {
      status: "ok",
      message: "Agent config update will be integrated in Phase 3",
    };
  }
}
