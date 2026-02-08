import type { ItemStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

const STYLES: Record<ItemStatus, string> = {
  Idea: "bg-muted/80 text-muted-foreground",
  Shortlist: "bg-info/15 text-info",
  Selected: "bg-primary/15 text-primary",
  Ordered: "bg-warning/20 text-warning",
  Delivered: "bg-accent/20 text-accent",
  Installed: "bg-success/20 text-success",
};

interface StatusBadgeProps {
  status: ItemStatus;
  className?: string;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
}

export function StatusBadge({ status, className, selected, onClick, size = "md" }: StatusBadgeProps) {
  const isClickable = !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      className={cn(
        "inline-flex items-center rounded-full font-medium transition-all duration-200",
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3.5 py-1.5 text-sm",
        STYLES[status],
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-glow",
        isClickable
          ? "cursor-pointer hover:scale-105 active:scale-95"
          : "cursor-default",
        className,
      )}
    >
      {status}
    </button>
  );
}
