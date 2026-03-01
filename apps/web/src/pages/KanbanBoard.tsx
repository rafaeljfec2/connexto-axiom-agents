import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGoals, useCreateGoal, useActiveProjects, useApproveGoal, useRejectGoal, useUpdateGoalStatus } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  AlertCircle,
  Plus,
  CircleDot,
  Timer,
  CheckCircle2,
  XCircle,
  Eye,
  Check,
  X,
  FolderGit2,
  Calendar,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const COLUMNS = [
  { id: "active", label: "Ativas", color: "bg-blue-500", icon: CircleDot },
  { id: "in_progress", label: "Em Progresso", color: "bg-amber-500", icon: Timer },
  { id: "code_review", label: "Code Review", color: "bg-violet-500", icon: Eye },
  { id: "completed", label: "Concluídas", color: "bg-emerald-500", icon: CheckCircle2 },
  { id: "cancelled", label: "Canceladas", color: "bg-zinc-400", icon: XCircle },
] as const;

const COLUMN_BG = [
  "kanban-col-even",
  "kanban-col-odd",
] as const;

const PRIORITY_OPTIONS = [
  { value: 0, label: "Baixa" },
  { value: 1, label: "Média" },
  { value: 2, label: "Alta" },
  { value: 3, label: "Crítica" },
] as const;

const PRIORITY_COLORS: Record<number, string> = {
  0: "kanban-prio-low",
  1: "kanban-prio-medium",
  2: "kanban-prio-high",
  3: "kanban-prio-critical",
};

const PRIORITY_LABEL: Record<number, string> = {
  0: "Baixa",
  1: "Média",
  2: "Alta",
  3: "Crítica",
};

function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function formatCardDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

interface GoalCardProps {
  readonly goal: {
    readonly id: string;
    readonly title: string;
    readonly priority: number;
    readonly project_id: string | null;
    readonly created_at: string;
    readonly updated_at: string;
    readonly stats?: {
      readonly total_outcomes: number;
      readonly success_count: number;
      readonly failed_count: number;
      readonly last_execution?: string | null;
      readonly latest_branch?: string | null;
    };
  };
  readonly columnId: string;
  readonly columnColor: string;
  readonly onNavigate: (id: string) => void;
  readonly onApprove?: (id: string) => void;
  readonly onReject?: (id: string) => void;
}

