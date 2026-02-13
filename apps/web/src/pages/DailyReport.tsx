import { useState, useMemo } from "react";
import {
  useDashboardSummary,
  useApproveCodeChange,
  useRejectCodeChange,
  useApproveArtifact,
  useRejectArtifact,
} from "@/api/hooks";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Clock, AlertCircle, ShieldAlert, Filter } from "lucide-react";

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

function RiskBadge({ risk }: { readonly risk: number }) {
  if (risk >= 4) {
    return (
      <Badge variant="destructive" className="shrink-0 gap-1 text-[10px]">
        <ShieldAlert className="h-3 w-3" />
        Risco {risk}
      </Badge>
    );
  }
  if (risk >= 2) {
    return (
      <Badge variant="outline" className="shrink-0 text-[10px] text-amber-600 border-amber-300">
        Risco {risk}
      </Badge>
    );
  }
  return null;
}

const ALL_GOALS_FILTER = "__all__";
const NO_GOAL_FILTER = "__no_goal__";

export function DailyReport() {
  const { data, isLoading, error } = useDashboardSummary();
  const [goalFilter, setGoalFilter] = useState(ALL_GOALS_FILTER);

  const approveCode = useApproveCodeChange();
  const rejectCode = useRejectCodeChange();
  const approveArtifact = useApproveArtifact();
  const rejectArtifact = useRejectArtifact();

  const goalOptions = useMemo(() => {
    if (!data) return [];
    const goalsMap = new Map<string, string>();
    for (const item of data.pending.codeChanges) {
      if (item.goal_id && item.goal_title) {
        goalsMap.set(item.goal_id, item.goal_title);
      }
    }
    return Array.from(goalsMap, ([id, title]) => ({ id, title }));
  }, [data]);

  const filteredCodeChanges = useMemo(() => {
    if (!data) return [];
    if (goalFilter === ALL_GOALS_FILTER) return data.pending.codeChanges;
    if (goalFilter === NO_GOAL_FILTER) return data.pending.codeChanges.filter((i) => !i.goal_id);
    return data.pending.codeChanges.filter((i) => i.goal_id === goalFilter);
  }, [data, goalFilter]);

  const filteredArtifacts = useMemo(() => {
    if (!data) return [];
    if (goalFilter === ALL_GOALS_FILTER || goalFilter === NO_GOAL_FILTER) return data.pending.artifacts;
    return [];
  }, [data, goalFilter]);

  const filteredTotal = filteredCodeChanges.length + filteredArtifacts.length;

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
        <p className="text-sm">Erro ao carregar dados do painel</p>
        <p className="text-xs">{error.message}</p>
      </div>
    );
  }

  if (!data) return null;

  const totalPending = data.pending.codeChanges.length + data.pending.artifacts.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold md:text-2xl">Resumo Diário</h2>
        <Button size="sm" className="gap-2">
          <Play className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Rodar Ciclo</span>
        </Button>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {data.agents.map((agent) => (
          <MetricCard
            key={agent.agent_id}
            title={agent.agent_id.toUpperCase()}
            value={`${agent.success_rate}%`}
            subtitle={`${agent.total} execuções`}
            variant={resolveRateVariant(agent.success_rate)}
          />
        ))}
        {data.budget ? (
          <MetricCard
            title="Orçamento"
            value={`${data.budget.remaining_pct}%`}
            subtitle="restante"
            variant={resolveBudgetVariant(data.budget.remaining_pct)}
          />
        ) : null}
      </section>

      {totalPending > 0 && (
        <section>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Ações Pendentes ({totalPending})
            </h3>
            {goalOptions.length > 0 && (
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={goalFilter}
                  onChange={(e) => setGoalFilter(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2.5 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value={ALL_GOALS_FILTER}>Todos os goals</option>
                  {goalOptions.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                  <option value={NO_GOAL_FILTER}>Sem goal vinculado</option>
                </select>
              </div>
            )}
          </div>
          {filteredTotal === 0 ? (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <p className="text-sm text-muted-foreground">Nenhuma ação pendente para este goal</p>
              </CardContent>
            </Card>
          ) : (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {filteredCodeChanges.map((item) => {
                  const isMutating =
                    (approveCode.isPending && approveCode.variables === item.id) ||
                    (rejectCode.isPending && rejectCode.variables === item.id);
                  return (
                    <div key={item.id} className="space-y-1.5 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              Código
                            </Badge>
                            {item.agent_id ? (
                              <Badge variant="secondary" className="shrink-0 text-[10px]">
                                {item.agent_id.toUpperCase()}
                              </Badge>
                            ) : null}
                            <RiskBadge risk={item.risk} />
                          </div>
                          <p className="text-sm leading-snug">{item.description}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            {item.goal_title ? (
                              <span>
                                <span className="font-medium text-foreground/70">Goal:</span> {item.goal_title}
                              </span>
                            ) : null}
                            {item.task_title ? (
                              <span>
                                <span className="font-medium text-foreground/70">Task:</span> {item.task_title}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1.5 pt-0.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            disabled={isMutating}
                            onClick={() => rejectCode.mutate(item.id)}
                          >
                            {rejectCode.isPending && rejectCode.variables === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Rejeitar"
                            )}
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            disabled={isMutating}
                            onClick={() => approveCode.mutate(item.id)}
                          >
                            {approveCode.isPending && approveCode.variables === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Aprovar"
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredArtifacts.map((item) => {
                  const isMutating =
                    (approveArtifact.isPending && approveArtifact.variables === item.id) ||
                    (rejectArtifact.isPending && rejectArtifact.variables === item.id);
                  return (
                    <div key={item.id} className="space-y-1.5 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary" className="shrink-0 text-[10px]">
                              Artefato
                            </Badge>
                            {item.agent_id ? (
                              <Badge variant="secondary" className="shrink-0 text-[10px]">
                                {item.agent_id.toUpperCase()}
                              </Badge>
                            ) : null}
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {item.artifact_type}
                            </Badge>
                          </div>
                          <p className="text-sm leading-snug">{item.description}</p>
                        </div>
                        <div className="flex shrink-0 gap-1.5 pt-0.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            disabled={isMutating}
                            onClick={() => rejectArtifact.mutate(item.id)}
                          >
                            {rejectArtifact.isPending && rejectArtifact.variables === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Rejeitar"
                            )}
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            disabled={isMutating}
                            onClick={() => approveArtifact.mutate(item.id)}
                          >
                            {approveArtifact.isPending && approveArtifact.variables === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Aprovar"
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Último Ciclo
        </h3>
        {data.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum dado de ciclo disponível</p>
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
                    {new Date(entry.created_at).toLocaleTimeString("pt-BR")}
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
              Histórico 7 Dias
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.weekHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum histórico disponível</p>
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
