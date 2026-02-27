import { Module } from "@nestjs/common";
import { ExecutionEventsController } from "./execution-events.controller";
import { ExecutionEventsService } from "./execution-events.service";

@Module({
  controllers: [ExecutionEventsController],
  providers: [ExecutionEventsService],
})
export class ExecutionEventsModule {}
