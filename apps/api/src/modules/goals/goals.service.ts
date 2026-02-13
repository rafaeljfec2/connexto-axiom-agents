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

export interface GoalTaskRow {
  readonly id: string;
  readonly goal_id: string;
  readonly agent_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
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

export interface GoalOutcomeRow {
  readonly id: string;
  readonly agent_id: string;
  readonly task: string;
  readonly status: string;
  readonly error: string | null;
  readonly execution_time_ms: number | null;
  readonly tokens_used: number | null;
  readonly created_at: string;
}

export interface GoalDetails {
  readonly goal: GoalRow;
  readonly tasks: ReadonlyArray<GoalTaskRow>;
  readonly codeChanges: ReadonlyArray<GoalCodeChangeRow>;
  readonly outcomes: ReadonlyArray<GoalOutcomeRow>;
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

  findOneWithDetails(id: string): GoalDetails {
    const goal = this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as GoalRow | undefined;
    if (!goal) {
      throw new NotFoundException(`Goal ${id} not found`);
    }

    const tasks = this.db
      .prepare(
        `SELECT id, goal_id, agent_id, title, description, status, created_at, updated_at
        FROM tasks
        WHERE goal_id = @goalId
        ORDER BY created_at ASC`,
      )
      .all({ goalId: id }) as ReadonlyArray<GoalTaskRow>;

    const codeChanges = this.db
      .prepare(
        `SELECT cc.id, cc.task_id, cc.description, cc.files_changed, cc.risk, cc.status, cc.branch_name, cc.created_at
        FROM code_changes cc
        JOIN tasks t ON t.id = cc.task_id
        WHERE t.goal_id = @goalId
        ORDER BY cc.created_at DESC`,
      )
      .all({ goalId: id }) as ReadonlyArray<GoalCodeChangeRow>;

    const outcomes = this.db
      .prepare(
        `SELECT id, agent_id, task, status, error, execution_time_ms, tokens_used, created_at
        FROM outcomes
        WHERE task LIKE '%' || @goalId || '%'
        ORDER BY created_at DESC
        LIMIT 10`,
      )
      .all({ goalId: id }) as ReadonlyArray<GoalOutcomeRow>;

    return { goal, tasks, codeChanges, outcomes };
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
