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

  @Get(":id/details")
  findOneWithDetails(@Param("id") id: string) {
    return this.goalsService.findOneWithDetails(id);
  }

  @Post()
  create(@Body() dto: CreateGoalDto) {
    return this.goalsService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateGoalDto) {
    return this.goalsService.update(id, dto);
  }

  @Post(":id/approve")
  approve(@Param("id") id: string) {
    return this.goalsService.approve(id);
  }

  @Post(":id/reject")
  reject(@Param("id") id: string) {
    return this.goalsService.reject(id);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.goalsService.remove(id);
  }
}
