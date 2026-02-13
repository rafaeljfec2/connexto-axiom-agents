import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

interface AgentStats {
  readonly agent_id: string;
  readonly total: number;
  readonly success: number;
  readonly failed: number;
  readonly success_rate: number;
}

interface BudgetInfo {
  readonly period: string;
  readonly total_tokens: number;
  readonly used_tokens: number;
  readonly remaining_pct: number;
}

interface PendingItem {
  readonly id: string;
  readonly description: string;
  readonly type: string;
  readonly created_at: string;
}

interface TimelineEntry {
  readonly id: string;
  readonly agent_id: string;
  readonly task: string;
  readonly status: string;
  readonly error: string | null;
  readonly trace_id: string | null;
  readonly created_at: string;
}

interface DailyHistory {
  readonly date: string;
  readonly agent_id: string;
  readonly success: number;
  readonly failed: number;
}

interface DashboardSummary {
  readonly agents: ReadonlyArray<AgentStats>;
  readonly budget: BudgetInfo | null;
  readonly pending: {
    readonly codeChanges: ReadonlyArray<PendingItem>;
    readonly artifacts: ReadonlyArray<PendingItem>;
  };
  readonly timeline: ReadonlyArray<TimelineEntry>;
  readonly weekHistory: ReadonlyArray<DailyHistory>;
}

interface Goal {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly priority: number;
  readonly project_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly stats?: {
    readonly total_outcomes: number;
    readonly success_count: number;
    readonly failed_count: number;
    readonly last_execution: string | null;
  };
}

interface Agent {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly stats: {
    readonly total: number;
    readonly success: number;
    readonly failed: number;
    readonly success_rate: number;
    readonly tokens_used: number;
  };
  readonly alerts: ReadonlyArray<string>;
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
    refetchInterval: 60_000,
  });
}

export function useGoals(params?: { status?: string; includeStats?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.includeStats) searchParams.set("include", "stats");
  const qs = searchParams.toString();

  return useQuery({
    queryKey: ["goals", params],
    queryFn: () => {
      const endpoint = qs ? `/goals?${qs}` : "/goals";
      return api.get<ReadonlyArray<Goal>>(endpoint);
    },
  });
}

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<ReadonlyArray<Agent>>("/agents"),
  });
}

export function useApproveCodeChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/code-changes/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRejectCodeChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/code-changes/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useApproveArtifact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/artifacts/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRejectArtifact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/artifacts/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRunCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/cycle/run"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
