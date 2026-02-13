import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  readonly title: string;
  readonly value: string;
  readonly subtitle: string;
  readonly trend?: "up" | "down" | "neutral";
  readonly variant?: "success" | "warning" | "destructive" | "default";
}

function resolveBadgeVariant(
  variant: MetricCardProps["variant"],
): "secondary" | "destructive" | "success" {
  if (variant === "destructive") return "destructive";
  if (variant === "success" || variant === "warning") return "success";
  return "secondary";
}

function resolveBadgeLabel(variant: MetricCardProps["variant"]): string {
  if (variant === "success") return "OK";
  if (variant === "destructive") return "ALERT";
  return "—";
}

export function MetricCard({
  title,
  value,
  subtitle,
  variant = "default",
}: Readonly<MetricCardProps>) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
          <Badge variant={resolveBadgeVariant(variant)} className="text-xs">
            {resolveBadgeLabel(variant)}
          </Badge>
        </div>
        <div
          className={cn("mt-2 text-2xl font-bold", variant === "destructive" && "text-destructive")}
        >
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}
