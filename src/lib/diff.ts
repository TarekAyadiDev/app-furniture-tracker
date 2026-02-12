import type { Item, Measurement, Option, Room, Store, SubItem } from "@/lib/domain";
import {
  ITEM_TRACKED_FIELDS,
  MEASUREMENT_TRACKED_FIELDS,
  OPTION_TRACKED_FIELDS,
  SUB_ITEM_TRACKED_FIELDS,
  ROOM_TRACKED_FIELDS,
  STORE_TRACKED_FIELDS,
  type TrackedFieldSpec,
  normalizeOptionalString,
  normalizeString,
} from "@/lib/trackedFields";

export type DiffChange = {
  field: string;
  from: unknown;
  to: unknown;
};

function normalizeNullish(value: unknown): unknown {
  return typeof value === "undefined" ? null : value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeNullish(a);
  const nb = normalizeNullish(b);

  if (Number.isNaN(na) && Number.isNaN(nb)) return true;
  return Object.is(na, nb);
}

export function diffBySpecs<T>(existing: T, incoming: T, specs: TrackedFieldSpec<T>[]): DiffChange[] {
  const changes: DiffChange[] = [];
  for (const spec of specs) {
    const normalize = spec.normalize ?? ((v: unknown) => v);
    const from = normalize(spec.get(existing));
    const to = normalize(spec.get(incoming));
    if (!valuesEqual(from, to)) changes.push({ field: spec.field, from, to });
  }
  return changes;
}

function normalizeSpecValue(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value === "string") return normalizeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return normalizeOptionalString(value);
}

function diffItemSpecs(existing: Item, incoming: Item): DiffChange[] {
  const a = existing.specs && typeof existing.specs === "object" ? existing.specs : null;
  const b = incoming.specs && typeof incoming.specs === "object" ? incoming.specs : null;

  const keys = new Set<string>([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const changes: DiffChange[] = [];
  for (const key of [...keys].sort()) {
    const from = normalizeSpecValue(a ? (a as any)[key] : null);
    const to = normalizeSpecValue(b ? (b as any)[key] : null);
    if (!valuesEqual(from, to)) changes.push({ field: `specs.${key}`, from, to });
  }
  return changes;
}

function diffOptionSpecs(existing: Option, incoming: Option): DiffChange[] {
  const a = existing.specs && typeof existing.specs === "object" ? existing.specs : null;
  const b = incoming.specs && typeof incoming.specs === "object" ? incoming.specs : null;

  const keys = new Set<string>([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const changes: DiffChange[] = [];
  for (const key of [...keys].sort()) {
    const from = normalizeSpecValue(a ? (a as any)[key] : null);
    const to = normalizeSpecValue(b ? (b as any)[key] : null);
    if (!valuesEqual(from, to)) changes.push({ field: `specs.${key}`, from, to });
  }
  return changes;
}

export function diffMeasurement(existing: Measurement, incoming: Measurement): DiffChange[] {
  return diffBySpecs(existing, incoming, MEASUREMENT_TRACKED_FIELDS);
}

export function diffItem(existing: Item, incoming: Item): DiffChange[] {
  return [...diffBySpecs(existing, incoming, ITEM_TRACKED_FIELDS), ...diffItemSpecs(existing, incoming)];
}

export function diffOption(existing: Option, incoming: Option): DiffChange[] {
  return [...diffBySpecs(existing, incoming, OPTION_TRACKED_FIELDS), ...diffOptionSpecs(existing, incoming)];
}

export function diffSubItem(existing: SubItem, incoming: SubItem): DiffChange[] {
  return diffBySpecs(existing, incoming, SUB_ITEM_TRACKED_FIELDS);
}

export function diffRoom(existing: Room, incoming: Room): DiffChange[] {
  return diffBySpecs(existing, incoming, ROOM_TRACKED_FIELDS);
}

export function diffStore(existing: Store, incoming: Store): DiffChange[] {
  return diffBySpecs(existing, incoming, STORE_TRACKED_FIELDS);
}
