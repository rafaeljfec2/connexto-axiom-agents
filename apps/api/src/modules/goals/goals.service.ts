import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DATABASE_TOKEN, type DatabaseConnection } from "../../database/database.provider";
import { type CreateGoalDto, type UpdateGoalDto } from "./goals.dto";
import { randomUUID } from "node:crypto";

export interface GoalRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly priority: number;
  readonly project_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface GoalCodeChangeRow {
  readonly id: string;
  readonly task_id: string;
  readonly description: string;
  readonly files_changed: string;
  readonly risk: number;
  readonly status: string;
  readonly branch_name: string | null;
  readonly created_at: string;
}

export interface GoalTokenUsageRow {
  readonly agent_id: string;
  readonly executions: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly last_execution: string;
}

export interface GoalDetails {
  readonly goal: GoalRow;
  readonly codeChanges: ReadonlyArray<GoalCodeChangeRow>;
  readonly tokenUsage: ReadonlyArray<GoalTokenUsageRow>;
}

interface GoalFilters {
  readonly status?: string;
  readonly projectId?: string;
  readonly includeStats?: boolean;
}

@Injectable()
export class GoalsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: DatabaseConnection) {}

  findAll(filters: GoalFilters) {
    let query = "SELECT * FROM goals WHERE 1=1";
    const params: Record<string, string> = {};

    if (filters.status) {
      query += " AND status = @status";
      params.status = filters.status;
    }

    if (filters.projectId) {
      query += " AND project_id = @projectId";
      params.projectId = filters.projectId;
    }

    query += " ORDER BY priority DESC, created_at DESC";

    const goals = this.db.prepare(query).all(params) as ReadonlyArray<GoalRow>;

    if (!filters.includeStats) {
      return goals;
    }

    return goals.map((goal) => {
      const tokenStats = this.db
        .prepare(
          `SELECT
            COUNT(*) as total_outcomes,
            COUNT(*) as success_count,
            0 as failed_count,
            MAX(created_at) as last_execution
          FROM token_usage
          WHERE task_id = @goalId`,
        )
        .get({ goalId: goal.id }) as {
          total_outcomes: number;
          success_count: number;
          failed_count: number;
          last_execution: string | null;
        } | undefined;

      const codeChangeCount = this.db
        .prepare("SELECT COUNT(*) as count FROM code_changes WHERE task_id = @goalId")
        .get({ goalId: goal.id }) as { count: number } | undefined;

      const stats = {
        total_outcomes: Math.max(tokenStats?.total_outcomes ?? 0, codeChangeCount?.count ?? 0),
        success_count: tokenStats?.success_count ?? 0,
        failed_count: tokenStats?.failed_count ?? 0,
        last_execution: tokenStats?.last_execution ?? null,
      };

      return { ...goal, stats };
    });
  }

  create(dto: CreateGoalDto) {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO goals (id, title, description, priority, project_id, created_at, updated_at)
        VALUES (@id, @title, @description, @priority, @projectId, @now, @now)`,
      )
      .run({
        id,
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? 0,
        projectId: dto.project_id ?? null,
        now,
      });

    return this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id);
  }

  update(id: string, dto: UpdateGoalDto) {
    const existing = this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id);
    if (!existing) {
      throw new NotFoundException(`Goal ${id} not found`);
    }

    const fields: string[] = [];
    const params: Record<string, string | number> = { id };

    if (dto.title !== undefined) {
      fields.push("title = @title");
      params.title = dto.title;
    }
    if (dto.description !== undefined) {
      fields.push("description = @description");
      params.description = dto.description;
    }
    if (dto.status !== undefined) {
      fields.push("status = @status");
      params.status = dto.status;
    }
    if (dto.priority !== undefined) {
      fields.push("priority = @priority");
      params.priority = dto.priority;
    }

    if (fields.length === 0) {
      return existing;
    }

    fields.push("updated_at = datetime('now')");

    this.db.prepare(`UPDATE goals SET ${fields.join(", ")} WHERE id = @id`).run(params);

    return this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id);
  }

  findOneWithDetails(id: string): GoalDetails {
    const goal = this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as GoalRow | undefined;
    if (!goal) {
      throw new NotFoundException(`Goal ${id} not found`);
    }

    const goalId = id;

    const codeChanges = this.db
      .prepare(
        `SELECT id, task_id, description, files_changed, risk, status, branch_name, created_at
        FROM code_changes
        WHERE task_id = @goalId
        ORDER BY created_at DESC`,
      )
      .all({ goalId }) as ReadonlyArray<GoalCodeChangeRow>;

    const tokenUsage = this.db
      .prepare(
        `SELECT
          agent_id,
          COUNT(*) as executions,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(total_tokens) as total_tokens,
          MAX(created_at) as last_execution
        FROM token_usage
        WHERE task_id = @goalId
        GROUP BY agent_id
        ORDER BY total_tokens DESC`,
      )
      .all({ goalId }) as ReadonlyArray<GoalTokenUsageRow>;

    return { goal, codeChanges, tokenUsage };
  }

  remove(id: string) {
    const existing = this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id);
    if (!existing) {
      throw new NotFoundException(`Goal ${id} not found`);
    }

    this.db.prepare("DELETE FROM goals WHERE id = ?").run(id);
    return { deleted: true };
  }
}