function GoalCard({ goal, columnId, columnColor, onNavigate, onApprove, onReject }: GoalCardProps) {
  const prioClass = PRIORITY_COLORS[goal.priority] ?? PRIORITY_COLORS[0];
  const isCodeReview = columnId === "code_review";

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData("text/plain", JSON.stringify({ goalId: goal.id, fromColumn: columnId }));
    e.dataTransfer.effectAllowed = "move";
    (e.currentTarget as HTMLElement).classList.add("kanban-card-dragging");
  }

  return (
    <div
      className="kanban-card group w-full text-left"
      draggable
      onDragStart={handleDragStart}
      onDragEnd={(e) => (e.currentTarget as HTMLElement).classList.remove("kanban-card-dragging")}
    >
      <button
        type="button"
        onClick={() => onNavigate(goal.id)}
        className="w-full cursor-pointer text-left"
      >
        <div className={`kanban-card-inner border-l-[3px] ${columnColor.replace("bg-", "border-")}`}>
          <div className="flex items-start justify-between gap-1.5 px-3 pt-2.5">
            <div className="min-w-0 flex-1">
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${prioClass}`}>
                P{goal.priority} {PRIORITY_LABEL[goal.priority] ?? ""}
              </span>
              <p className="kanban-card-title mt-1.5 text-[13px] font-semibold leading-snug">
                {goal.title}
              </p>
            </div>
            <MoreHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-[#d1d5db] opacity-0 transition-opacity group-hover:opacity-100" />
          </div>

          <div className="space-y-1.5 px-3 pb-3 pt-2">
            {goal.project_id ? (
              <div className="flex items-center gap-1.5 text-[11px] text-[#6b7280]">
                <FolderGit2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{goal.project_id}</span>
              </div>
            ) : null}

            <div className="flex items-center gap-1.5 text-[11px] text-[#9ca3af]">
              <Calendar className="h-3 w-3 shrink-0" />
              <span>Criado: {formatCardDate(goal.created_at)}</span>
            </div>

            {goal.stats?.last_execution ? (
              <div className="flex items-center gap-1.5 text-[11px] text-[#9ca3af]">
                <Calendar className="h-3 w-3 shrink-0" />
                <span>Última exec: {formatCardDate(goal.stats.last_execution)}</span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between border-t border-[#f3f4f6] px-3 py-1.5">
            <code className="font-mono text-[10px] text-[#9ca3af]">{shortId(goal.id)}</code>
            {goal.stats ? (
              <span className="text-[10px] tabular-nums text-[#9ca3af]">
                {goal.stats.total_outcomes} exec
              </span>
            ) : null}
          </div>
        </div>
      </button>

      {isCodeReview ? (
        <div className="flex items-center gap-2 border-t border-[#e5e7eb] px-3 py-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 cursor-pointer gap-1 border-emerald-300 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
            onClick={(e) => {
              e.stopPropagation();
              onApprove?.(goal.id);
            }}
          >
            <Check className="h-3.5 w-3.5" />
            Aprovar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 cursor-pointer gap-1 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={(e) => {
              e.stopPropagation();
              onReject?.(goal.id);
            }}
          >
            <X className="h-3.5 w-3.5" />
            Rejeitar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function KanbanBoard() {
  const { data: goals, isLoading, error } = useGoals({ includeStats: true });
  const { data: projects } = useActiveProjects();
  const navigate = useNavigate();
  const createGoal = useCreateGoal();
  const approveGoal = useApproveGoal();
  const rejectGoal = useRejectGoal();
  const updateGoalStatus = useUpdateGoalStatus();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleCreateGoal(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const title = (formData.get("title") as string).trim();
    if (!title) return;

    const description = (formData.get("description") as string).trim();
    const priority = Number(formData.get("priority"));
    const projectId = (formData.get("project_id") as string) || undefined;

    createGoal.mutate(
      {
        title,
        description: description || undefined,
        priority,
        project_id: projectId,
      },
      {
        onSuccess: () => {
          setDialogOpen(false);
          formRef.current?.reset();
        },
      },
    );
  }

  function handleNavigateToGoal(goalId: string) {
    navigate(`/kanban/${goalId}`);
  }

  function handleDragEnter(columnId: string) {
    setDragOverColumn(columnId);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    const relatedTarget = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragOverColumn(null);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, targetColumnId: string) {
    e.preventDefault();
    setDragOverColumn(null);

    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return;

    try {
      const { goalId, fromColumn } = JSON.parse(raw) as { goalId: string; fromColumn: string };
      if (fromColumn === targetColumnId) return;
      updateGoalStatus.mutate({ id: goalId, status: targetColumnId });
    } catch {
      // invalid drag data
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#9ca3af]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-[#9ca3af]">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">Erro ao carregar objetivos</p>
      </div>
    );
  }

  const goalsByStatus = COLUMNS.map((col) => ({
    ...col,
    goals: (goals ?? []).filter((g) => g.status === col.id),
  }));

  const totalGoals = goals?.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#1f2937] md:text-2xl">Quadro Kanban</h2>
          <p className="mt-0.5 text-sm text-[#6b7280]">
            {totalGoals} {totalGoals === 1 ? "objetivo" : "objetivos"}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="cursor-pointer gap-2">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Novo Objetivo</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
            <form ref={formRef} onSubmit={handleCreateGoal} className="flex flex-col min-h-0">
              <DialogHeader>
                <DialogTitle>Novo Objetivo</DialogTitle>
                <DialogDescription>
                  Crie um novo objetivo para os agentes executarem.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-4 overflow-y-auto min-h-0 flex-1 pr-1">
                <div className="space-y-2">
                  <Label htmlFor="goal-title">Título</Label>
                  <Input
                    id="goal-title"
                    name="title"
                    placeholder="Ex: Implementar autenticação OAuth"
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goal-description">Descrição (opcional)</Label>
                  <Textarea
                    id="goal-description"
                    name="description"
                    placeholder="Detalhes adicionais sobre o objetivo..."
                    rows={10}
                    className="min-h-[120px] max-h-[50vh] resize-y font-mono text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goal-priority">Prioridade</Label>
                  <select
                    id="goal-priority"
                    name="priority"
                    defaultValue="1"
                    className="flex h-9 w-full cursor-pointer rounded-md border border-[#e5e7eb] bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#93c5fd]"
                  >
                    {PRIORITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goal-project">Projeto</Label>
                  <select
                    id="goal-project"
                    name="project_id"
                    defaultValue={projects?.length === 1 ? projects.at(0)?.project_id ?? "" : ""}
                    className="flex h-9 w-full cursor-pointer rounded-md border border-[#e5e7eb] bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#93c5fd]"
                  >
                    <option value="">Sem projeto</option>
                    {projects?.map((p) => (
                      <option key={p.project_id} value={p.project_id}>
                        {p.project_id}
                      </option>
                    ))}
                  </select>
                </div>
                {createGoal.isError ? (
                  <p className="text-sm text-red-600">
                    {createGoal.error.message}
                  </p>
                ) : null}
              </div>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => setDialogOpen(false)}
                  disabled={createGoal.isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" className="cursor-pointer" disabled={createGoal.isPending}>
                  {createGoal.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Criar Objetivo
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="kanban-board flex min-h-[calc(100vh-220px)] overflow-x-auto md:overflow-x-visible">
        {goalsByStatus.map((column, idx) => {
          const Icon = column.icon;
          const isLast = idx === goalsByStatus.length - 1;
          const bgClass = COLUMN_BG[idx % 2];

          const isDragOver = dragOverColumn === column.id;

          return (
            <div
              key={column.id}
              aria-label={column.label}
              className={`flex w-72 shrink-0 flex-col md:w-auto md:flex-1 ${bgClass} ${isLast ? "" : "kanban-col-divider"} ${isDragOver ? "kanban-col-drop-target" : ""}`}
              onDragOver={handleDragOver}
              onDragEnter={() => handleDragEnter(column.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              <div className="kanban-col-header sticky top-0 z-10 flex items-center gap-2 px-3 py-2.5">
                <div className={`h-2.5 w-2.5 rounded-full ${column.color}`} />
                <h3 className="text-xs font-bold uppercase tracking-wide text-[#6b7280]">
                  {column.label}
                </h3>
                <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">
                  {column.goals.length}
                </Badge>
              </div>

              <div className="flex-1 space-y-2 p-2.5">
                {column.goals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    columnId={column.id}
                    columnColor={column.color}
                    onNavigate={handleNavigateToGoal}
                    onApprove={(id) => approveGoal.mutate(id)}
                    onReject={(id) => rejectGoal.mutate(id)}
                  />
                ))}

                {column.goals.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[#e5e7eb] px-4 py-10 text-center">
                    <Icon className="h-7 w-7 text-[#d1d5db]" />
                    <p className="text-[11px] text-[#9ca3af]">Nenhum objetivo</p>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
