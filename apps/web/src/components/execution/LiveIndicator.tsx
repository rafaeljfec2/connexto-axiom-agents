import type { ConnectionStatus } from "@/api/useEventSource";
import { Badge } from "@/components/ui/badge";
import { Radio, WifiOff } from "lucide-react";

interface LiveIndicatorProps {
  readonly status: ConnectionStatus;
}

export function LiveIndicator({ status }: LiveIndicatorProps) {
  if (status === "open") {
    return (
      <Badge variant="success" className="flex items-center gap-1.5">
        <Radio className="h-3 w-3 animate-pulse" />
        <span className="text-xs">Live</span>
      </Badge>
    );
  }

  if (status === "connecting") {
    return (
      <Badge variant="warning" className="flex items-center gap-1.5">
        <Radio className="h-3 w-3 animate-pulse" />
        <span className="text-xs">Conectando...</span>
      </Badge>
    );
  }

  if (status === "error") {
    return (
      <Badge variant="destructive" className="flex items-center gap-1.5">
        <WifiOff className="h-3 w-3" />
        <span className="text-xs">Reconectando...</span>
      </Badge>
    );
  }

  return null;
}
