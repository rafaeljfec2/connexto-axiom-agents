import { useState } from "react";
import type { ExecutionEvent } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface EventDetailProps {
  readonly event: ExecutionEvent;
}

function parseMetadata(metadataStr: string | null): Record<string, unknown> | null {
  if (!metadataStr) return null;
  try {
    return JSON.parse(metadataStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === "number") {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    if (value % 1 !== 0) return value.toFixed(3);
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length <= 3) return value.join(", ");
    return `${value.slice(0, 3).join(", ")} (+${value.length - 3})`;
  }
  return String(value);
}

const LEVEL_STYLES: Readonly<Record<string, string>> = {
  info: "border-l-blue-400/50",
  warn: "border-l-amber-400",
  error: "border-l-destructive",
  debug: "border-l-muted-foreground/30",
};

const LEVEL_BADGE_VARIANT: Readonly<Record<string, "default" | "warning" | "destructive" | "secondary">> = {
  info: "secondary",
  warn: "warning",
  error: "destructive",
  debug: "secondary",
};

export function EventDetail({ event }: EventDetailProps) {
  const [metadataExpanded, setMetadataExpanded] = useState(false);
  const metadata = parseMetadata(event.metadata);
  const hasMetadata = metadata && Object.keys(metadata).length > 0;

  return (
    <div
      className={cn(
        "border-l-2 pl-3 py-1.5 text-xs",
        LEVEL_STYLES[event.level] ?? LEVEL_STYLES.info,
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground tabular-nums shrink-0">
          {formatTime(event.created_at)}
        </span>
        <Badge
          variant={LEVEL_BADGE_VARIANT[event.level] ?? "secondary"}
          className="text-[9px] px-1 py-0 shrink-0"
        >
          {event.event_type}
        </Badge>
        <span className="text-foreground/80 flex-1">{event.message}</span>
      </div>

      {hasMetadata && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setMetadataExpanded(!metadataExpanded)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            {metadataExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span className="text-[10px]">metadata</span>
          </button>

          {metadataExpanded && (
            <div className="mt-1 ml-4 space-y-0.5 font-mono">
              {Object.entries(metadata).map(([key, value]) => (
                <div key={key} className="flex gap-2 text-[10px]">
                  <span className="text-muted-foreground">{key}:</span>
                  <span className="text-foreground/80">{formatMetadataValue(value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
