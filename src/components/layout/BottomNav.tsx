import type { ComponentType } from "react";
import { AlertTriangle, DollarSign, LayoutGrid, ListChecks, Settings, ShoppingBag } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { to: "/shopping", label: "Shop", icon: ShoppingBag },
  { to: "/items", label: "Items", icon: ListChecks },
  { to: "/rooms", label: "Rooms", icon: LayoutGrid },
  { to: "/review", label: "Review", icon: AlertTriangle },
  { to: "/budget", label: "Budget", icon: DollarSign },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex max-w-3xl pb-[env(safe-area-inset-bottom)]">
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 px-2 py-3 text-xs text-muted-foreground",
                "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              activeClassName="text-foreground"
            >
              <Icon className="h-5 w-5" />
              <span className="leading-none">{n.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
