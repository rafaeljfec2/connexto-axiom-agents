import { useAgents } from "@/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Activity } from "lucide-react";

export function Agents() {
  const { data: agents, isLoading, error } = useAgents();

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
        <p className="text-sm">Failed to load agents</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold md:text-2xl">Agents</h2>

      <div className="grid gap-4 md:grid-cols-2">
        {(agents ?? []).map((agent) => (
          <Card key={agent.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" />
                  {agent.name}
                </CardTitle>
                <Badge variant={agent.active ? "success" : "secondary"}>
                  {agent.active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-lg font-bold">{agent.stats.success_rate}%</p>
                  <p className="text-xs text-muted-foreground">Success Rate</p>
                </div>
                <div>
                  <p className="text-lg font-bold">{agent.stats.total}</p>
                  <p className="text-xs text-muted-foreground">Executions</p>
                </div>
                <div>
                  <p className="text-lg font-bold">
                    {agent.stats.tokens_used > 1000
                      ? `${(agent.stats.tokens_used / 1000).toFixed(1)}k`
                      : agent.stats.tokens_used}
                  </p>
                  <p className="text-xs text-muted-foreground">Tokens</p>
                </div>
              </div>

              {agent.alerts.length > 0 && (
                <div className="space-y-1">
                  {agent.alerts.map((alert, i) => (
                    <div
                      key={`${agent.id}-alert-${i}`}
                      className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
                    >
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {alert}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex h-8 items-end gap-px overflow-hidden rounded">
                {agent.stats.total > 0 ? (
                  <>
                    <div
                      className="bg-emerald-500 transition-all"
                      style={{
                        width: `${agent.stats.success_rate}%`,
                        height: "100%",
                      }}
                    />
                    <div
                      className="bg-red-400 transition-all"
                      style={{
                        width: `${100 - agent.stats.success_rate}%`,
                        height: "100%",
                      }}
                    />
                  </>
                ) : (
                  <div className="h-full w-full bg-muted" />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
