import type { ReviewStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

const STYLES: Record<Exclude<ReviewStatus, null>, string> = {
  needs_review: "bg-amber-50 text-amber-900 border-amber-200",
  ai_modified: "bg-violet-50 text-violet-900 border-violet-200",
  verified: "bg-emerald-50 text-emerald-900 border-emerald-200",
};

const LABELS: Record<Exclude<ReviewStatus, null>, string> = {
  needs_review: "Needs review",
  ai_modified: "AI modified",
  verified: "Verified",
};

export function ReviewStatusBadge({ status, className }: { status: ReviewStatus | undefined; className?: string }) {
  if (!status) return null;
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", STYLES[status], className)}
    >
      {LABELS[status]}
    </span>
  );
}

