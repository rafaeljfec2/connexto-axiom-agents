import { useCallback, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  useGoalDetails,
  useUpdateGoal,
  type GoalCodeChange,
  type GoalTokenUsage,
} from "@/api/hooks";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  FileCode,
  Activity,
  Cpu,
  Calendar,
  Target,
  FolderGit2,
  GitBranch,
  ShieldAlert,
  FileText,
  Pencil,
  Check,
  X,
} from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  in_progress: "Em Progresso",
  code_review: "Em Revisão",
  completed: "Concluída",
  cancelled: "Cancelada",
  pending: "Pendente",
  failed: "Falhou",
  pending_approval: "Aguardando Aprovação",
  approved: "Aprovada",
  applied: "Aplicada",
  rejected: "Rejeitada",
  rolled_back: "Revertida",
  success: "Sucesso",
};

const PRIORITY_LABEL: Record<number, string> = {
  0: "Baixa",
  1: "Média",
  2: "Alta",
  3: "Crítica",
};

const STATUS_COLOR: Record<string, string> = {
  active: "bg-blue-500",
  in_progress: "bg-amber-500",
  code_review: "bg-violet-500",
  completed: "bg-emerald-500",
  cancelled: "bg-zinc-400",
};

const PRIORITY_COLOR: Record<number, string> = {
  0: "border-zinc-400 text-zinc-500",
  1: "border-blue-400 text-blue-500",
  2: "border-amber-400 text-amber-500",
  3: "border-red-400 text-red-500",
};

const CODE_CHANGE_VARIANT_MAP: Record<
  string,
  "success" | "warning" | "destructive" | "secondary"
> = {
  applied: "success",
  approved: "success",
  pending_approval: "warning",
  rejected: "destructive",
  failed: "destructive",
  rolled_back: "destructive",
};

const CODE_CHANGE_DOT_COLOR: Record<string, string> = {
  applied: "bg-emerald-500",
  approved: "bg-emerald-400",
  pending_approval: "bg-amber-500",
  pending: "bg-zinc-400",
  rejected: "bg-red-500",
  failed: "bg-red-500",
  rolled_back: "bg-zinc-500",
};

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Breadcrumb({ goalTitle }: Readonly<{ goalTitle: string }>) {
  return (
    <nav className="flex items-center gap-2 text-sm text-muted-foreground">
      <Link
        to="/kanban"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Quadro Kanban</span>
      </Link>
      <ChevronRight className="h-3.5 w-3.5" />
      <span className="truncate font-medium text-foreground">{goalTitle}</span>
    </nav>
  );
}

function MetadataField({
  icon,
  label,
  children,
}: Readonly<{ icon: React.ReactNode; label: string; children: React.ReactNode }>) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

interface ProgressCounts {
  readonly total: number;
  readonly applied: number;
  readonly rejected: number;
  readonly failed: number;
  readonly pending: number;
}

function computeProgress(
  codeChanges: ReadonlyArray<GoalCodeChange>,
): ProgressCounts {
  let applied = 0;
  let rejected = 0;
  let failed = 0;
  let pending = 0;

  for (const cc of codeChanges) {
    if (cc.status === "applied" || cc.status === "approved") {
      applied++;
    } else if (cc.status === "rejected") {
      rejected++;
    } else if (cc.status === "failed" || cc.status === "rolled_back") {
      failed++;
    } else {
      pending++;
    }
  }

  return { total: codeChanges.length, applied, rejected, failed, pending };
}

const PROGRESS_SEGMENTS = [
  { key: "applied", color: "bg-emerald-500", label: "aplicada" },
  { key: "rejected", color: "bg-red-500", label: "rejeitada" },
  { key: "failed", color: "bg-amber-500", label: "falha" },
  { key: "pending", color: "bg-zinc-300", label: "pendente" },
] as const;

