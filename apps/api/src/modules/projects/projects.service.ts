import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DATABASE_TOKEN, type DatabaseConnection } from "../../database/database.provider";
import {
  createProjectFromUI,
  getAllProjects,
  getProjectById,
  updateOnboardingProgress,
  updateOnboardingStatus,
} from "../../../../../state/projects.js";
import type { Project } from "../../../../../state/projects.js";
import {
  startOnboarding,
  subscribeToOnboarding,
  type OnboardingEvent,
} from "../../../../../services/projectOnboardingService.js";

@Injectable()
export class ProjectsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: DatabaseConnection) {}

  findAll(): readonly Project[] {
    return getAllProjects(this.db);
  }

  findOne(id: string): Project {
    const project = getProjectById(this.db, id);
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  create(projectName: string, gitRepositoryUrl: string): Project {
    const project = createProjectFromUI(this.db, { projectName, gitRepositoryUrl });
    startOnboarding(this.db, project.project_id).catch(() => {});
    return project;
  }

  reindex(id: string): Project {
    const project = getProjectById(this.db, id);
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    updateOnboardingProgress(this.db, id, { index_status: "pending" });
    updateOnboardingStatus(this.db, id, "indexing");
    startOnboarding(this.db, id).catch(() => {});
    const updated = getProjectById(this.db, id);
    if (!updated) {
      throw new BadRequestException(`Failed to update project ${id}`);
    }
    return updated;
  }

  subscribeStatus(projectId: string, listener: (event: OnboardingEvent) => void): () => void {
    return subscribeToOnboarding(projectId, listener);
  }
}
