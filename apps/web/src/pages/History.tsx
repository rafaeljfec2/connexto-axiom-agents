import { useState } from "react";
import {
  useOutcomeCycles,
  type OutcomeCycle,
  type CycleOutcome,
} from "@/api/hooks";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Zap,
  Filter,
  ChevronLeft,
} from "lucide-react";

const PAGE_SIZE = 15;

const AGENT_OPTIONS = [
  { value: "", label: "Todos os agentes" },
  { value: "forge", label: "FORGE" },
  { value: "nexus", label: "NEXUS" },
  { value: "vector", label: "VECTOR" },
  { value: "kairos", label: "KAIROS" },
] as const;

const STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "success", label: "Sucesso" },
  { value: "failed", label: "Falha" },
  { value: "infra_unavailable", label: "Infra indisponível" },
] as const;

function formatDuration(ms: number | null): string {
  if (ms === null || ms === 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTokens(tokens: number | null): string {
  if (tokens === null || tokens === 0) return "-";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function CycleCard({ cycle }: { readonly cycle: OutcomeCycle }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(cycle.started_at);
  const allSuccess = cycle.failed_count === 0;

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {date.toLocaleDateString("pt-BR")} {date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {cycle.trace_id}
              </Badge>
              <Badge variant={allSuccess ? "success" : "destructive"} className="text-[10px]">
                {cycle.success_count}/{cycle.outcome_count}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {cycle.outcomes.map((o) => (
                <AgentMiniStatus key={o.id} outcome={o} />
              ))}
            </div>
          </div>

          <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground md:flex">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(cycle.duration_ms)}
            </span>
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {formatTokens(cycle.total_tokens)} tokens
            </span>
          </div>
        </button>

        {expanded && (
          <div className="border-t">
            <div className="divide-y">
              {cycle.outcomes.map((outcome) => (
                <OutcomeRow key={outcome.id} outcome={outcome} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AgentMiniStatus({ outcome }: { readonly outcome: CycleOutcome }) {
  const variant = outcome.status === "success" ? "success" : "destructive";
  return (
    <Badge variant={variant} className="text-[10px]">
      {outcome.agent_id.toUpperCase()}
    </Badge>
  );
}

function OutcomeRow({ outcome }: { readonly outcome: CycleOutcome }) {
  const [showError, setShowError] = useState(false);
  const hasFailed = outcome.status !== "success";
  const hasError = !!outcome.error;

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {outcome.agent_id.toUpperCase()}
            </Badge>
            <StatusBadge status={outcome.status} />
            <span className="text-xs text-muted-foreground">
              {new Date(outcome.created_at).toLocaleTimeString("pt-BR")}
            </span>
          </div>
          <p className="text-sm leading-snug">{outcome.task}</p>
        </div>
        <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground md:flex">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(outcome.execution_time_ms)}
          </span>
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {formatTokens(outcome.tokens_used)}
          </span>
        </div>
      </div>

      {hasFailed && hasError && (
        <div className="ml-0 md:ml-6">
          <button
            type="button"
            className="text-xs text-destructive underline-offset-2 hover:underline"
            onClick={() => setShowError((prev) => !prev)}
          >
            {showError ? "Ocultar erro" : "Ver erro"}
          </button>
          {showError && (
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-wrap wrap-break-word">
              {outcome.error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function History() {
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useOutcomeCycles({
    agent: agentFilter || undefined,
    status: statusFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const summaryStats = data
    ? data.data.reduce(
        (acc, c) => ({
          cycles: acc.cycles + 1,
          successes: acc.successes + c.success_count,
          failures: acc.failures + c.failed_count,
          tokens: acc.tokens + c.total_tokens,
          duration: acc.duration + c.duration_ms,
        }),
        { cycles: 0, successes: 0, failures: 0, tokens: 0, duration: 0 },
      )
    : null;

  function handleFilterChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => {
      setter(e.target.value);
      setPage(0);
    };
  }

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
        <p className="text-sm">Erro ao carregar histórico</p>
        <p className="text-xs">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold md:text-2xl">Histórico de Execuções</h2>

      {summaryStats && summaryStats.cycles > 0 && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{data?.total ?? 0}</p>
              <p className="text-xs text-muted-foreground">Total de Ciclos</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">
                {summaryStats.successes + summaryStats.failures > 0
                  ? `${Math.round((summaryStats.successes / (summaryStats.successes + summaryStats.failures)) * 100)}%`
                  : "-"}
              </p>
              <p className="text-xs text-muted-foreground">Taxa de Sucesso</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{formatTokens(summaryStats.tokens)}</p>
              <p className="text-xs text-muted-foreground">Tokens (página)</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">
                {summaryStats.cycles > 0
                  ? formatDuration(Math.round(summaryStats.duration / summaryStats.cycles))
                  : "-"}
              </p>
              <p className="text-xs text-muted-foreground">Duração Média</p>
            </CardContent>
          </Card>
        </section>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Filter className="hidden h-4 w-4 text-muted-foreground sm:block" />
        <select
          value={agentFilter}
          onChange={handleFilterChange(setAgentFilter)}
          className="h-8 rounded-md border border-input bg-background px-2.5 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {AGENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={handleFilterChange(setStatusFilter)}
          className="h-8 rounded-md border border-input bg-background px-2.5 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {(agentFilter || statusFilter) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => {
              setAgentFilter("");
              setStatusFilter("");
              setPage(0);
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {data?.data.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">Nenhum ciclo encontrado</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data?.data.map((cycle) => <CycleCard key={cycle.trace_id} cycle={cycle} />)}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="gap-1"
          >
            Próxima
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
