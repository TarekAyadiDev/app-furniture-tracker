import type { ItemStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

const STYLES: Record<ItemStatus, string> = {
  Idea: "bg-slate-100 text-slate-800 border-slate-200",
  Shortlist: "bg-blue-50 text-blue-900 border-blue-200",
  Selected: "bg-teal-50 text-teal-900 border-teal-200",
  Ordered: "bg-amber-50 text-amber-900 border-amber-200",
  Delivered: "bg-green-50 text-green-900 border-green-200",
  Installed: "bg-emerald-50 text-emerald-900 border-emerald-200",
};

export function StatusBadge({ status, className }: { status: ItemStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        STYLES[status],
        className,
      )}
    >
      {status}
    </span>
  );
}