function ProgressBar({ counts }: Readonly<{ counts: ProgressCounts }>) {
  if (counts.total === 0) return null;

  const resolved = counts.applied + counts.rejected + counts.failed;
  const resolvedPct = Math.round((resolved / counts.total) * 100);

  const barSegments = PROGRESS_SEGMENTS
    .filter((s) => s.key !== "pending")
    .map((s) => ({ ...s, pct: Math.round((counts[s.key] / counts.total) * 100) }))
    .filter((s) => s.pct > 0);

  const legendItems = PROGRESS_SEGMENTS
    .map((s) => ({ ...s, count: counts[s.key] }))
    .filter((s) => s.count > 0);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Progresso</span>
          <span className="text-sm text-muted-foreground">
            {resolved}/{counts.total} resolvidas ({resolvedPct}%)
          </span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
          {barSegments.map((s) => (
            <div
              key={s.key}
              className={`h-full ${s.color} transition-all`}
              style={{ width: `${s.pct}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {legendItems.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${s.color}`} />
              {s.count} {s.label}{s.count === 1 ? "" : "s"}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface DescriptionSections {
  readonly summary: string;
  readonly details: ReadonlyArray<{ readonly label: string; readonly items: ReadonlyArray<string> }>;
}

function parseDescription(text: string): DescriptionSections {
  const sectionPattern = /\b(Summary|Verification|Tests|Notes|Details|Notas|Verificação|Testes|Detalhes)\s*:\s*-?\s*/gi;
  const parts = text.split(sectionPattern);

  if (parts.length <= 1) {
    return { summary: text.trim(), details: [] };
  }

  let summary = parts[0]?.trim() ?? "";
  const details: Array<{ label: string; items: Array<string> }> = [];

  for (let i = 1; i < parts.length; i += 2) {
    const label = parts[i] ?? "";
    const rawContent = parts[i + 1] ?? "";

    const bullets = rawContent
      .split(/\s*-\s+/)
      .map((b) => b.trim())
      .filter(Boolean);

    if (label.toLowerCase() === "summary") {
      summary = bullets.join(" ").trim();
    } else if (bullets.length > 0) {
      details.push({ label, items: bullets });
    }
  }

  return { summary, details };
}

function parseFilesChanged(raw: string): ReadonlyArray<string> {
  if (!raw || raw === "[]") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ReadonlyArray<string>;
  } catch {
    /* not json */
  }
  return raw.split(",").map((f) => f.trim()).filter(Boolean);
}

function getRiskConfig(risk: number): { readonly color: string; readonly bg: string; readonly label: string } {
  if (risk >= 3) return { color: "text-red-600", bg: "bg-red-50", label: "Critico" };
  if (risk >= 2) return { color: "text-amber-600", bg: "bg-amber-50", label: "Alto" };
  return { color: "text-emerald-600", bg: "bg-emerald-50", label: "Baixo" };
}

function renderMarkdownLine(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let keyIdx = 0;

  while (remaining.length > 0) {
    const codeMatch = /`([^`]+)`/.exec(remaining);
    const boldMatch = /\*\*([^*]+)\*\*/.exec(remaining);

    let firstMatch: { index: number; length: number; node: React.ReactNode } | null = null;

    if (codeMatch?.index !== undefined) {
      firstMatch = {
        index: codeMatch.index,
        length: codeMatch[0].length,
        node: (
          <code key={`c${keyIdx++}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
            {codeMatch[1]}
          </code>
        ),
      };
    }

    if (boldMatch?.index !== undefined) {
      if (!firstMatch || boldMatch.index < firstMatch.index) {
        firstMatch = {
          index: boldMatch.index,
          length: boldMatch[0].length,
          node: <strong key={`b${keyIdx++}`}>{boldMatch[1]}</strong>,
        };
      }
    }

    if (!firstMatch) {
      parts.push(remaining);
      break;
    }

    if (firstMatch.index > 0) {
      parts.push(remaining.slice(0, firstMatch.index));
    }
    parts.push(firstMatch.node);
    remaining = remaining.slice(firstMatch.index + firstMatch.length);
  }

  return parts;
}

