import { useState, useEffect, useRef, useMemo } from "react";
import type { ExecutionEvent } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PhaseStep } from "./PhaseStep";

interface PipelineStepperProps {
  readonly events: readonly ExecutionEvent[];
  readonly isLive: boolean;
}

interface AgentGroup {
  readonly agent: string;
  readonly events: readonly ExecutionEvent[];
  readonly status: "success" | "running" | "error" | "warning" | "pending";
  readonly phases: readonly PhaseGroup[];
}

interface PhaseGroup {
  readonly phase: string;
  readonly events: readonly ExecutionEvent[];
  readonly status: "success" | "running" | "error" | "warning" | "pending";
}

const AGENT_LABELS: Readonly<Record<string, string>> = {
  kairos: "KAIROS",
  forge: "FORGE",
  nexus: "NEXUS",
  vector: "VECTOR",
};

const AGENT_COLORS: Readonly<Record<string, string>> = {
  kairos: "bg-violet-500 text-white dark:bg-violet-600",
  forge: "bg-sky-500 text-white dark:bg-sky-600",
  nexus: "bg-amber-500 text-white dark:bg-amber-600",
  vector: "bg-emerald-500 text-white dark:bg-emerald-600",
};

function inferAgentStatus(events: readonly ExecutionEvent[], isLive: boolean): AgentGroup["status"] {
  const hasError = events.some((e) => e.level === "error");
  if (hasError) return "error";

  const hasWarning = events.some((e) => e.level === "warn");
  const lastEvent = events.at(-1);

  const completionTypes = ["cycle:end", "delegation:complete", "forge:delivery_complete"];
  const failureTypes = ["delegation:failed"];

  if (lastEvent && failureTypes.includes(lastEvent.event_type)) return "error";
  if (lastEvent && completionTypes.includes(lastEvent.event_type)) {
    return hasWarning ? "warning" : "success";
  }

  if (!isLive) {
    return hasWarning ? "warning" : "success";
  }

  return "running";
}

function inferPhaseStatus(events: readonly ExecutionEvent[], isLive: boolean, agentStatus?: AgentGroup["status"]): PhaseGroup["status"] {
  const hasError = events.some((e) => e.level === "error");
  if (hasError) return "error";

  const hasWarning = events.some((e) => e.level === "warn");

  const passedTypes = [
    "forge:validation_passed", "forge:review_passed",
    "forge:cli_completed", "forge:delivery_complete",
    "forge:context_loaded",
  ];
  const failedTypes = ["forge:validation_failed", "forge:review_failed", "forge:cli_failed"];

  const lastEvent = events.at(-1);
  if (lastEvent && failedTypes.includes(lastEvent.event_type)) return "error";
  if (lastEvent && passedTypes.includes(lastEvent.event_type)) {
    return hasWarning ? "warning" : "success";
  }

  if (!isLive) {
    if (agentStatus === "error") return "error";
    return hasWarning ? "warning" : "success";
  }

  return "running";
}

function groupEventsByAgent(events: readonly ExecutionEvent[], isLive: boolean): readonly AgentGroup[] {
  const agentMap = new Map<string, ExecutionEvent[]>();
  const agentOrder: string[] = [];

  for (const event of events) {
    let list = agentMap.get(event.agent);
    if (!list) {
      list = [];
      agentMap.set(event.agent, list);
      agentOrder.push(event.agent);
    }
    list.push(event);
  }

  return agentOrder.map((agent) => {
    const agentEvents = agentMap.get(agent) ?? [];
    const status = inferAgentStatus(agentEvents, isLive);
    const phases = groupEventsByPhase(agentEvents, isLive, status);
    return { agent, events: agentEvents, status, phases };
  });
}

function groupEventsByPhase(events: readonly ExecutionEvent[], isLive: boolean, agentStatus?: AgentGroup["status"]): readonly PhaseGroup[] {
  const phaseMap = new Map<string, ExecutionEvent[]>();
  const phaseOrder: string[] = [];

  for (const event of events) {
    const phase = event.phase ?? "general";
    let list = phaseMap.get(phase);
    if (!list) {
      list = [];
      phaseMap.set(phase, list);
      phaseOrder.push(phase);
    }
    list.push(event);
  }

  return phaseOrder.map((phase) => {
    const phaseEvents = phaseMap.get(phase) ?? [];
    return {
      phase,
      events: phaseEvents,
      status: inferPhaseStatus(phaseEvents, isLive, agentStatus),
    };
  });
}

function StatusIcon({ status }: { readonly status: string }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
    case "error":
      return <XCircle className="h-5 w-5 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    case "running":
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
    default:
      return <Circle className="h-5 w-5 text-muted-foreground/40" />;
  }
}

function AgentNode({ group, isLast, isLive }: {
  readonly group: AgentGroup;
  readonly isLast: boolean;
  readonly isLive: boolean;
}) {
  const isRunning = group.status === "running" && isLive;
  const [expanded, setExpanded] = useState(isRunning);

  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  const durationMs = useMemo(() => {
    if (group.events.length < 2) return 0;
    const firstEvent = group.events[0];
    const lastEvent = group.events.at(-1);
    if (!firstEvent || !lastEvent) return 0;
    return new Date(lastEvent.created_at).getTime() - new Date(firstEvent.created_at).getTime();
  }, [group.events]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="relative">
      {/* Vertical connector line */}
      {!isLast && (
        <div className="absolute left-[9px] top-8 bottom-0 w-0.5 bg-border" />
      )}

      {/* Agent header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full text-left hover:bg-muted/50 rounded-lg p-2 -ml-1 transition-colors"
      >
        <StatusIcon status={group.status} />
        <Badge className={cn("text-xs px-2 py-0.5", AGENT_COLORS[group.agent] ?? "bg-muted")}>
          {AGENT_LABELS[group.agent] ?? group.agent.toUpperCase()}
        </Badge>
        <span className="text-sm text-muted-foreground truncate flex-1">
          {group.events.at(-1)?.message}
        </span>
        {durationMs > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {formatDuration(durationMs)}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded phases */}
      {expanded && (
        <div className="ml-8 mt-1 mb-3 space-y-1 border-l border-border pl-4">
          {group.phases.map((phase, idx) => (
            <PhaseStep
              key={`${phase.phase}-${idx}`}
              phase={phase}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PipelineStepper({ events, isLive }: PipelineStepperProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentGroups = useMemo(() => groupEventsByAgent(events, isLive), [events, isLive]);

  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, isLive]);

  return (
    <div ref={scrollRef} className="space-y-1 max-h-[calc(100vh-300px)] overflow-y-auto">
      {agentGroups.map((group, idx) => (
        <AgentNode
          key={`${group.agent}-${idx}`}
          group={group}
          isLast={idx === agentGroups.length - 1}
          isLive={isLive}
        />
      ))}
    </div>
  );
}
