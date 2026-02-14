import { useParams, Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  useGoalDetails,
  type GoalCodeChange,
  type GoalTokenUsage,
} from "@/api/hooks";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  FileCode,
  Activity,
  Cpu,
  Calendar,
  Target,
  FolderGit2,
  GitBranch,
} from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  in_progress: "Em Progresso",
  completed: "Concluída",
  cancelled: "Cancelada",
  pending: "Pendente",
  failed: "Falhou",
  pending_approval: "Aguardando Aprovação",
  approved: "Aprovada",
  applied: "Aplicada",
  rejected: "Rejeitada",
  rolled_back: "Revertida",
  success: "Sucesso",
};

const PRIORITY_LABEL: Record<number, string> = {
  0: "Baixa",
  1: "Média",
  2: "Alta",
  3: "Crítica",
};

const STATUS_COLOR: Record<string, string> = {
  active: "bg-blue-500",
  in_progress: "bg-amber-500",
  completed: "bg-emerald-500",
  cancelled: "bg-zinc-400",
};

const PRIORITY_COLOR: Record<number, string> = {
  0: "border-zinc-400 text-zinc-500",
  1: "border-blue-400 text-blue-500",
  2: "border-amber-400 text-amber-500",
  3: "border-red-400 text-red-500",
};

const CODE_CHANGE_VARIANT_MAP: Record<
  string,
  "success" | "warning" | "destructive" | "secondary"
> = {
  applied: "success",
  approved: "success",
  pending_approval: "warning",
  rejected: "destructive",
  failed: "destructive",
  rolled_back: "destructive",
};

const CODE_CHANGE_DOT_COLOR: Record<string, string> = {
  applied: "bg-emerald-500",
  approved: "bg-emerald-400",
  pending_approval: "bg-amber-500",
  pending: "bg-zinc-400",
  rejected: "bg-red-500",
  failed: "bg-red-500",
  rolled_back: "bg-zinc-500",
};

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Breadcrumb({ goalTitle }: Readonly<{ goalTitle: string }>) {
  return (
    <nav className="flex items-center gap-2 text-sm text-muted-foreground">
      <Link
        to="/kanban"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Quadro Kanban</span>
      </Link>
      <ChevronRight className="h-3.5 w-3.5" />
      <span className="truncate font-medium text-foreground">{goalTitle}</span>
    </nav>
  );
}

