import { Body, Controller, Get, Param, Post, Res } from "@nestjs/common";
import { ProjectsService } from "./projects.service";
import { CreateProjectDto } from "./create-project.dto";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.service.create(dto.project_name, dto.git_repository_url);
  }

  @Post(":id/reindex")
  reindex(@Param("id") id: string) {
    return this.service.reindex(id);
  }

  @Get(":id/status/stream")
  streamStatus(
    @Param("id") id: string,
    @Res() res: { setHeader: (k: string, v: string) => void; flushHeaders: () => void; write: (d: string) => void; on: (e: string, cb: () => void) => void; end: () => void },
  ) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const unsubscribe = this.service.subscribeStatus(id, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    res.on("close", () => {
      unsubscribe();
      res.end();
    });
  }
}
