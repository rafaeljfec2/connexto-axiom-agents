import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DATABASE_TOKEN, DatabaseConnection } from "../../database/database.provider";

interface CodeChangeRow {
  readonly id: string;
  readonly task_id: string;
  readonly status: string;
}

@Injectable()
export class CodeChangesService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: DatabaseConnection) {}

  findAll(status?: string) {
    if (status) {
      return this.db
        .prepare("SELECT * FROM code_changes WHERE status = ? ORDER BY created_at DESC")
        .all(status);
    }
    return this.db.prepare("SELECT * FROM code_changes ORDER BY created_at DESC").all();
  }

  approve(id: string) {
    const row = this.db.prepare("SELECT * FROM code_changes WHERE id = ?").get(id) as CodeChangeRow | undefined;
    if (!row) {
      throw new NotFoundException(`Code change ${id} not found`);
    }

    this.db
      .prepare(
        `UPDATE code_changes SET status = 'approved', approved_by = 'dashboard', approved_at = datetime('now') WHERE id = ?`,
      )
      .run(id);

    return this.db.prepare("SELECT * FROM code_changes WHERE id = ?").get(id);
  }

  reject(id: string) {
    const row = this.db.prepare("SELECT * FROM code_changes WHERE id = ?").get(id) as CodeChangeRow | undefined;
    if (!row) {
      throw new NotFoundException(`Code change ${id} not found`);
    }

    this.db.prepare(`UPDATE code_changes SET status = 'rejected' WHERE id = ?`).run(id);

    this.tryAutoCompleteGoal(row.task_id);

    return this.db.prepare("SELECT * FROM code_changes WHERE id = ?").get(id);
  }

  private tryAutoCompleteGoal(shortGoalId: string): void {
    const goal = this.db
      .prepare("SELECT id FROM goals WHERE id LIKE ? || '%' AND status = 'in_progress' LIMIT 1")
      .get(shortGoalId) as { id: string } | undefined;

    if (!goal) return;

    const pending = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM code_changes
         WHERE task_id = ?
           AND status NOT IN ('applied', 'approved', 'rejected', 'failed', 'rolled_back')`,
      )
      .get(shortGoalId) as { count: number };

    const total = this.db
      .prepare("SELECT COUNT(*) as count FROM code_changes WHERE task_id = ?")
      .get(shortGoalId) as { count: number };

    if (total.count > 0 && pending.count === 0) {
      this.db
        .prepare(
          "UPDATE goals SET status = 'code_review', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'in_progress'",
        )
        .run(goal.id);
    }
  }
}
