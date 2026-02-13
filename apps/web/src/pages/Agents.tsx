import { useAgents } from "@/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Activity } from "lucide-react";

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

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
        <p className="text-sm">Erro ao carregar agentes</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold md:text-2xl">Agentes</h2>

      <Card>
        <CardContent className="p-0">
          <div className="hidden border-b px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider md:grid md:grid-cols-[1fr_100px_100px_100px_80px]">
            <span>Agente</span>
            <span className="text-right">Sucesso</span>
            <span className="text-right">Execuções</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Status</span>
          </div>

          <div className="divide-y">
            {(agents ?? []).map((agent) => (
              <div key={agent.id} className="space-y-2 px-4 py-3">
                <div className="flex items-center gap-3 md:grid md:grid-cols-[1fr_100px_100px_100px_80px]">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Activity className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-semibold">{agent.name}</span>
                  </div>

                  <div className="hidden text-right md:block">
                    <span className="text-sm font-bold">{agent.stats.success_rate}%</span>
                  </div>
                  <div className="hidden text-right md:block">
                    <span className="text-sm font-bold">{agent.stats.total}</span>
                  </div>
                  <div className="hidden text-right md:block">
                    <span className="text-sm font-bold">{formatTokens(agent.stats.tokens_used)}</span>
                  </div>

                  <div className="flex items-center gap-2 md:justify-end">
                    <div className="flex gap-3 text-xs text-muted-foreground md:hidden">
                      <span>{agent.stats.success_rate}%</span>
                      <span>{agent.stats.total} exec</span>
                      <span>{formatTokens(agent.stats.tokens_used)} tok</span>
                    </div>
                    <Badge variant={agent.active ? "success" : "secondary"} className="shrink-0">
                      {agent.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                </div>

                <div className="flex h-2 items-end gap-px overflow-hidden rounded-full">
                  {agent.stats.total > 0 ? (
                    <>
                      <div
                        className="bg-emerald-500 transition-all"
                        style={{ width: `${agent.stats.success_rate}%`, height: "100%" }}
                      />
                      <div
                        className="bg-red-400 transition-all"
                        style={{ width: `${100 - agent.stats.success_rate}%`, height: "100%" }}
                      />
                    </>
                  ) : (
                    <div className="h-full w-full bg-muted" />
                  )}
                </div>

                {agent.alerts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {agent.alerts.map((alert, i) => (
                      <div
                        key={`${agent.id}-alert-${i}`}
                        className="flex items-center gap-1.5 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive"
                      >
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        {alert}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
