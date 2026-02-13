import { Badge } from "@/components/ui/badge";

const STATUS_MAP: Record<
  string,
  {
    readonly label: string;
    readonly variant: "success" | "destructive" | "warning" | "secondary" | "default";
  }
> = {
  success: { label: "SUCESSO", variant: "success" },
  failed: { label: "FALHA", variant: "destructive" },
  infra_unavailable: { label: "INFRA", variant: "warning" },
  active: { label: "ATIVO", variant: "success" },
  completed: { label: "CONCLUÍDO", variant: "secondary" },
  cancelled: { label: "CANCELADO", variant: "secondary" },
  pending_approval: { label: "PENDENTE", variant: "warning" },
  draft: { label: "RASCUNHO", variant: "warning" },
  approved: { label: "APROVADO", variant: "success" },
  rejected: { label: "REJEITADO", variant: "destructive" },
};

interface StatusBadgeProps {
  readonly status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? {
    label: status.toUpperCase(),
    variant: "secondary" as const,
  };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
