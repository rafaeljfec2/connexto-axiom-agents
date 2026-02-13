import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from "@nestjs/common";
import { GoalsService } from "./goals.service";
import { CreateGoalDto, UpdateGoalDto } from "./goals.dto";

@Controller("goals")
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  findAll(
    @Query("status") status?: string,
    @Query("project_id") projectId?: string,
    @Query("include") include?: string,
  ) {
    return this.goalsService.findAll({ status, projectId, includeStats: include === "stats" });
  }

  @Post()
  create(@Body() dto: CreateGoalDto) {
    return this.goalsService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateGoalDto) {
    return this.goalsService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.goalsService.remove(id);
  }
}
