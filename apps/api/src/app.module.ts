import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { GoalsModule } from "./modules/goals/goals.module";
import { OutcomesModule } from "./modules/outcomes/outcomes.module";
import { CodeChangesModule } from "./modules/code-changes/code-changes.module";
import { ArtifactsModule } from "./modules/artifacts/artifacts.module";
import { CycleModule } from "./modules/cycle/cycle.module";
import { AgentsModule } from "./modules/agents/agents.module";
import { ExecutionEventsModule } from "./modules/execution-events/execution-events.module";
import { ProjectsModule } from "./modules/projects/projects.module";

@Module({
  imports: [
    DatabaseModule,
    DashboardModule,
    GoalsModule,
    OutcomesModule,
    CodeChangesModule,
    ArtifactsModule,
    CycleModule,
    AgentsModule,
    ExecutionEventsModule,
    ProjectsModule,
  ],
})
export class AppModule {}
