import type { Actor, DataSource, Provenance, ProvenanceChangeLogEntry, ReviewStatus } from "@/lib/domain";

const ACTORS: Actor[] = ["human", "ai", "import", "system", null];
const DATA_SOURCES: DataSource[] = ["concrete", "estimated", null];
const REVIEW_STATUSES: ReviewStatus[] = ["needs_review", "verified", "ai_modified", null];

function isActor(value: unknown): value is Exclude<Actor, null> {
  return typeof value === "string" && (ACTORS as readonly unknown[]).includes(value);
}

function normalizeActor(value: unknown): Actor | undefined {
  if (value === null) return null;
  return isActor(value) ? (value as Actor) : undefined;
}

function normalizeDataSource(value: unknown): DataSource | undefined {
  if (value === null) return null;
  return typeof value === "string" && (DATA_SOURCES as readonly unknown[]).includes(value) ? (value as DataSource) : undefined;
}

function normalizeReviewStatus(value: unknown): ReviewStatus | undefined {
  if (value === null) return null;
  return typeof value === "string" && (REVIEW_STATUSES as readonly unknown[]).includes(value)
    ? (value as ReviewStatus)
    : undefined;
}

function normalizeOptionalTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStringOrNull(value: unknown): string | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : null;
}

function normalizeStringArrayOrNull(value: unknown): string[] | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const out = value.map((v) => String(v ?? "").trim()).filter(Boolean);
  return out.length ? out : [];
}

function normalizeChangeLog(value: unknown): ProvenanceChangeLogEntry[] | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const out: ProvenanceChangeLogEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.field !== "string" || !e.field.trim()) continue;
    const by = normalizeActor(e.by);
    const at = normalizeOptionalTimestamp(e.at);
    if (typeof by === "undefined" || typeof at === "undefined") continue;
    const sessionId = typeof e.sessionId === "string" && e.sessionId.trim() ? e.sessionId.trim() : undefined;
    out.push({
      field: e.field.trim(),
      from: e.from,
      to: e.to,
      by,
      at,
      sessionId,
    });
  }
  return out.length ? out : [];
}

export function sanitizeProvenance(input: unknown): Provenance | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const obj = input as Record<string, unknown>;

  const createdBy = normalizeActor(obj.createdBy);
  const createdAt = normalizeOptionalTimestamp(obj.createdAt);
  const lastEditedBy = normalizeActor(obj.lastEditedBy);
  const lastEditedAt = normalizeOptionalTimestamp(obj.lastEditedAt);
  const sourceRef = normalizeStringOrNull(obj.sourceRef);
  const dataSource = normalizeDataSource(obj.dataSource);
  const reviewStatus = normalizeReviewStatus(obj.reviewStatus);
  const verifiedAt =
    obj.verifiedAt === null ? null : typeof obj.verifiedAt === "number" && Number.isFinite(obj.verifiedAt) ? obj.verifiedAt : undefined;
  const verifiedBy = normalizeActor(obj.verifiedBy);
  const modifiedFields = normalizeStringArrayOrNull(obj.modifiedFields);
  const changeLog = normalizeChangeLog(obj.changeLog);

  const out: Provenance = {};
  if (typeof createdBy !== "undefined") out.createdBy = createdBy;
  if (typeof createdAt !== "undefined") out.createdAt = createdAt;
  if (typeof lastEditedBy !== "undefined") out.lastEditedBy = lastEditedBy;
  if (typeof lastEditedAt !== "undefined") out.lastEditedAt = lastEditedAt;
  if (typeof sourceRef !== "undefined") out.sourceRef = sourceRef;
  if (typeof dataSource !== "undefined") out.dataSource = dataSource;
  if (typeof reviewStatus !== "undefined") out.reviewStatus = reviewStatus;
  if (typeof verifiedAt !== "undefined") out.verifiedAt = verifiedAt;
  if (typeof verifiedBy !== "undefined") out.verifiedBy = verifiedBy;
  if (typeof modifiedFields !== "undefined") out.modifiedFields = modifiedFields;
  if (typeof changeLog !== "undefined") out.changeLog = changeLog;

  return Object.keys(out).length ? out : undefined;
}

export function reviewStatusNeedsAttention(status: ReviewStatus | undefined): boolean {
  return status === "needs_review" || status === "ai_modified";
}

export function markProvenanceVerified(input: Provenance | undefined, at: number): Provenance {
  const base = sanitizeProvenance(input) ?? {};
  return {
    ...base,
    lastEditedBy: "human",
    lastEditedAt: at,
    reviewStatus: "verified",
    verifiedAt: at,
    verifiedBy: "human",
    modifiedFields: null,
  };
}

export function markProvenanceNeedsReview(input: Provenance | undefined, at: number): Provenance {
  const base = sanitizeProvenance(input) ?? {};
  return {
    ...base,
    lastEditedBy: "human",
    lastEditedAt: at,
    reviewStatus: "needs_review",
    verifiedAt: null,
    verifiedBy: null,
  };
}
