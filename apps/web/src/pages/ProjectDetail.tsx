import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useProjectDetail, useReindexProject } from "@/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  FolderGit2,
  Globe,
  Code2,
  RefreshCw,
  CheckCircle2,
  Clock,
  FileText,
  Database,
  Copy,
  GitBranch,
} from "lucide-react";

interface SSEEvent {
  readonly type: string;
  readonly status: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

const PIPELINE_STEPS = [
  { key: "cloning", label: "Clone", icon: GitBranch },
  { key: "copying", label: "Workspace", icon: Copy },
  { key: "documenting", label: "Documentation", icon: FileText },
  { key: "indexing", label: "Indexing", icon: Database },
  { key: "ready", label: "Ready", icon: CheckCircle2 },
] as const;

const STEP_ORDER: Record<string, number> = {
  pending: -1,
  cloning: 0,
  cloned: 1,
  copying: 1,
  documenting: 2,
  indexing: 3,
  ready: 4,
  error: -2,
};

function getStepStatus(
  stepIndex: number,
  currentStatus: string,
): "completed" | "active" | "pending" | "error" {
  const currentIndex = STEP_ORDER[currentStatus] ?? -1;
  if (currentStatus === "error") return "error";
  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

function StepIndicator({ status }: { readonly status: "completed" | "active" | "pending" | "error" }) {
  if (status === "completed") {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CheckCircle2 className="h-4 w-4" />
      </div>
    );
  }
  if (status === "active") {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary bg-primary/10">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
        <AlertCircle className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-muted bg-muted">
      <Clock className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading, error, refetch } = useProjectDetail(projectId ?? null);
  const reindex = useReindexProject();
  const [sseMessages, setSSEMessages] = useState<readonly SSEEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connectSSE = useCallback(() => {
    if (!projectId) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/projects/${projectId}/status/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SSEEvent;
        setSSEMessages((prev) => [...prev, data]);

        if (data.type === "complete" || data.type === "error") {
          refetch();
        }

        if (data.type === "progress") {
          refetch();
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      es.close();
    };
  }, [projectId, refetch]);

  useEffect(() => {
    if (project && ["cloning", "cloned", "copying", "documenting", "indexing"].includes(project.onboarding_status)) {
      connectSSE();
    }

    return () => {
      eventSourceRef.current?.close();
    };
  }, [project?.onboarding_status, connectSSE]);

  const handleReindex = useCallback(() => {
    if (!projectId) return;
    reindex.mutate(projectId, {
      onSuccess: () => {
        refetch();
        setSSEMessages([]);
        connectSSE();
      },
    });
  }, [projectId, reindex, refetch, connectSSE]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">Project not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/projects")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to Projects
        </Button>
      </div>
    );
  }

  const indexPct = project.files_total > 0
    ? Math.min(Math.round((project.files_indexed / project.files_total) * 100), 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FolderGit2 className="h-5 w-5 shrink-0 text-primary" />
          <h2 className="truncate text-xl font-bold md:text-2xl">{project.project_id}</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReindex}
          disabled={reindex.isPending || ["cloning", "documenting", "indexing"].includes(project.onboarding_status)}
        >
          <RefreshCw className={`mr-1.5 h-4 w-4 ${reindex.isPending ? "animate-spin" : ""}`} />
          Reindex
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {project.git_repository_url && (
          <Card>
            <CardContent className="flex items-center gap-2 p-4">
              <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Repository</p>
                <p className="truncate text-sm font-medium">{project.git_repository_url}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {project.stack_detected && (
          <Card>
            <CardContent className="flex items-center gap-2 p-4">
              <Code2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Stack</p>
                <p className="text-sm font-medium">{project.stack_detected}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="flex items-center gap-2 p-4">
            <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Files</p>
              <p className="text-sm font-medium">
                {String(project.files_indexed)} / {String(project.files_total)} indexed
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 text-sm font-semibold">Onboarding Pipeline</h3>

          <div className="flex items-center justify-between">
            {PIPELINE_STEPS.map((step, idx) => {
              const stepStatus = getStepStatus(idx, project.onboarding_status);
              const Icon = step.icon;

              return (
                <div key={step.key} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <StepIndicator status={stepStatus} />
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Icon className="h-3 w-3" />
                      <span className="hidden sm:inline">{step.label}</span>
                    </div>
                  </div>
                  {idx < PIPELINE_STEPS.length - 1 && (
                    <div className="mx-2 h-0.5 flex-1 bg-muted">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{
                          width: stepStatus === "completed" ? "100%" : "0%",
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {project.onboarding_error && (
            <div className="mt-4 flex items-start gap-2 rounded-md bg-destructive/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{project.onboarding_error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 text-sm font-semibold">Indexing Progress</h3>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{String(indexPct)}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${String(indexPct)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{String(project.files_indexed)} files indexed</span>
              <span>{String(project.files_total)} total files</span>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <Badge variant={project.docs_status === "completed" ? "success" : "secondary"}>
              Docs: {project.docs_status}
            </Badge>
            <Badge variant={project.index_status === "completed" ? "success" : "secondary"}>
              Index: {project.index_status}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {sseMessages.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-4 text-sm font-semibold">Activity Log</h3>
            <div className="max-h-60 space-y-1.5 overflow-y-auto">
              {sseMessages.map((msg, idx) => (
                <div
                  key={`sse-${String(idx)}`}
                  className={`flex items-start gap-2 text-xs ${
                    msg.type === "error" ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  <span className="shrink-0 font-mono">[{msg.status}]</span>
                  <span>{msg.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
