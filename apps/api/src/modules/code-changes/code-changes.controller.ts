import { Controller, Get, Post, Param, Query } from "@nestjs/common";
import { CodeChangesService } from "./code-changes.service";

@Controller("code-changes")
export class CodeChangesController {
  constructor(private readonly codeChangesService: CodeChangesService) {}

  @Get()
  findAll(@Query("status") status?: string) {
    return this.codeChangesService.findAll(status);
  }

  @Post(":id/approve")
  approve(@Param("id") id: string) {
    return this.codeChangesService.approve(id);
  }

  @Post(":id/reject")
  reject(@Param("id") id: string) {
    return this.codeChangesService.reject(id);
  }
}
