import { Badge } from "@/components/ui/badge";

const STATUS_MAP: Record<
  string,
  {
    readonly label: string;
    readonly variant: "success" | "destructive" | "warning" | "secondary" | "default";
  }
> = {
  success: { label: "SUCCESS", variant: "success" },
  failed: { label: "FAILURE", variant: "destructive" },
  infra_unavailable: { label: "INFRA", variant: "warning" },
  active: { label: "ACTIVE", variant: "success" },
  completed: { label: "DONE", variant: "secondary" },
  cancelled: { label: "CANCELLED", variant: "secondary" },
  pending_approval: { label: "PENDING", variant: "warning" },
  draft: { label: "DRAFT", variant: "warning" },
  approved: { label: "APPROVED", variant: "success" },
  rejected: { label: "REJECTED", variant: "destructive" },
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