function DescriptionReadView({ lines, collapsed, onExpand }: Readonly<{
  lines: ReadonlyArray<string>;
  collapsed: boolean;
  onExpand: () => void;
}>) {
  const displayLines = collapsed ? lines.slice(0, 6) : lines;

  return (
    <div className="space-y-0 px-5 py-4 text-sm leading-relaxed text-foreground/90">
      {displayLines.map((line, idx) => {
        const trimmed = line.trimStart();
        const key = `l${idx}`;

        if (trimmed.length === 0) {
          return <div key={key} className="h-2" />;
        }

        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={key} className="mt-3 mb-1.5 text-sm font-bold text-foreground first:mt-0">
              {trimmed.slice(3)}
            </h3>
          );
        }

        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={key} className="mt-2.5 mb-1 text-[13px] font-semibold text-foreground first:mt-0">
              {trimmed.slice(4)}
            </h4>
          );
        }

        if (trimmed.startsWith("# ")) {
          return (
            <h2 key={key} className="mt-3 mb-1.5 text-base font-bold text-foreground first:mt-0">
              {trimmed.slice(2)}
            </h2>
          );
        }

        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          const indent = line.length - trimmed.length;
          let ml = "";
          if (indent >= 4) ml = "ml-6";
          else if (indent >= 2) ml = "ml-3";
          return (
            <div key={key} className={`flex items-start gap-2 py-0.5 ${ml}`}>
              <span className="mt-[8px] block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <span className="min-w-0">{renderMarkdownLine(trimmed.slice(2))}</span>
            </div>
          );
        }

        if (/^\d+\)\s/.test(trimmed)) {
          const match = /^(\d+)\)\s(.*)/.exec(trimmed);
          if (match) {
            return (
              <div key={key} className="flex items-start gap-2 py-0.5">
                <span className="shrink-0 text-muted-foreground">{match[1]}.</span>
                <span className="min-w-0">{renderMarkdownLine(match[2] ?? "")}</span>
              </div>
            );
          }
        }

        return (
          <p key={key} className="py-0.5">
            {renderMarkdownLine(line)}
          </p>
        );
      })}

      {collapsed && lines.length > 6 ? (
        <button
          type="button"
          onClick={onExpand}
          className="mt-2 cursor-pointer text-xs font-medium text-primary/70 transition-colors hover:text-primary"
        >
          ... mostrar tudo ({lines.length} linhas)
        </button>
      ) : null}
    </div>
  );
}

interface DescriptionPanelProps {
  readonly goalId: string;
  readonly description: string;
}

