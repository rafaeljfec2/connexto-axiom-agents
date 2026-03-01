import { Inject, Injectable } from "@nestjs/common";
import { DATABASE_TOKEN, DatabaseConnection } from "../../database/database.provider";

export interface AgentStats {
  readonly agent_id: string;
  readonly total: number;
  readonly success: number;
  readonly failed: number;
  readonly success_rate: number;
}

export interface PendingCodeChange {
  readonly id: string;
  readonly description: string;
  readonly type: "code_change";
  readonly risk: number;
  readonly files_changed: string;
  readonly agent_id: string;
  readonly goal_id: string | null;
  readonly goal_title: string | null;
  readonly task_title: string | null;
  readonly created_at: string;
}

export interface PendingArtifact {
  readonly id: string;
  readonly description: string;
  readonly type: "artifact";
  readonly artifact_type: string;
  readonly agent_id: string;
  readonly created_at: string;
}

export interface TimelineEntry {
  readonly id: string;
  readonly agent_id: string;
  readonly task: string;
  readonly status: string;
  readonly error: string | null;
  readonly trace_id: string | null;
  readonly created_at: string;
}

export interface DailyHistory {
  readonly date: string;
  readonly agent_id: string;
  readonly success: number;
  readonly failed: number;
}

export interface BudgetInfo {
  readonly period: string;
  readonly total_tokens: number;
  readonly used_tokens: number;
  readonly remaining_pct: number;
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: DatabaseConnection) {}

  getSummary() {
    const agentStats = this.getAgentStats();
    const budget = this.getBudgetInfo();
    const pendingCodeChanges = this.getPendingCodeChanges();
    const pendingArtifacts = this.getPendingArtifacts();
    const latestCycleTimeline = this.getLatestCycleTimeline();
    const weekHistory = this.getWeekHistory();

    return {
      agents: agentStats,
      budget,
      pending: {
        codeChanges: pendingCodeChanges,
        artifacts: pendingArtifacts,
      },
      timeline: latestCycleTimeline,
      weekHistory,
    };
  }

  private getAgentStats(): ReadonlyArray<AgentStats> {
    const rows = this.db
      .prepare(
        `SELECT
          agent_id,
          COUNT(*) as total,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          ROUND(SUM(CASE WHEN status = 'success' THEN 1.0 ELSE 0 END) / COUNT(*) * 100, 1) as success_rate
        FROM outcomes
        WHERE created_at >= datetime('now', '-7 days')
        GROUP BY agent_id
        ORDER BY agent_id`,
      )
      .all() as ReadonlyArray<AgentStats>;

    return rows;
  }

  private getBudgetInfo(): BudgetInfo | null {
    const row = this.db
      .prepare(
        `SELECT period, total_tokens, used_tokens,
          ROUND((1.0 - CAST(used_tokens AS REAL) / CASE WHEN total_tokens = 0 THEN 1 ELSE total_tokens END) * 100, 1) as remaining_pct
        FROM budgets
        ORDER BY created_at DESC
        LIMIT 1`,
      )
      .get() as BudgetInfo | undefined;

    return row ?? null;
  }

  private getPendingCodeChanges(): ReadonlyArray<PendingCodeChange> {
    return this.db
      .prepare(
        `SELECT
          cc.id,
          cc.description,
          'code_change' as type,
          cc.risk,
          cc.files_changed,
          COALESCE(t.agent_id, '') as agent_id,
          COALESCE(g_task.id, g_direct.id) as goal_id,
          COALESCE(g_task.title, g_direct.title) as goal_title,
          t.title as task_title,
          cc.created_at
        FROM code_changes cc
        LEFT JOIN tasks t ON t.id = cc.task_id
        LEFT JOIN goals g_task ON g_task.id = t.goal_id
        LEFT JOIN goals g_direct ON g_direct.id LIKE (cc.task_id || '%') AND g_task.id IS NULL
        WHERE cc.status = 'pending_approval'
        ORDER BY cc.created_at DESC`,
      )
      .all() as ReadonlyArray<PendingCodeChange>;
  }

  private getPendingArtifacts(): ReadonlyArray<PendingArtifact> {
    return this.db
      .prepare(
        `SELECT
          id,
          title as description,
          'artifact' as type,
          type as artifact_type,
          agent_id,
          created_at
        FROM artifacts
        WHERE status = 'draft'
        ORDER BY created_at DESC`,
      )
      .all() as ReadonlyArray<PendingArtifact>;
  }

  private getLatestCycleTimeline(): ReadonlyArray<TimelineEntry> {
    return this.db
      .prepare(
        `SELECT id, agent_id, task, status, error, trace_id, created_at
        FROM outcomes
        WHERE trace_id = (
          SELECT trace_id FROM outcomes
          WHERE trace_id IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
        )
        ORDER BY created_at ASC`,
      )
      .all() as ReadonlyArray<TimelineEntry>;
  }

  private getWeekHistory(): ReadonlyArray<DailyHistory> {
    return this.db
      .prepare(
        `SELECT
          date(created_at) as date,
          agent_id,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM outcomes
        WHERE created_at >= datetime('now', '-7 days')
        GROUP BY date(created_at), agent_id
        ORDER BY date ASC, agent_id`,
      )
      .all() as ReadonlyArray<DailyHistory>;
  }

  getTokenUsageStats() {
    const byAgent = this.db
      .prepare(
        `SELECT
          agent_id,
          SUM(total_tokens) as total_tokens,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(COALESCE(cache_read_tokens, 0)) as cache_read_tokens,
          SUM(COALESCE(cache_creation_tokens, 0)) as cache_creation_tokens,
          SUM(COALESCE(cost_usd, 0)) as total_cost_usd,
          COUNT(*) as call_count,
          AVG(total_tokens) as avg_tokens_per_call,
          MAX(total_tokens) as max_tokens_single_call
        FROM token_usage
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY agent_id
        ORDER BY total_tokens DESC`,
      )
      .all() as ReadonlyArray<Record<string, unknown>>;

    const topGoals = this.db
      .prepare(
        `SELECT
          task_id,
          agent_id,
          SUM(total_tokens) as total_tokens,
          SUM(COALESCE(cost_usd, 0)) as total_cost_usd,
          COUNT(*) as call_count,
          MIN(created_at) as first_call,
          MAX(created_at) as last_call
        FROM token_usage
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY task_id, agent_id
        ORDER BY total_tokens DESC
        LIMIT 10`,
      )
      .all() as ReadonlyArray<Record<string, unknown>>;

    const dailyUsage = this.db
      .prepare(
        `SELECT
          date(created_at) as date,
          agent_id,
          SUM(total_tokens) as total_tokens,
          SUM(COALESCE(cost_usd, 0)) as cost_usd,
          COUNT(*) as call_count
        FROM token_usage
        WHERE created_at >= datetime('now', '-7 days')
        GROUP BY date(created_at), agent_id
        ORDER BY date ASC, agent_id`,
      )
      .all() as ReadonlyArray<Record<string, unknown>>;

    const totals = this.db
      .prepare(
        `SELECT
          SUM(total_tokens) as total_tokens,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(COALESCE(cache_read_tokens, 0)) as cache_read_tokens,
          SUM(COALESCE(cost_usd, 0)) as total_cost_usd,
          COUNT(*) as total_calls
        FROM token_usage
        WHERE created_at >= datetime('now', '-30 days')`,
      )
      .get() as Record<string, unknown> | undefined;

    const cacheRatio =
      totals && typeof totals.cache_read_tokens === "number" && typeof totals.input_tokens === "number" && totals.input_tokens > 0
        ? Math.round(((totals.cache_read_tokens as number) / (totals.input_tokens as number)) * 100)
        : 0;

    return {
      totals: {
        ...(totals ?? {}),
        cache_hit_ratio_pct: cacheRatio,
      },
      byAgent,
      topGoals,
      dailyUsage,
    };
  }
}
