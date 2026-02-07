import { ArrowLeft } from "lucide-react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { BottomNav } from "@/components/layout/BottomNav";
import { Button } from "@/components/ui/button";
import { useData } from "@/data/DataContext";

function titleForPath(pathname: string) {
  if (pathname.startsWith("/items/")) return "Item";
  if (pathname.startsWith("/rooms/")) return "Room";
  switch (pathname) {
    case "/shopping":
      return "Shopping Mode";
    case "/items":
      return "Items";
    case "/rooms":
      return "Rooms";
    case "/review":
      return "Review";
    case "/budget":
      return "Budget";
    case "/settings":
      return "Settings";
    default:
      return "2B Furnishing Tracker";
  }
}

export function AppShell() {
  const { home } = useData();
  const nav = useNavigate();
  const loc = useLocation();

  const title = titleForPath(loc.pathname);
  const showBack = loc.pathname.startsWith("/items/") || (loc.pathname.startsWith("/rooms/") && loc.pathname !== "/rooms");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {showBack ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={() => nav(-1)}
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          ) : (
            <div className="h-10 w-10" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm text-muted-foreground">{home?.name || "Home"}</div>
            <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-4">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
