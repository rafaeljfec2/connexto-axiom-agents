import { useCallback, useRef, useState } from "react";
import { useGoals, useCreateGoal } from "@/api/hooks";
import { GoalDetailSheet } from "@/components/GoalDetailSheet";
import { Card, CardContent } from "@/components/ui/card";
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
import { Loader2, AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const COLUMNS = [
  { id: "active", label: "Ativas", color: "bg-blue-500" },
  { id: "in_progress", label: "Em Progresso", color: "bg-amber-500" },
  { id: "completed", label: "Concluídas", color: "bg-emerald-500" },
  { id: "cancelled", label: "Canceladas", color: "bg-zinc-400" },
] as const;

const PRIORITY_OPTIONS = [
  { value: 0, label: "Baixa" },
  { value: 1, label: "Média" },
  { value: 2, label: "Alta" },
  { value: 3, label: "Crítica" },
] as const;

export function KanbanBoard() {
  const { data: goals, isLoading, error } = useGoals({ includeStats: true });
  const createGoal = useCreateGoal();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const handleCloseDetail = useCallback(() => setSelectedGoalId(null), []);

  function handleCreateGoal(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const title = (formData.get("title") as string).trim();
    if (!title) return;

    const description = (formData.get("description") as string).trim();
    const priority = Number(formData.get("priority"));

    createGoal.mutate(
      {
        title,
        description: description || undefined,
        priority,
      },
      {
        onSuccess: () => {
          setDialogOpen(false);
          formRef.current?.reset();
        },
      },
    );
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
        <p className="text-sm">Erro ao carregar objetivos</p>
      </div>
    );
  }

  const goalsByStatus = COLUMNS.map((col) => ({
    ...col,
    goals: (goals ?? []).filter((g) => g.status === col.id),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold md:text-2xl">Quadro Kanban</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Novo Objetivo</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <form ref={formRef} onSubmit={handleCreateGoal}>
              <DialogHeader>
                <DialogTitle>Novo Objetivo</DialogTitle>
                <DialogDescription>
                  Crie um novo objetivo para os agentes executarem.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-4">
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
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goal-priority">Prioridade</Label>
                  <select
                    id="goal-priority"
                    name="priority"
                    defaultValue="1"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {PRIORITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {createGoal.isError ? (
                  <p className="text-sm text-destructive">
                    {createGoal.error.message}
                  </p>
                ) : null}
              </div>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={createGoal.isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={createGoal.isPending}>
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

      <div className="flex gap-4 overflow-x-auto pb-4 md:grid md:grid-cols-4 md:overflow-x-visible">
        {goalsByStatus.map((column) => (
          <div key={column.id} className="w-64 shrink-0 md:w-auto">
            <div className="mb-3 flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${column.color}`} />
              <h3 className="text-sm font-semibold">{column.label}</h3>
              <Badge variant="secondary" className="ml-auto text-xs">
                {column.goals.length}
              </Badge>
            </div>

            <div className="space-y-2">
              {column.goals.map((goal) => (
                <Card
                  key={goal.id}
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => setSelectedGoalId(goal.id)}
                >
                  <CardContent className="p-3">
                    <p className="text-sm font-medium leading-snug">{goal.title}</p>
                    {goal.project_id ? (
                      <p className="mt-1 text-xs text-muted-foreground">{goal.project_id}</p>
                    ) : null}
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        P{goal.priority}
                      </Badge>
                      {goal.stats ? (
                        <span className="text-xs text-muted-foreground">
                          {goal.stats.total_outcomes} exec
                        </span>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {column.goals.length === 0 && (
                <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Nenhum objetivo
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
