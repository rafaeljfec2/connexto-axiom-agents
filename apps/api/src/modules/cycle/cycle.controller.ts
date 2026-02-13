import { Controller, Get, Post } from "@nestjs/common";
import { CycleService } from "./cycle.service";

@Controller("cycle")
export class CycleController {
  constructor(private readonly cycleService: CycleService) {}

  @Post("run")
  run() {
    return this.cycleService.run();
  }

  @Get("latest")
  getLatest() {
    return this.cycleService.getLatest();
  }
}
