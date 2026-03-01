import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects, useCreateProject } from "@/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  AlertCircle,
  Plus,
  FolderGit2,
  Globe,
  Code2,
} from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  cloning: "Cloning",
  cloned: "Cloned",
  copying: "Copying",
  documenting: "Documenting",
  indexing: "Indexing",
  ready: "Ready",
  error: "Error",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline" | "success"> = {
  pending: "secondary",
  cloning: "default",
  cloned: "default",
  copying: "default",
  documenting: "default",
  indexing: "default",
  ready: "success",
  error: "destructive",
};

function getIndexPercentage(total: number, indexed: number): number {
  if (total === 0) return 0;
  return Math.min(Math.round((indexed / total) * 100), 100);
}

export function Projects() {
  const navigate = useNavigate();
  const { data: projects, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [gitUrl, setGitUrl] = useState("");

  const handleCreate = useCallback(() => {
    if (!projectName.trim() || !gitUrl.trim()) return;

    createProject.mutate(
      { project_name: projectName.trim(), git_repository_url: gitUrl.trim() },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setProjectName("");
          setGitUrl("");
        },
      },
    );
  }, [projectName, gitUrl, createProject]);

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
        <p className="text-sm">Failed to load projects</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold md:text-2xl">Projects</h2>
        <Button onClick={() => setDialogOpen(true)} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          New Project
        </Button>
      </div>

      {(!projects || projects.length === 0) ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
            <FolderGit2 className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No projects yet</p>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Create your first project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const pct = getIndexPercentage(project.files_total, project.files_indexed);
            return (
              <Card
                key={project.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => navigate(`/projects/${project.project_id}`)}
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FolderGit2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate text-sm font-semibold">{project.project_id}</span>
                    </div>
                    <Badge variant={STATUS_VARIANTS[project.onboarding_status] ?? "secondary"}>
                      {STATUS_LABELS[project.onboarding_status] ?? project.onboarding_status}
                    </Badge>
                  </div>

                  {project.stack_detected && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Code2 className="h-3 w-3" />
                      {project.stack_detected}
                    </div>
                  )}

                  {project.git_repository_url && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Globe className="h-3 w-3 shrink-0" />
                      <span className="truncate">{project.git_repository_url}</span>
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Indexing</span>
                      <span>{String(pct)}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${String(pct)}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>{String(project.files_total)} files</span>
                    <span>{String(project.files_indexed)} indexed</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                placeholder="my-awesome-project"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Use kebab-case (lowercase letters, numbers, hyphens)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="git-url">Git Repository URL</Label>
              <Input
                id="git-url"
                placeholder="https://github.com/owner/repo.git"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!projectName.trim() || !gitUrl.trim() || createProject.isPending}
            >
              {createProject.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
