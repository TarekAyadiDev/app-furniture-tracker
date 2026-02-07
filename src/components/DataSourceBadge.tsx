import type { DataSource } from "@/lib/domain";
import { cn } from "@/lib/utils";

const STYLES: Record<Exclude<DataSource, null>, string> = {
  concrete: "bg-emerald-50 text-emerald-900 border-emerald-200",
  estimated: "bg-slate-50 text-slate-900 border-slate-200",
};

const LABELS: Record<Exclude<DataSource, null>, string> = {
  concrete: "Concrete",
  estimated: "Estimated",
};

export function DataSourceBadge({
  dataSource,
  showUnknown,
  className,
}: {
  dataSource: DataSource | undefined;
  showUnknown?: boolean;
  className?: string;
}) {
  if (!dataSource) {
    if (!showUnknown) return null;
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground",
          className,
        )}
      >
        Source unknown
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        STYLES[dataSource],
        className,
      )}
    >
      {LABELS[dataSource]}
    </span>
  );
}

