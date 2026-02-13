import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  useGoalDetails,
  type GoalDetails,
  type GoalTask,
  type GoalCodeChange,
  type GoalOutcome,
} from "@/api/hooks";
import {
  Loader2,
  CheckCircle2,
  Circle,
  XCircle,
  Clock,
  FileCode,
  ListChecks,
  Activity,
} from "lucide-react";

interface GoalDetailSheetProps {
  readonly goalId: string | null;
  readonly onClose: () => void;
}

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

function TaskStatusIcon({ status }: Readonly<{ status: string }>) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
    case "in_progress":
      return <Clock className="h-4 w-4 shrink-0 animate-pulse text-amber-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 shrink-0 text-red-500" />;
    default:
      return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
}

const CODE_CHANGE_VARIANT_MAP: Record<string, "success" | "warning" | "destructive" | "secondary"> =
  {
    applied: "success",
    approved: "success",
    pending_approval: "warning",
    rejected: "destructive",
    failed: "destructive",
    rolled_back: "destructive",
  };

function CodeChangeStatusBadge({ status }: Readonly<{ status: string }>) {
  const variant = CODE_CHANGE_VARIANT_MAP[status] ?? "secondary";

  return (
    <Badge variant={variant} className="text-[10px]">
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const OUTCOME_VARIANT_MAP: Record<string, "success" | "destructive" | "warning"> = {
  success: "success",
  failed: "destructive",
};

function OutcomeStatusBadge({ status }: Readonly<{ status: string }>) {
  const variant = OUTCOME_VARIANT_MAP[status] ?? "warning";

  return (
    <Badge variant={variant} className="text-[10px]">
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function SectionHeader({
  icon,
  title,
  count,
}: Readonly<{ icon: React.ReactNode; title: string; count: number }>) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
      {icon}
      <span>{title}</span>
      <Badge variant="secondary" className="ml-auto text-[10px]">
        {count}
      </Badge>
    </div>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function GoalHeader({ goal }: Readonly<{ goal: GoalDetails["goal"] }>) {
  return (
    <div className="space-y-2 pr-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-xs">
          P{goal.priority} - {PRIORITY_LABEL[goal.priority] ?? "N/A"}
        </Badge>
        <Badge variant="secondary" className="text-xs">
          {STATUS_LABEL[goal.status] ?? goal.status}
        </Badge>
        {goal.project_id ? (
          <Badge variant="outline" className="text-[10px]">
            {goal.project_id}
          </Badge>
        ) : null}
      </div>
      <h2 className="text-lg font-bold leading-snug">{goal.title}</h2>
      {goal.description ? (
        <p className="text-sm text-muted-foreground">{goal.description}</p>
      ) : null}
    </div>
  );
}

function ProgressBar({
  completed,
  total,
}: Readonly<{ completed: number; total: number }>) {
  if (total === 0) return null;

  const pct = (completed / total) * 100;

  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>Progresso</span>
        <span>
          {completed}/{total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TaskItem({ task }: Readonly<{ task: GoalTask }>) {
  return (
    <li className="flex items-start gap-2 rounded-md border bg-card px-3 py-2">
      <TaskStatusIcon status={task.status} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{task.agent_id}</span>
          <span>·</span>
          <span>{STATUS_LABEL[task.status] ?? task.status}</span>
        </div>
      </div>
    </li>
  );
}

function TasksSection({ tasks }: Readonly<{ tasks: ReadonlyArray<GoalTask> }>) {
  return (
    <div className="space-y-3">
      <SectionHeader
        icon={<ListChecks className="h-4 w-4" />}
        title="Tasks"
        count={tasks.length}
      />
      {tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma task vinculada.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CodeChangeItem({ codeChange }: Readonly<{ codeChange: GoalCodeChange }>) {
  return (
    <li className="rounded-md border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">
          {codeChange.description}
        </p>
        <CodeChangeStatusBadge status={codeChange.status} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <Badge variant="outline" className="text-[10px]">
          Risco {codeChange.risk}
        </Badge>
        {codeChange.branch_name ? <span>{codeChange.branch_name}</span> : null}
        <span>· {formatDate(codeChange.created_at)}</span>
      </div>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">
        {codeChange.files_changed}
      </p>
    </li>
  );
}

function CodeChangesSection({
  codeChanges,
}: Readonly<{ codeChanges: ReadonlyArray<GoalCodeChange> }>) {
  return (
    <div className="space-y-3">
      <SectionHeader
        icon={<FileCode className="h-4 w-4" />}
        title="Code Changes"
        count={codeChanges.length}
      />
      {codeChanges.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma alteração de código vinculada.
        </p>
      ) : (
        <ul className="space-y-2">
          {codeChanges.map((cc) => (
            <CodeChangeItem key={cc.id} codeChange={cc} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OutcomeItem({ outcome }: Readonly<{ outcome: GoalOutcome }>) {
  return (
    <li className="flex items-start justify-between gap-2 rounded-md border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{outcome.task}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{outcome.agent_id}</span>
          <span>· {formatDuration(outcome.execution_time_ms)}</span>
          {outcome.tokens_used ? <span>· {outcome.tokens_used} tokens</span> : null}
          <span>· {formatDate(outcome.created_at)}</span>
        </div>
        {outcome.error ? (
          <p className="mt-1 truncate text-[10px] text-red-500">{outcome.error}</p>
        ) : null}
      </div>
      <OutcomeStatusBadge status={outcome.status} />
    </li>
  );
}

function OutcomesSection({ outcomes }: Readonly<{ outcomes: ReadonlyArray<GoalOutcome> }>) {
  return (
    <div className="space-y-3">
      <SectionHeader
        icon={<Activity className="h-4 w-4" />}
        title="Execuções Recentes"
        count={outcomes.length}
      />
      {outcomes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma execução registrada.</p>
      ) : (
        <ul className="space-y-2">
          {outcomes.map((outcome) => (
            <OutcomeItem key={outcome.id} outcome={outcome} />
          ))}
        </ul>
      )}
    </div>
  );
}

function GoalDetailContent({ data }: Readonly<{ data: GoalDetails }>) {
  const completedTasks = data.tasks.filter((t) => t.status === "completed").length;
  const totalTasks = data.tasks.length;

  return (
    <div className="flex flex-col gap-5 p-5">
      <GoalHeader goal={data.goal} />
      <ProgressBar completed={completedTasks} total={totalTasks} />
      <TasksSection tasks={data.tasks} />
      <CodeChangesSection codeChanges={data.codeChanges} />
      <OutcomesSection outcomes={data.outcomes} />
    </div>
  );
}

export function GoalDetailSheet({ goalId, onClose }: GoalDetailSheetProps) {
  const { data, isLoading } = useGoalDetails(goalId);

  return (
    <Sheet open={!!goalId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {!isLoading && data ? <GoalDetailContent data={data} /> : null}
      </SheetContent>
    </Sheet>
  );
}
