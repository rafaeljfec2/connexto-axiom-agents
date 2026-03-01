import { useState } from "react";
import type { ExecutionEvent } from "@/api/hooks";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EventDetail } from "./EventDetail";

interface PhaseGroup {
  readonly phase: string;
  readonly events: readonly ExecutionEvent[];
  readonly status: "success" | "running" | "error" | "warning" | "pending";
}

interface PhaseStepProps {
  readonly phase: PhaseGroup;
}

const PHASE_LABELS: Readonly<Record<string, string>> = {
  orchestration: "Orquestração",
  governance: "Governança",
  filtering: "Filtragem",
  setup: "Setup",
  budget_check: "Orçamento",
  execution: "Execução",
  cli_execution: "Claude CLI",
  validation: "Validação",
  review: "Code Review",
  delivery: "Entrega",
  general: "Geral",
};

function PhaseStatusIcon({ status }: { readonly status: string }) {
  const size = "h-3.5 w-3.5";
  switch (status) {
    case "success":
      return <CheckCircle2 className={cn(size, "text-emerald-500")} />;
    case "error":
      return <XCircle className={cn(size, "text-destructive")} />;
    case "warning":
      return <AlertTriangle className={cn(size, "text-amber-500")} />;
    case "running":
      return <Loader2 className={cn(size, "text-blue-500 animate-spin")} />;
    default:
      return <div className={cn("h-2 w-2 rounded-full bg-muted-foreground/30")} />;
  }
}

function summarizePhaseEvents(events: readonly ExecutionEvent[]): string {
  const lastEvent = events.at(-1);
  if (!lastEvent) return "";
  return lastEvent.message;
}

export function PhaseStep({ phase }: PhaseStepProps) {
  const [expanded, setExpanded] = useState(false);
  const label = PHASE_LABELS[phase.phase] ?? phase.phase;
  const summary = summarizePhaseEvents(phase.events);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left py-1.5 px-2 hover:bg-muted/50 rounded-md transition-colors group"
      >
        <PhaseStatusIcon status={phase.status} />
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs text-muted-foreground flex-1 min-w-0 wrap-break-word">{summary}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {phase.events.length > 1 && `${phase.events.length} events`}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>

      {expanded && (
        <div className="ml-6 mt-1 mb-2 space-y-1 min-w-0 overflow-hidden">
          {phase.events.map((event) => (
            <EventDetail key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
