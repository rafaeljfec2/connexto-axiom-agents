import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DATABASE_TOKEN, DatabaseConnection } from "../../database/database.provider";

@Injectable()
export class ArtifactsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: DatabaseConnection) {}

  findAll(status?: string) {
    if (status) {
      return this.db
        .prepare("SELECT * FROM artifacts WHERE status = ? ORDER BY created_at DESC")
        .all(status);
    }
    return this.db.prepare("SELECT * FROM artifacts ORDER BY created_at DESC").all();
  }

  approve(id: string) {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id);
    if (!row) {
      throw new NotFoundException(`Artifact ${id} not found`);
    }

    this.db
      .prepare(
        `UPDATE artifacts SET status = 'approved', approved_by = 'dashboard', approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      )
      .run(id);

    return this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id);
  }

  reject(id: string) {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id);
    if (!row) {
      throw new NotFoundException(`Artifact ${id} not found`);
    }

    this.db
      .prepare(
        `UPDATE artifacts SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`,
      )
      .run(id);

    return this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id);
  }
}