function MetadataField({
  icon,
  label,
  children,
}: Readonly<{ icon: React.ReactNode; label: string; children: React.ReactNode }>) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function ProgressBar({
  completed,
  total,
}: Readonly<{ completed: number; total: number }>) {
  if (total === 0) return null;

  const pct = Math.round((completed / total) * 100);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Progresso</span>
          <span className="text-sm text-muted-foreground">
            {completed}/{total} ({pct}%)
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CodeChangeRow({ codeChange }: Readonly<{ codeChange: GoalCodeChange }>) {
  const variant = CODE_CHANGE_VARIANT_MAP[codeChange.status] ?? "secondary";
  const dotColor = CODE_CHANGE_DOT_COLOR[codeChange.status] ?? "bg-zinc-400";

  return (
    <div className="group flex items-start gap-3 border-b px-4 py-3 last:border-b-0">
      <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium leading-snug">{codeChange.description}</p>
          <Badge variant={variant} className="shrink-0 text-[10px]">
            {STATUS_LABEL[codeChange.status] ?? codeChange.status}
          </Badge>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${codeChange.risk >= 3 ? "bg-red-500" : codeChange.risk >= 2 ? "bg-amber-500" : "bg-emerald-500"}`}
            />
            Risco {codeChange.risk}
          </span>
          {codeChange.branch_name ? (
            <span className="inline-flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {codeChange.branch_name}
            </span>
          ) : null}
          <span>{formatDate(codeChange.created_at)}</span>
        </div>
        {codeChange.files_changed === "[]" ? null : (
          <p className="mt-1 truncate text-xs text-muted-foreground/70">
            {codeChange.files_changed}
          </p>
        )}
      </div>
    </div>
  );
}

function CodeChangesPanel({
  codeChanges,
}: Readonly<{ codeChanges: ReadonlyArray<GoalCodeChange> }>) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Code Changes</h3>
        </div>
        <Badge variant="secondary" className="text-xs">
          {codeChanges.length}
        </Badge>
      </div>
      {codeChanges.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted-foreground">
          <FileCode className="h-8 w-8 opacity-30" />
          <p className="text-sm">Nenhuma alteracao de codigo vinculada</p>
        </div>
      ) : (
        <div>{codeChanges.map((cc) => <CodeChangeRow key={cc.id} codeChange={cc} />)}</div>
      )}
    </Card>
  );
}

function TokenUsagePanel({
  tokenUsage,
}: Readonly<{ tokenUsage: ReadonlyArray<GoalTokenUsage> }>) {
  const totalTokens = tokenUsage.reduce((sum, u) => sum + u.total_tokens, 0);
  const totalExecs = tokenUsage.reduce((sum, u) => sum + u.executions, 0);

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Uso de Recursos</h3>
        </div>
        <Badge variant="secondary" className="text-xs">
          {totalExecs} exec
        </Badge>
      </div>
      {tokenUsage.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted-foreground">
          <Activity className="h-8 w-8 opacity-30" />
          <p className="text-sm">Nenhuma execucao registrada</p>
        </div>
      ) : (
        <div>
          <div className="border-b bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
            Total: <span className="font-semibold text-foreground">{formatTokens(totalTokens)}</span> tokens
            em <span className="font-semibold text-foreground">{totalExecs}</span> execucoes
          </div>
          {tokenUsage.map((usage) => (
            <div
              key={usage.agent_id}
              className="flex items-center justify-between border-b px-4 py-2.5 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{usage.agent_id}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{usage.executions} exec</span>
                <span className="font-medium text-foreground">
                  {formatTokens(usage.total_tokens)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function GoalDetail() {
  const { goalId } = useParams<{ goalId: string }>();
  const { data, isLoading, error } = useGoalDetails(goalId ?? null);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">Erro ao carregar objetivo</p>
        <Link to="/kanban" className="text-sm text-primary underline">
          Voltar ao Kanban
        </Link>
      </div>
    );
  }

  const { goal, codeChanges, tokenUsage } = data;
  const statusColor = STATUS_COLOR[goal.status] ?? "bg-zinc-400";
  const priorityColor = PRIORITY_COLOR[goal.priority] ?? "border-zinc-400 text-zinc-500";

  const appliedChanges = codeChanges.filter(
    (cc) => cc.status === "applied" || cc.status === "approved",
  ).length;

  return (
    <div className="space-y-4">
      <Breadcrumb goalTitle={goal.title} />

      <div className="flex items-start gap-3">
        <div className={`mt-1 h-4 w-1 shrink-0 rounded-full ${statusColor}`} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-snug md:text-2xl">{goal.title}</h1>
          {goal.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{goal.description}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <ProgressBar completed={appliedChanges} total={codeChanges.length} />
          <CodeChangesPanel codeChanges={codeChanges} />
          <TokenUsagePanel tokenUsage={tokenUsage} />
        </div>

        <aside className="space-y-1">
          <Card>
            <CardContent className="divide-y p-4">
              <MetadataField icon={<Target className="h-4 w-4" />} label="Status">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${statusColor}`} />
                  <span className="text-sm font-medium">
                    {STATUS_LABEL[goal.status] ?? goal.status}
                  </span>
                </div>
              </MetadataField>

              <MetadataField icon={<AlertCircle className="h-4 w-4" />} label="Prioridade">
                <Badge variant="outline" className={`text-xs ${priorityColor}`}>
                  P{goal.priority} - {PRIORITY_LABEL[goal.priority] ?? "N/A"}
                </Badge>
              </MetadataField>

              {goal.project_id ? (
                <MetadataField icon={<FolderGit2 className="h-4 w-4" />} label="Projeto">
                  <span className="text-sm">{goal.project_id}</span>
                </MetadataField>
              ) : null}

              <MetadataField icon={<Calendar className="h-4 w-4" />} label="Criado em">
                <span className="text-sm">{formatShortDate(goal.created_at)}</span>
              </MetadataField>

              <MetadataField icon={<Calendar className="h-4 w-4" />} label="Atualizado em">
                <span className="text-sm">{formatShortDate(goal.updated_at)}</span>
              </MetadataField>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Resumo
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                  <p className="text-lg font-bold">{codeChanges.length}</p>
                  <p className="text-[10px] text-muted-foreground">Changes</p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                  <p className="text-lg font-bold">{appliedChanges}</p>
                  <p className="text-[10px] text-muted-foreground">Aplicadas</p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                  <p className="text-lg font-bold">
                    {formatTokens(tokenUsage.reduce((s, u) => s + u.total_tokens, 0))}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Tokens</p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                  <p className="text-lg font-bold">
                    {tokenUsage.reduce((s, u) => s + u.executions, 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Execucoes</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
