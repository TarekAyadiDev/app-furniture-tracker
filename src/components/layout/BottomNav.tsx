import type { ComponentType } from "react";
import { DollarSign, LayoutGrid, ListChecks, Settings, ShoppingBag, Star, Store } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { to: "/shopping", label: "Shop", icon: ShoppingBag },
  { to: "/items", label: "Items", icon: ListChecks },
  { to: "/stores", label: "Stores", icon: Store },
  { to: "/rooms", label: "Rooms", icon: LayoutGrid },
  { to: "/review", label: "Review", icon: Star },
  { to: "/budget", label: "Budget", icon: DollarSign },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/30 glass safe-bottom">
      <div className="mx-auto max-w-3xl">
        <div className="overflow-x-auto overflow-y-hidden px-1 py-2 [-webkit-overflow-scrolling:touch] [touch-action:pan-x]">
          <div className="flex min-w-full items-center gap-1">
            {NAV.map((n) => {
              const Icon = n.icon;
              const isActive = location.pathname === n.to || location.pathname.startsWith(n.to + "/");
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "relative flex shrink-0 flex-col items-center gap-1 rounded-2xl px-4 py-2 text-[10px] font-medium transition-all duration-300",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {/* Active background glow */}
                  {isActive && (
                    <span className="absolute inset-0 rounded-2xl bg-primary/10 animate-fade-in" />
                  )}
                  <Icon className={cn(
                    "relative h-5 w-5 transition-all duration-300",
                    isActive && "scale-110 stroke-[2.5]"
                  )} />
                  <span className="relative">{n.label}</span>
                  {/* Active indicator dot */}
                  {isActive && (
                    <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-primary" />
                  )}
                </NavLink>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
