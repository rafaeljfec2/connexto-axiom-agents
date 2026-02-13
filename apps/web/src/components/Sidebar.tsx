import { NavLink } from "react-router-dom";
import { LayoutDashboard, Columns3, Bot, History } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  readonly onNavigate?: () => void;
}

const NAV_ITEMS = [
  { to: "/", label: "Resumo Diário", icon: LayoutDashboard },
  { to: "/kanban", label: "Quadro Kanban", icon: Columns3 },
  { to: "/agents", label: "Agentes", icon: Bot },
  { to: "/historico", label: "Histórico", icon: History },
] as const;

export function Sidebar({ onNavigate }: SidebarProps) {
  return (
    <nav className="flex flex-col gap-1 p-3">
      <div className="mb-4 flex items-center gap-2 px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
          A
        </div>
        <span className="text-lg font-semibold tracking-tight">Axiom</span>
      </div>

      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          end={item.to === "/"}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )
          }
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
