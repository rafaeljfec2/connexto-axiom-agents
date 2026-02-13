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
      const stats = this.db
        .prepare(
          `SELECT
            COUNT(*) as total_outcomes,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
            MAX(created_at) as last_execution
          FROM outcomes
          WHERE task LIKE '%' || @goalId || '%'`,
        )
        .get({ goalId: goal.id });

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

  remove(id: string) {
    const existing = this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id);
    if (!existing) {
      throw new NotFoundException(`Goal ${id} not found`);
    }

    this.db.prepare("DELETE FROM goals WHERE id = ?").run(id);
    return { deleted: true };
  }
}
