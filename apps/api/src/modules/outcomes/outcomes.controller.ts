import { Controller, Get, Query } from "@nestjs/common";
import { OutcomesService } from "./outcomes.service";

@Controller("outcomes")
export class OutcomesController {
  constructor(private readonly outcomesService: OutcomesService) {}

  @Get("cycles")
  findCycles(
    @Query("agent") agent?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.outcomesService.findCycles({
      agent,
      status,
      limit: limit ? Number.parseInt(limit, 10) : 20,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    });
  }

  @Get()
  findAll(
    @Query("agent") agent?: string,
    @Query("status") status?: string,
    @Query("trace_id") traceId?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.outcomesService.findAll({
      agent,
      status,
      traceId,
      limit: limit ? Number.parseInt(limit, 10) : 50,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    });
  }
}
