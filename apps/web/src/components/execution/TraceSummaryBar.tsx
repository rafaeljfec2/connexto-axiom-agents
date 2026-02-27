import type { ExecutionEvent } from "@/api/hooks";
import { Clock, Zap, DollarSign, FileCode } from "lucide-react";

interface TraceSummaryBarProps {
  readonly events: readonly ExecutionEvent[];
}

function parseMetadata(metadataStr: string | null): Record<string, unknown> {
  if (!metadataStr) return {};
  try {
    return JSON.parse(metadataStr) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function computeSummary(events: readonly ExecutionEvent[]) {
  let totalTokens = 0;
  let totalCost = 0;
  let filesChanged = 0;

  for (const event of events) {
    const meta = parseMetadata(event.metadata);

    if (typeof meta.tokensUsed === "number") totalTokens += meta.tokensUsed;
    if (typeof meta.costUsd === "number") totalCost += meta.costUsd;
    if (typeof meta.kairosTokens === "number") totalTokens += meta.kairosTokens;
    if (typeof meta.filesChanged === "number" && meta.filesChanged > filesChanged) {
      filesChanged = meta.filesChanged;
    }
  }

  let durationMs = 0;
  if (events.length >= 2) {
    const firstEvent = events[0];
    const lastEvent = events.at(-1);
    if (firstEvent && lastEvent) {
      durationMs = new Date(lastEvent.created_at).getTime() - new Date(firstEvent.created_at).getTime();
    }
  }

  return { totalTokens, totalCost, filesChanged, durationMs };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

export function TraceSummaryBar({ events }: TraceSummaryBarProps) {
  const summary = computeSummary(events);

  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mt-2">
      {summary.durationMs > 0 && (
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>{formatDuration(summary.durationMs)}</span>
        </div>
      )}
      {summary.totalTokens > 0 && (
        <div className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          <span>{formatTokens(summary.totalTokens)} tokens</span>
        </div>
      )}
      {summary.totalCost > 0 && (
        <div className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          <span>${summary.totalCost.toFixed(3)}</span>
        </div>
      )}
      {summary.filesChanged > 0 && (
        <div className="flex items-center gap-1">
          <FileCode className="h-3 w-3" />
          <span>{summary.filesChanged} files</span>
        </div>
      )}
    </div>
  );
}
