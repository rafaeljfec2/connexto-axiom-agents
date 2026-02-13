import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DATABASE_TOKEN, DatabaseConnection } from "../../database/database.provider";

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
    const row = this.db.prepare("SELECT * FROM code_changes WHERE id = ?").get(id);
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
    const row = this.db.prepare("SELECT * FROM code_changes WHERE id = ?").get(id);
    if (!row) {
      throw new NotFoundException(`Code change ${id} not found`);
    }

    this.db.prepare(`UPDATE code_changes SET status = 'rejected' WHERE id = ?`).run(id);

    return this.db.prepare("SELECT * FROM code_changes WHERE id = ?").get(id);
  }
}
