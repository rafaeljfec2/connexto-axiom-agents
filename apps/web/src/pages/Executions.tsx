import { useState } from "react";
import { useRecentTraces, useTraceEvents } from "@/api/hooks";
import type { TraceSummary, ExecutionEvent } from "@/api/hooks";
import { useEventSource } from "@/api/useEventSource";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Loader2,
  AlertCircle,
  Activity,
  Radio,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PipelineStepper } from "@/components/execution/PipelineStepper";
import { TraceSummaryBar } from "@/components/execution/TraceSummaryBar";
import { LiveIndicator } from "@/components/execution/LiveIndicator";

function isTraceActive(trace: TraceSummary): boolean {
  const lastEventTime = new Date(trace.last_event_at).getTime();
  const tenSecondsAgo = Date.now() - 10_000;
  return lastEventTime > tenSecondsAgo;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min atrás`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h atrás`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d atrás`;
}

function TraceListItem({
  trace,
  isSelected,
  onSelect,
}: {
  readonly trace: TraceSummary;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}) {
  const active = isTraceActive(trace);
  const agents = trace.agents.split(",");

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-lg p-3 transition-colors border",
        isSelected
          ? "bg-sidebar-accent border-primary/30"
          : "hover:bg-muted/50 border-transparent",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {active ? (
            <Radio className="h-3 w-3 text-emerald-500 animate-pulse shrink-0" />
          ) : (
            <div className={cn(
              "h-2.5 w-2.5 rounded-full shrink-0",
              trace.has_errors ? "bg-destructive" : "bg-muted-foreground/30",
            )} />
          )}
          <span className="text-xs font-mono truncate">{trace.trace_id}</span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatRelativeTime(trace.first_event_at)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {agents.map((agent) => (
          <Badge key={agent} variant="secondary" className="text-[10px] px-1.5 py-0">
            {agent.toUpperCase()}
          </Badge>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {trace.event_count} events
        </span>
      </div>
    </button>
  );
}

function TraceListPanel({
  traces,
  selectedTraceId,
  onSelect,
}: {
  readonly traces: readonly TraceSummary[];
  readonly selectedTraceId: string | null;
  readonly onSelect: (traceId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 overflow-y-auto">
      {traces.map((trace) => (
        <TraceListItem
          key={trace.trace_id}
          trace={trace}
          isSelected={selectedTraceId === trace.trace_id}
          onSelect={() => onSelect(trace.trace_id)}
        />
      ))}
      {traces.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-8">
          Nenhuma execução encontrada
        </div>
      )}
    </div>
  );
}

export function Executions() {
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const { data: traces, isLoading: tracesLoading, error: tracesError } = useRecentTraces();
  const { data: traceEvents } = useTraceEvents(selectedTraceId);

  const selectedTrace = traces?.find((t) => t.trace_id === selectedTraceId);
  const isLive = selectedTrace ? isTraceActive(selectedTrace) : false;

  const { events: sseEvents, status: sseStatus } = useEventSource<ExecutionEvent>({
    url: selectedTraceId
      ? `/api/execution-events/stream?trace_id=${selectedTraceId}`
      : "/api/execution-events/stream",
    enabled: isLive,
  });

  const displayEvents: readonly ExecutionEvent[] = isLive && sseEvents.length > 0
    ? sseEvents
    : traceEvents ?? [];

  if (tracesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tracesError) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-destructive">
        <AlertCircle className="h-5 w-5" />
        <span>Erro ao carregar execuções</span>
      </div>
    );
  }

  const traceListContent = (
    <TraceListPanel
      traces={traces ?? []}
      selectedTraceId={selectedTraceId}
      onSelect={setSelectedTraceId}
    />
  );

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Execuções</h1>
        </div>
        {isLive && <LiveIndicator status={sseStatus} />}
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        {/* Mobile: Trace list in sheet */}
        <div className="md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="w-full">
                <Menu className="h-4 w-4 mr-2" />
                {selectedTraceId
                  ? `Trace ${selectedTraceId}`
                  : "Selecionar execução"}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-4">
              <h2 className="text-sm font-semibold mb-3">Execuções Recentes</h2>
              {traceListContent}
            </SheetContent>
          </Sheet>
        </div>

        {/* Desktop: Trace list sidebar */}
        <Card className="hidden md:block w-72 shrink-0 self-start">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Execuções Recentes</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 max-h-[calc(100vh-200px)] overflow-y-auto">
            {traceListContent}
          </CardContent>
        </Card>

        {/* Main content area */}
        <div className="flex-1 min-w-0">
          {selectedTraceId && displayEvents.length > 0 ? (
            <Card>
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-mono">
                      {selectedTraceId}
                    </CardTitle>
                    {isLive && (
                      <Badge variant="success" className="text-[10px]">Live</Badge>
                    )}
                  </div>
                </div>
                <TraceSummaryBar events={displayEvents} />
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <PipelineStepper events={displayEvents} isLive={isLive} />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
                <Activity className="h-8 w-8" />
                <p className="text-sm">
                  {traces && traces.length > 0
                    ? "Selecione uma execução para ver os detalhes"
                    : "Nenhuma execução encontrada. Execute um ciclo para começar."}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
