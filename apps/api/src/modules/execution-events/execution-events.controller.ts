import { Controller, Get, Param, Query, Sse, MessageEvent } from "@nestjs/common";
import { Observable, interval, EMPTY } from "rxjs";
import { switchMap, filter } from "rxjs/operators";
import { ExecutionEventsService } from "./execution-events.service";

@Controller("execution-events")
export class ExecutionEventsController {
  constructor(private readonly service: ExecutionEventsService) {}

  @Sse("stream")
  streamEvents(
    @Query("trace_id") traceId?: string,
    @Query("since_id") sinceId?: string,
  ): Observable<MessageEvent> {
    if (!this.service.tableExists()) {
      return EMPTY;
    }

    let lastId = sinceId ? Number.parseInt(sinceId, 10) : 0;

    return new Observable<MessageEvent>((subscriber) => {
      const sub = interval(1500)
        .pipe(
          switchMap(() => {
            const events = this.service.getEventsSince(lastId, traceId);
            const lastEvent = events.at(-1);
            if (lastEvent) {
              lastId = lastEvent.id;
            }
            return events;
          }),
          filter((event) => event !== undefined),
        )
        .subscribe({
          next: (event) => {
            subscriber.next({
              data: event,
            } as MessageEvent);
          },
          error: (err) => subscriber.error(err),
        });

      return () => sub.unsubscribe();
    });
  }

  @Get()
  getEvents(
    @Query("trace_id") traceId?: string,
    @Query("agent") agent?: string,
    @Query("level") level?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.service.getEvents({
      traceId,
      agent,
      level,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      offset: offset ? Number.parseInt(offset, 10) : undefined,
    });
  }

  @Get("traces")
  getTraces(@Query("limit") limit?: string) {
    return this.service.getRecentTraces(limit ? Number.parseInt(limit, 10) : undefined);
  }

  @Get("trace/:traceId")
  getTraceEvents(@Param("traceId") traceId: string) {
    return this.service.getEventsByTraceId(traceId);
  }
}
