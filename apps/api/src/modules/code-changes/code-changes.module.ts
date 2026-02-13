import { Module } from "@nestjs/common";
import { CodeChangesController } from "./code-changes.controller";
import { CodeChangesService } from "./code-changes.service";

@Module({
  controllers: [CodeChangesController],
  providers: [CodeChangesService],
})
export class CodeChangesModule {}
