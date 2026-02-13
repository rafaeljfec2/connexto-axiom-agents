import { Controller, Get, Post, Param, Query } from "@nestjs/common";
import { ArtifactsService } from "./artifacts.service";

@Controller("artifacts")
export class ArtifactsController {
  constructor(private readonly artifactsService: ArtifactsService) {}

  @Get()
  findAll(@Query("status") status?: string) {
    return this.artifactsService.findAll(status);
  }

  @Post(":id/approve")
  approve(@Param("id") id: string) {
    return this.artifactsService.approve(id);
  }

  @Post(":id/reject")
  reject(@Param("id") id: string) {
    return this.artifactsService.reject(id);
  }
}
