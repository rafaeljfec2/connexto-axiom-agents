import { Inject, Injectable } from "@nestjs/common";
import { DATABASE_TOKEN, type DatabaseConnection } from "../../database/database.provider";

export interface ProjectRow {
  readonly id: string;
  readonly project_id: string;
  readonly language: string;
  readonly framework: string;
  readonly status: string;
}

@Injectable()
export class ProjectsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: DatabaseConnection) {}

  findActive(): readonly ProjectRow[] {
    return this.db
      .prepare("SELECT id, project_id, language, framework, status FROM projects WHERE status = 'active' ORDER BY project_id")
      .all() as ProjectRow[];
  }
}
