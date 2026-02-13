import { Controller, Get, Patch, Param, Body } from "@nestjs/common";
import { AgentsService } from "./agents.service";

@Controller("agents")
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  findAll() {
    return this.agentsService.findAll();
  }

  @Get(":id/history")
  getHistory(@Param("id") id: string) {
    return this.agentsService.getHistory(id);
  }

  @Patch(":id/config")
  updateConfig(@Param("id") id: string, @Body() config: Record<string, unknown>) {
    return this.agentsService.updateConfig(id, config);
  }
}