function DescriptionPanel({ goalId, description }: DescriptionPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateGoal = useUpdateGoal();

  const lines = description.split("\n");

  const startEditing = useCallback(() => {
    setDraft(description);
    setEditing(true);
    setCollapsed(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [description]);

  const cancelEditing = useCallback(() => {
    setDraft(description);
    setEditing(false);
  }, [description]);

  const saveDescription = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed === description.trim()) {
      setEditing(false);
      return;
    }
    updateGoal.mutate(
      { id: goalId, description: trimmed },
      { onSuccess: () => setEditing(false) },
    );
  }, [draft, description, goalId, updateGoal]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      cancelEditing();
    }
    if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveDescription();
    }
  }, [cancelEditing, saveDescription]);

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Descrição</h3>
          {editing ? null : (
            <span className="text-[10px] text-muted-foreground/60">duplo-clique para editar</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                onClick={cancelEditing}
                disabled={updateGoal.isPending}
              >
                <X className="h-3.5 w-3.5" />
                Cancelar
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={saveDescription}
                disabled={updateGoal.isPending}
              >
                {updateGoal.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Salvar
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={startEditing}
                className="cursor-pointer rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCollapsed((prev) => !prev)}
                className="cursor-pointer text-xs font-medium text-primary/70 transition-colors hover:text-primary"
              >
                {collapsed ? "Expandir" : "Recolher"}
              </button>
            </>
          )}
        </div>
      </div>
      <CardContent className="p-0" onDoubleClick={editing ? undefined : startEditing}>
        {editing ? (
          <div className="px-4 py-3">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full min-h-[200px] max-h-[60vh] resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              spellCheck={false}
            />
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Ctrl+S para salvar · Esc para cancelar
            </p>
          </div>
        ) : (
          <DescriptionReadView
            lines={lines}
            collapsed={collapsed}
            onExpand={() => setCollapsed(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function CodeChangeRow({ codeChange }: Readonly<{ codeChange: GoalCodeChange }>) {
  const [expanded, setExpanded] = useState(false);
  const variant = CODE_CHANGE_VARIANT_MAP[codeChange.status] ?? "secondary";
  const dotColor = CODE_CHANGE_DOT_COLOR[codeChange.status] ?? "bg-zinc-400";
  const { summary, details } = parseDescription(codeChange.description);
  const files = parseFilesChanged(codeChange.files_changed);
  const riskCfg = getRiskConfig(codeChange.risk);
  const hasExpandableContent = details.length > 0 || files.length > 0;
  const filesLabel = files.length === 1 ? "arquivo" : "arquivos";

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] font-medium leading-relaxed text-foreground">
              {summary}
            </p>
            <Badge variant={variant} className="mt-0.5 shrink-0 text-[10px]">
              {STATUS_LABEL[codeChange.status] ?? codeChange.status}
            </Badge>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${riskCfg.bg} ${riskCfg.color}`}>
              <ShieldAlert className="h-3 w-3" />
              Risco {codeChange.risk} - {riskCfg.label}
            </span>
            {codeChange.branch_name ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <GitBranch className="h-3 w-3" />
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                  {codeChange.branch_name}
                </code>
              </span>
            ) : null}
            <span className="text-[11px] text-muted-foreground">
              {formatDate(codeChange.created_at)}
            </span>
          </div>

          {hasExpandableContent ? (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-primary/70 transition-colors hover:text-primary"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "Menos detalhes" : "Mais detalhes"}
              {files.length > 0 ? ` · ${files.length} ${filesLabel}` : ""}
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-dashed bg-muted/20 px-4 pb-3.5 pt-3">
          <div className="ml-[22px] space-y-3">
            {details.map((section) => (
              <div key={section.label}>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </p>
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground/80"
                    >
                      <span className="mt-[7px] block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
                      <span className="min-w-0 wrap-break-word font-mono text-[11px]">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {files.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Arquivos alterados
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {files.map((file) => (
                    <span
                      key={file}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      <FileText className="h-2.5 w-2.5" />
                      {file}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CodeChangesPanel({
  codeChanges,
}: Readonly<{ codeChanges: ReadonlyArray<GoalCodeChange> }>) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Code Changes</h3>
        </div>
        <Badge variant="secondary" className="text-xs">
          {codeChanges.length}
        </Badge>
      </div>
      {codeChanges.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted-foreground">
          <FileCode className="h-8 w-8 opacity-30" />
          <p className="text-sm">Nenhuma alteracao de codigo vinculada</p>
        </div>
      ) : (
        <div>{codeChanges.map((cc) => <CodeChangeRow key={cc.id} codeChange={cc} />)}</div>
      )}
    </Card>
  );
}

function TokenUsagePanel({
  tokenUsage,
  latestBranch,
}: Readonly<{ tokenUsage: ReadonlyArray<GoalTokenUsage>; latestBranch: string | null }>) {
  const totalTokens = tokenUsage.reduce((sum, u) => sum + u.total_tokens, 0);
  const totalExecs = tokenUsage.reduce((sum, u) => sum + u.executions, 0);

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Uso de Recursos</h3>
        </div>
        <Badge variant="secondary" className="text-xs">
          {totalExecs} exec
        </Badge>
      </div>
      {latestBranch ? (
        <div className="flex items-center gap-1.5 border-b px-4 py-2 text-xs text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <code className="truncate font-mono text-[11px]">{latestBranch}</code>
        </div>
      ) : null}
      {tokenUsage.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted-foreground">
          <Activity className="h-8 w-8 opacity-30" />
          <p className="text-sm">Nenhuma execucao registrada</p>
        </div>
      ) : (
        <div>
          <div className="border-b bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
            Total: <span className="font-semibold text-foreground">{formatTokens(totalTokens)}</span> tokens
            em <span className="font-semibold text-foreground">{totalExecs}</span> execucoes
          </div>
          {tokenUsage.map((usage) => (
            <div
              key={usage.agent_id}
              className="flex items-center justify-between border-b px-4 py-2.5 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{usage.agent_id}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{usage.executions} exec</span>
                <span className="font-medium text-foreground">
                  {formatTokens(usage.total_tokens)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function GoalDetail() {
  const { goalId } = useParams<{ goalId: string }>();
  const { data, isLoading, error } = useGoalDetails(goalId ?? null);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">Erro ao carregar objetivo</p>
        <Link to="/kanban" className="text-sm text-primary underline">
          Voltar ao Kanban
        </Link>
      </div>
    );
  }

  const { goal, codeChanges, tokenUsage } = data;
  const statusColor = STATUS_COLOR[goal.status] ?? "bg-zinc-400";
  const priorityColor = PRIORITY_COLOR[goal.priority] ?? "border-zinc-400 text-zinc-500";

  const progress = computeProgress(codeChanges);
  const latestBranch = codeChanges.find((cc) => cc.branch_name)?.branch_name ?? null;

  return (
    <div className="space-y-4">
      <Breadcrumb goalTitle={goal.title} />

      <div className="flex items-start gap-3">
        <div className={`mt-1 h-4 w-1 shrink-0 rounded-full ${statusColor}`} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-snug md:text-2xl">{goal.title}</h1>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          {goal.description ? (
            <DescriptionPanel goalId={goal.id} description={goal.description} />
          ) : null}
          <ProgressBar counts={progress} />
          <CodeChangesPanel codeChanges={codeChanges} />
          <TokenUsagePanel tokenUsage={tokenUsage} latestBranch={latestBranch} />
        </div>

        <aside className="space-y-1">
          <Card>
            <CardContent className="divide-y p-4">
              <MetadataField icon={<Target className="h-4 w-4" />} label="Status">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${statusColor}`} />
                  <span className="text-sm font-medium">
                    {STATUS_LABEL[goal.status] ?? goal.status}
                  </span>
                </div>
              </MetadataField>

              <MetadataField icon={<AlertCircle className="h-4 w-4" />} label="Prioridade">
                <Badge variant="outline" className={`text-xs ${priorityColor}`}>
                  P{goal.priority} - {PRIORITY_LABEL[goal.priority] ?? "N/A"}
                </Badge>
              </MetadataField>

              {goal.project_id ? (
                <MetadataField icon={<FolderGit2 className="h-4 w-4" />} label="Projeto">
                  <span className="text-sm">{goal.project_id}</span>
                </MetadataField>
              ) : null}

              <MetadataField icon={<Calendar className="h-4 w-4" />} label="Criado em">
                <span className="text-sm">{formatShortDate(goal.created_at)}</span>
              </MetadataField>

              <MetadataField icon={<Calendar className="h-4 w-4" />} label="Atualizado em">
                <span className="text-sm">{formatShortDate(goal.updated_at)}</span>
              </MetadataField>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Resumo
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                  <p className="text-lg font-bold">{progress.total}</p>
                  <p className="text-[10px] text-muted-foreground">Changes</p>
                </div>
                <div className="rounded-md bg-emerald-50 px-3 py-2 text-center">
                  <p className="text-lg font-bold text-emerald-600">{progress.applied}</p>
                  <p className="text-[10px] text-muted-foreground">Aplicadas</p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                  <p className="text-lg font-bold">
                    {formatTokens(tokenUsage.reduce((s, u) => s + u.total_tokens, 0))}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Tokens</p>
                </div>
                <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                  <p className="text-lg font-bold">
                    {tokenUsage.reduce((s, u) => s + u.executions, 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Execucoes</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
