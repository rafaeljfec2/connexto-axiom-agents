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

interface PendingCodeChange {
  readonly id: string;
  readonly description: string;
  readonly type: "code_change";
  readonly risk: number;
  readonly files_changed: string;
  readonly agent_id: string;
  readonly goal_id: string | null;
  readonly goal_title: string | null;
  readonly task_title: string | null;
  readonly created_at: string;
}

interface PendingArtifact {
  readonly id: string;
  readonly description: string;
  readonly type: "artifact";
  readonly artifact_type: string;
  readonly agent_id: string;
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
    readonly codeChanges: ReadonlyArray<PendingCodeChange>;
    readonly artifacts: ReadonlyArray<PendingArtifact>;
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
    readonly latest_branch: string | null;
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

export interface CycleOutcome {
  readonly id: string;
  readonly agent_id: string;
  readonly task: string;
  readonly status: string;
  readonly error: string | null;
  readonly execution_time_ms: number | null;
  readonly tokens_used: number | null;
  readonly created_at: string;
}

export interface OutcomeCycle {
  readonly trace_id: string;
  readonly started_at: string;
  readonly ended_at: string;
  readonly duration_ms: number;
  readonly total_tokens: number;
  readonly success_count: number;
  readonly failed_count: number;
  readonly outcome_count: number;
  readonly outcomes: ReadonlyArray<CycleOutcome>;
}

interface CyclesResponse {
  readonly data: ReadonlyArray<OutcomeCycle>;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export function useOutcomeCycles(params?: {
  agent?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.agent) searchParams.set("agent", params.agent);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));
  const qs = searchParams.toString();

  return useQuery({
    queryKey: ["outcomes", "cycles", params],
    queryFn: () => {
      const endpoint = qs ? `/outcomes/cycles?${qs}` : "/outcomes/cycles";
      return api.get<CyclesResponse>(endpoint);
    },
  });
}

export interface GoalCodeChange {
  readonly id: string;
  readonly task_id: string;
  readonly description: string;
  readonly files_changed: string;
  readonly risk: number;
  readonly status: string;
  readonly branch_name: string | null;
  readonly created_at: string;
}

export interface GoalTokenUsage {
  readonly agent_id: string;
  readonly executions: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly last_execution: string;
}

export interface GoalDetails {
  readonly goal: Goal;
  readonly codeChanges: ReadonlyArray<GoalCodeChange>;
  readonly tokenUsage: ReadonlyArray<GoalTokenUsage>;
}

export function useGoalDetails(goalId: string | null) {
  return useQuery({
    queryKey: ["goals", goalId, "details"],
    queryFn: () => api.get<GoalDetails>(`/goals/${goalId}/details`),
    enabled: !!goalId,
  });
}

interface CreateGoalPayload {
  readonly title: string;
  readonly description?: string;
  readonly priority?: number;
  readonly project_id?: string;
}

export interface ActiveProject {
  readonly id: string;
  readonly project_id: string;
  readonly language: string;
  readonly framework: string;
  readonly status: string;
}

export function useActiveProjects() {
  return useQuery<readonly ActiveProject[]>({
    queryKey: ["projects", "active"],
    queryFn: () => api.get("/projects"),
    staleTime: 60_000,
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGoalPayload) => api.post<Goal>("/goals", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

interface UpdateGoalStatusPayload {
  readonly id: string;
  readonly status: string;
}

export function useUpdateGoalStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: UpdateGoalStatusPayload) =>
      api.patch<Goal>(`/goals/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useApproveGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/goals/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRejectGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/goals/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
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

export interface ExecutionEvent {
  readonly id: number;
  readonly trace_id: string;
  readonly agent: string;
  readonly event_type: string;
  readonly phase: string | null;
  readonly message: string;
  readonly metadata: string | null;
  readonly level: string;
  readonly created_at: string;
}

export interface TraceSummary {
  readonly trace_id: string;
  readonly agent_count: number;
  readonly event_count: number;
  readonly first_event_at: string;
  readonly last_event_at: string;
  readonly has_errors: number;
  readonly agents: string;
}

export function useRecentTraces(limit: number = 20) {
  return useQuery<readonly TraceSummary[]>({
    queryKey: ["execution-traces", limit],
    queryFn: () => api.get(`/execution-events/traces?limit=${limit}`),
  });
}

export function useTraceEvents(traceId: string | null) {
  return useQuery<readonly ExecutionEvent[]>({
    queryKey: ["execution-events", traceId],
    queryFn: () => api.get(`/execution-events/trace/${traceId}`),
    enabled: Boolean(traceId),
  });
}
