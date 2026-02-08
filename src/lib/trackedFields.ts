import type { DataSource, Item, Measurement, Option, Room } from "@/lib/domain";

export type TrackedFieldSpec<T> = {
  field: string;
  get: (entity: T) => unknown;
  normalize?: (value: unknown) => unknown;
};

export function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeOptionalString(value: unknown): string | null {
  if (value === null || typeof value === "undefined") return null;
  const t = String(value).trim();
  return t ? t : null;
}

export function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || typeof value === "undefined") return null;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim() || "NaN")
        : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

export function normalizeStringArray(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const cleaned = value
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return cleaned.join("|");
}

export function normalizeBoolean(value: unknown): boolean {
  return Boolean(value);
}

export function normalizeMeasurementConfidence(value: unknown): Measurement["confidence"] {
  const t = String(value ?? "").trim();
  return t === "low" || t === "med" || t === "high" ? (t as Measurement["confidence"]) : null;
}

export function normalizeDataSource(value: unknown): DataSource {
  const t = String(value ?? "").trim();
  return t === "concrete" || t === "estimated" ? (t as DataSource) : null;
}

export const MEASUREMENT_TRACKED_FIELDS: TrackedFieldSpec<Measurement>[] = [
  { field: "room", get: (m) => m.room, normalize: normalizeString },
  { field: "label", get: (m) => m.label, normalize: normalizeString },
  { field: "valueIn", get: (m) => m.valueIn, normalize: normalizeOptionalNumber },
  { field: "sort", get: (m) => m.sort, normalize: normalizeOptionalNumber },
  { field: "confidence", get: (m) => m.confidence, normalize: normalizeMeasurementConfidence },
  { field: "forCategory", get: (m) => m.forCategory, normalize: normalizeOptionalString },
  { field: "forItemId", get: (m) => m.forItemId, normalize: normalizeOptionalString },
  { field: "notes", get: (m) => m.notes, normalize: normalizeOptionalString },
  { field: "provenance.dataSource", get: (m) => m.provenance?.dataSource, normalize: normalizeDataSource },
  { field: "provenance.sourceRef", get: (m) => m.provenance?.sourceRef, normalize: normalizeOptionalString },
];

export const ITEM_TRACKED_FIELDS: TrackedFieldSpec<Item>[] = [
  { field: "name", get: (i) => i.name, normalize: normalizeString },
  { field: "room", get: (i) => i.room, normalize: normalizeString },
  { field: "category", get: (i) => i.category, normalize: normalizeString },
  { field: "status", get: (i) => i.status, normalize: normalizeString },
  { field: "selectedOptionId", get: (i) => i.selectedOptionId, normalize: normalizeOptionalString },
  { field: "sort", get: (i) => i.sort, normalize: normalizeOptionalNumber },
  { field: "price", get: (i) => i.price, normalize: normalizeOptionalNumber },
  { field: "qty", get: (i) => i.qty, normalize: normalizeOptionalNumber },
  { field: "store", get: (i) => i.store, normalize: normalizeOptionalString },
  { field: "link", get: (i) => i.link, normalize: normalizeOptionalString },
  { field: "notes", get: (i) => i.notes, normalize: normalizeOptionalString },
  { field: "priority", get: (i) => i.priority, normalize: normalizeOptionalNumber },
  { field: "tags", get: (i) => i.tags, normalize: normalizeStringArray },
  { field: "dimensions.wIn", get: (i) => i.dimensions?.wIn, normalize: normalizeOptionalNumber },
  { field: "dimensions.hIn", get: (i) => i.dimensions?.hIn, normalize: normalizeOptionalNumber },
  { field: "dimensions.dIn", get: (i) => i.dimensions?.dIn, normalize: normalizeOptionalNumber },
  { field: "provenance.dataSource", get: (i) => i.provenance?.dataSource, normalize: normalizeDataSource },
  { field: "provenance.sourceRef", get: (i) => i.provenance?.sourceRef, normalize: normalizeOptionalString },
  // NOTE: specs are compared per-key in diff logic (see src/lib/diff.ts).
];

export const OPTION_TRACKED_FIELDS: TrackedFieldSpec<Option>[] = [
  { field: "itemId", get: (o) => o.itemId, normalize: normalizeString },
  { field: "title", get: (o) => o.title, normalize: normalizeString },
  { field: "sort", get: (o) => o.sort, normalize: normalizeOptionalNumber },
  { field: "store", get: (o) => o.store, normalize: normalizeOptionalString },
  { field: "link", get: (o) => o.link, normalize: normalizeOptionalString },
  { field: "promoCode", get: (o) => o.promoCode, normalize: normalizeOptionalString },
  { field: "price", get: (o) => o.price, normalize: normalizeOptionalNumber },
  { field: "shipping", get: (o) => o.shipping, normalize: normalizeOptionalNumber },
  { field: "taxEstimate", get: (o) => o.taxEstimate, normalize: normalizeOptionalNumber },
  { field: "discount", get: (o) => o.discount, normalize: normalizeOptionalNumber },
  { field: "dimensionsText", get: (o) => o.dimensionsText, normalize: normalizeOptionalString },
  { field: "dimensions.wIn", get: (o) => o.dimensions?.wIn, normalize: normalizeOptionalNumber },
  { field: "dimensions.hIn", get: (o) => o.dimensions?.hIn, normalize: normalizeOptionalNumber },
  { field: "dimensions.dIn", get: (o) => o.dimensions?.dIn, normalize: normalizeOptionalNumber },
  { field: "notes", get: (o) => o.notes, normalize: normalizeOptionalString },
  { field: "priority", get: (o) => o.priority, normalize: normalizeOptionalNumber },
  { field: "tags", get: (o) => o.tags, normalize: normalizeStringArray },
  { field: "selected", get: (o) => o.selected, normalize: normalizeBoolean },
  { field: "sourceItemId", get: (o) => o.sourceItemId, normalize: normalizeOptionalString },
  { field: "provenance.dataSource", get: (o) => o.provenance?.dataSource, normalize: normalizeDataSource },
  { field: "provenance.sourceRef", get: (o) => o.provenance?.sourceRef, normalize: normalizeOptionalString },
];

export const ROOM_TRACKED_FIELDS: TrackedFieldSpec<Room>[] = [
  { field: "name", get: (r) => r.name, normalize: normalizeString },
  { field: "sort", get: (r) => r.sort, normalize: normalizeOptionalNumber },
  { field: "notes", get: (r) => r.notes, normalize: normalizeOptionalString },
  { field: "provenance.dataSource", get: (r) => r.provenance?.dataSource, normalize: normalizeDataSource },
  { field: "provenance.sourceRef", get: (r) => r.provenance?.sourceRef, normalize: normalizeOptionalString },
];
