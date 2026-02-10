import { ArrowLeft, Sparkles } from "lucide-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { BottomNav } from "@/components/layout/BottomNav";
import { Button } from "@/components/ui/button";
import { useData } from "@/data/DataContext";

function titleForPath(pathname: string) {
  if (pathname.startsWith("/items/")) return "Item Details";
  if (pathname.startsWith("/rooms/")) return "Room Details";
  switch (pathname) {
    case "/shopping":
      return "Quick Add";
    case "/items":
      return "All Items";
    case "/rooms":
      return "Rooms";
    case "/review":
      return "Review";
    case "/stores":
      return "Stores";
    case "/budget":
      return "Budget";
    case "/settings":
      return "Settings";
    default:
      return "Town Hollywood";
  }
}

function subtitleForPath(pathname: string) {
  switch (pathname) {
    case "/shopping":
      return "2B/2B @ Town Hollywood ✨";
    case "/items":
      return "Furniture Collection";
    case "/rooms":
      return "Your Spaces";
    case "/budget":
      return "Investment Tracker";
    case "/review":
      return "Decision Time";
    case "/stores":
      return "Policies & Perks";
    case "/settings":
      return "Preferences";
    default:
      return "Your New Home Awaits";
  }
}

export function AppShell() {
  const { items, options } = useData();
  const nav = useNavigate();
  const loc = useLocation();

  const title = titleForPath(loc.pathname);
  const subtitle = subtitleForPath(loc.pathname);
  const showBack = loc.pathname.startsWith("/items/") || (loc.pathname.startsWith("/rooms/") && loc.pathname !== "/rooms");
  const isHome = loc.pathname === "/" || loc.pathname === "/shopping";
  const totalItems = items.filter((i) => i.syncState !== "deleted").length;
  const totalOptions = options.filter((o) => o.syncState !== "deleted").length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/50 glass">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          {showBack ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-xl transition-all duration-200 hover:bg-primary/10 hover:text-primary active:scale-95"
              onClick={() => nav(-1)}
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center">
              {isHome && (
                <Sparkles className="h-6 w-6 text-accent animate-pulse-glow" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {subtitle && (
              <p className="text-xs font-semibold uppercase tracking-widest text-primary/80">{subtitle}</p>
            )}
            <h1 className="truncate font-heading text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Items {totalItems} · Versions {totalOptions}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
