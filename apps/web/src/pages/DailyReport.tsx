import { useDashboardSummary } from "@/api/hooks";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Clock, AlertCircle } from "lucide-react";

type MetricVariant = "success" | "warning" | "destructive";

function resolveRateVariant(rate: number): MetricVariant {
  if (rate >= 80) return "success";
  if (rate >= 50) return "warning";
  return "destructive";
}

function resolveBudgetVariant(remaining: number): MetricVariant {
  if (remaining > 50) return "success";
  if (remaining > 20) return "warning";
  return "destructive";
}

export function DailyReport() {
  const { data, isLoading, error } = useDashboardSummary();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">Failed to load dashboard data</p>
        <p className="text-xs">{error.message}</p>
      </div>
    );
  }

  if (!data) return null;

  const totalPending = data.pending.codeChanges.length + data.pending.artifacts.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold md:text-2xl">Daily Report</h2>
        <Button size="sm" className="gap-2">
          <Play className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Run Cycle</span>
        </Button>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {data.agents.map((agent) => (
          <MetricCard
            key={agent.agent_id}
            title={agent.agent_id.toUpperCase()}
            value={`${agent.success_rate}%`}
            subtitle={`${agent.total} executions`}
            variant={resolveRateVariant(agent.success_rate)}
          />
        ))}
        {data.budget ? (
          <MetricCard
            title="Budget"
            value={`${data.budget.remaining_pct}%`}
            subtitle="remaining"
            variant={resolveBudgetVariant(data.budget.remaining_pct)}
          />
        ) : null}
      </section>

      {totalPending > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Pending Actions ({totalPending})
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {data.pending.codeChanges.map((item) => (
              <Card key={item.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground">Code Change</p>
                  </div>
                  <div className="ml-3 flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs">
                      Reject
                    </Button>
                    <Button size="sm" className="text-xs">
                      Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {data.pending.artifacts.map((item) => (
              <Card key={item.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground">Artifact Draft</p>
                  </div>
                  <div className="ml-3 flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs">
                      Reject
                    </Button>
                    <Button size="sm" className="text-xs">
                      Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Latest Cycle
        </h3>
        {data.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cycle data available</p>
        ) : (
          <div className="space-y-1">
            {data.timeline.map((entry) => (
              <Card key={entry.id}>
                <CardContent className="flex items-center gap-3 p-3">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase">{entry.agent_id}</span>
                      <StatusBadge status={entry.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{entry.task}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleTimeString()}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              7-Day History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.weekHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No history data available</p>
            ) : (
              <div className="flex h-32 items-end gap-1 md:h-40">
                {data.weekHistory.map((entry, i) => {
                  const total = entry.success + entry.failed;
                  const successPct = total > 0 ? (entry.success / total) * 100 : 0;
                  return (
                    <div
                      key={`${entry.date}-${entry.agent_id}-${i}`}
                      className="flex flex-1 flex-col items-center gap-1"
                    >
                      <div
                        className="relative w-full overflow-hidden rounded-t-sm"
                        style={{ height: `${Math.max(total * 3, 8)}px` }}
                      >
                        <div
                          className="absolute bottom-0 w-full bg-emerald-500"
                          style={{ height: `${successPct}%` }}
                        />
                        <div
                          className="absolute top-0 w-full bg-red-400"
                          style={{ height: `${100 - successPct}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-muted-foreground">
                        {entry.agent_id.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
