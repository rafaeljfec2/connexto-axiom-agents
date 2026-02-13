import { useGoals } from "@/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const COLUMNS = [
  { id: "active", label: "Ativas", color: "bg-blue-500" },
  { id: "in_progress", label: "Em Progresso", color: "bg-amber-500" },
  { id: "completed", label: "Concluídas", color: "bg-emerald-500" },
  { id: "cancelled", label: "Canceladas", color: "bg-zinc-400" },
] as const;

export function KanbanBoard() {
  const { data: goals, isLoading, error } = useGoals({ includeStats: true });

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
        <Button size="sm" className="gap-2">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Novo Objetivo</span>
        </Button>
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
                <Card key={goal.id} className="cursor-pointer transition-shadow hover:shadow-md">
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
