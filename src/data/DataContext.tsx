import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Actor, ExportBundleV1, ExportBundleV2, Item, Measurement, Option, PlannerAttachmentV1, Provenance, Room, RoomId, Store } from "@/lib/domain";
import { DEFAULT_ROOMS, ITEM_STATUSES } from "@/lib/domain";
import { nowMs, parseNumberOrNull } from "@/lib/format";
import { diffItem, diffMeasurement, diffOption, diffStore } from "@/lib/diff";
import { newId } from "@/lib/id";
import { sanitizeProvenance } from "@/lib/provenance";
import { DEFAULT_HOME, makeDefaultRooms } from "@/data/seed";
import {
  idbBulkPut,
  idbDelete,
  idbGetAll,
  idbGetAllByIndex,
  idbGetSnapshot,
  idbPut,
  idbResetAll,
  idbSetMeta,
} from "@/storage/idb";
import { notifyDbChanged, subscribeDbChanges } from "@/storage/notify";
import { getTownHollywoodExampleBundle } from "@/examples/town-hollywood";
import { buildRoomNameMap, ensureRoomNames, normalizeRoomName, orderRooms } from "@/lib/rooms";
import { buildStoreIndex, normalizeStoreName, optionTotalWithStore, orderStores, storeKey } from "@/lib/storePricing";
import { moveAttachmentsParent, type AttachmentRecord } from "@/storage/attachments";

type HomeMeta = NonNullable<ExportBundleV1["home"]>;

type PlannerMeta = PlannerAttachmentV1 | null;

type UnitPreference = "in" | "cm";

type SyncSummary = {
  push: Record<string, number>;
  pull: Record<string, number>;
};

type OptionSortKey = "price" | "priority" | "name";
type OptionSortDir = "asc" | "desc";

type AttachmentMeta = {
  id: string;
  url: string;
  name: string | null;
  mime: string | null;
  size: number | null;
  createdAt: number;
  updatedAt: number;
};

type UpdateOptionFn = {
  (id: string, patch: Partial<Option>): Promise<void>;
  (parentItemId: string, optionId: string, patch: Partial<Option>): Promise<void>;
};

type DataContextValue = {
  ready: boolean;
  home: HomeMeta;
  planner: PlannerMeta;
  rooms: Room[];
  orderedRooms: Room[];
  roomNameById: Map<RoomId, string>;
  measurements: Measurement[];
  items: Item[];
  options: Option[];
  stores: Store[];
  orderedStores: Store[];
  unitPreference: UnitPreference;
  lastSyncAt: number | null;
  lastSyncSummary: SyncSummary | null;
  dirtyCounts: { items: number; options: number; measurements: number; rooms: number; stores: number };

  saveHome: (home: HomeMeta) => Promise<void>;
  savePlanner: (planner: PlannerMeta) => Promise<void>;
  setUnitPreference: (unit: UnitPreference) => Promise<void>;

  reorderRooms: (orderedRoomIds: RoomId[]) => Promise<void>;
  reorderStores: (orderedStoreIds: string[]) => Promise<void>;
  reorderItems: (roomId: RoomId, orderedItemIds: string[]) => Promise<void>;
  reorderMeasurements: (roomId: RoomId, orderedMeasurementIds: string[]) => Promise<void>;
  reorderOptions: (itemId: string, orderedOptionIds: string[]) => Promise<void>;
  renameCategory: (oldName: string, newName: string) => Promise<void>;

  createRoom: (name: string) => Promise<RoomId | null>;
  deleteRoom: (id: RoomId, opts?: { moveTo?: RoomId }) => Promise<void>;

  createItem: (partial: Partial<Item>) => Promise<string>;
  updateItem: (id: string, patch: Partial<Item>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  convertItemToOption: (parentItemId: string, sourceItemId: string) => Promise<void>;

  createOption: (partial: Partial<Option> & { itemId: string }) => Promise<string>;
  updateOption: UpdateOptionFn;
  deleteOption: (id: string) => Promise<void>;
  sortAndFilterOptions: (
    parentItemId: string,
    opts: { sortKey: OptionSortKey; sortDir: OptionSortDir; minPrice?: number | null; maxPrice?: number | null },
  ) => Option[];

  createMeasurement: (partial: Partial<Measurement> & { room: RoomId }) => Promise<string>;
  updateMeasurement: (id: string, patch: Partial<Measurement>) => Promise<void>;
  deleteMeasurement: (id: string) => Promise<void>;

  updateRoom: (id: RoomId, patch: Partial<Room>) => Promise<void>;

  createStore: (name: string) => Promise<string | null>;
  updateStore: (id: string, patch: Partial<Store>) => Promise<void>;
  deleteStore: (id: string) => Promise<void>;

  exportBundle: (opts?: { includeDeleted?: boolean }) => Promise<ExportBundleV2>;
  importBundle: (bundle: unknown, opts?: { mode?: "merge" | "replace"; aiAssisted?: boolean }) => Promise<void>;
  resetLocal: () => Promise<void>;
  loadExampleTownHollywood: (mode?: "merge" | "replace") => Promise<void>;
};

const DataContext = createContext<DataContextValue | null>(null);

function sanitizeHomeMeta(input: unknown): HomeMeta {
  const base = { ...DEFAULT_HOME };
  if (!input || typeof input !== "object") return base;
  const obj = input as Record<string, unknown>;
  if (typeof obj.name === "string" && obj.name.trim()) base.name = obj.name.trim();
  if (Array.isArray(obj.tags)) base.tags = obj.tags.map(String).filter(Boolean);
  if (typeof obj.description === "string") base.description = obj.description;
  return base;
}

function sanitizePlannerMeta(input: unknown): PlannerMeta {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const version = obj.version === 1 ? 1 : null;
  const mergedAt = typeof obj.mergedAt === "string" && obj.mergedAt.trim() ? obj.mergedAt : new Date().toISOString();
  const template = obj.template ?? null;
  if (version !== 1) {
    // If a raw planner JSON was stored directly, wrap it.
    return { version: 1, mergedAt, template: input };
  }
  return { version: 1, mergedAt, template };
}

function sanitizeUnitPreference(input: unknown): UnitPreference {
  return input === "cm" ? "cm" : "in";
}

function sanitizeSyncSummary(input: unknown): SyncSummary | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const push = obj.push && typeof obj.push === "object" && !Array.isArray(obj.push) ? (obj.push as Record<string, unknown>) : null;
  const pull = obj.pull && typeof obj.pull === "object" && !Array.isArray(obj.pull) ? (obj.pull as Record<string, unknown>) : null;
  if (!push || !pull) return null;
  function normalizeCounts(value: Record<string, unknown>) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(value)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) out[k] = Math.max(0, Math.round(n));
    }
    return out;
  }
  return { push: normalizeCounts(push), pull: normalizeCounts(pull) };
}

function normalizeRoomId(raw: unknown): RoomId | null {
  const t = String(raw ?? "").trim();
  return t ? t : null;
}

function normalizeStatus(raw: unknown): Item["status"] {
  const t = String(raw || "").trim();
  return (ITEM_STATUSES as readonly string[]).includes(t) ? (t as Item["status"]) : "Idea";
}

function coerceNumberOrNull(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input === "string") return parseNumberOrNull(input);
  return null;
}

function coerceDiscountType(input: unknown): Item["discountType"] {
  const t = String(input ?? "").trim();
  return t === "amount" || t === "percent" ? (t as Item["discountType"]) : null;
}

function coerceDims(input: unknown): Item["dimensions"] {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const out: NonNullable<Item["dimensions"]> = {};
  const wIn = coerceNumberOrNull(obj.wIn);
  const hIn = coerceNumberOrNull(obj.hIn);
  const dIn = coerceNumberOrNull(obj.dIn);
  if (wIn !== null) out.wIn = wIn;
  if (hIn !== null) out.hIn = hIn;
  if (dIn !== null) out.dIn = dIn;
  return Object.keys(out).length ? out : undefined;
}

function coerceSort(input: unknown): number | null | undefined {
  const n = coerceNumberOrNull(input);
  return n === null ? undefined : n;
}

function coerceSpecs(input: unknown): Item["specs"] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const out: NonNullable<Item["specs"]> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k).trim();
    if (!key) continue;
    if (v === null) out[key] = null;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = v;
    else if (typeof v === "undefined") continue;
    else out[key] = JSON.stringify(v);
  }
  return Object.keys(out).length ? out : null;
}

function coerceTags(input: unknown): string[] | null {
  if (typeof input === "string") {
    const tags = input
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return tags.length ? tags : null;
  }
  if (!Array.isArray(input)) return null;
  const cleaned = input.map((t) => String(t ?? "").trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

function itemDiscountAmount(item: Item): number | null {
  const value = typeof item.discountValue === "number" ? item.discountValue : null;
  if (value === null || value <= 0) return null;
  if (item.discountType === "amount") return value;
  if (item.discountType === "percent") {
    const price = typeof item.price === "number" ? item.price : null;
    if (price === null) return null;
    if (value >= 100) return null;
    return (price * value) / 100;
  }
  return null;
}

function dimsFromLegacySpecs(specs: Item["specs"]): Item["dimensions"] | undefined {
  if (!specs || typeof specs !== "object") return undefined;
  const anySpecs = specs as Record<string, unknown>;
  function num(key: string): number | null {
    const v = anySpecs[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
  const wIn = num("width_in") ?? num("length_in");
  const dIn = num("depth_in");
  const hIn = num("height_in");
  if (wIn === null && dIn === null && hIn === null) return undefined;
  return { wIn, dIn, hIn };
}

function normalizeActor(input: unknown): Actor {
  const t = String(input ?? "").trim();
  return t === "human" || t === "ai" || t === "import" || t === "system" ? (t as Actor) : null;
}

function parseAttachmentMeta(raw: any): AttachmentMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!url) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId("att"),
    url,
    name: typeof raw.name === "string" ? raw.name : null,
    mime: typeof raw.mime === "string" ? raw.mime : null,
    size: typeof raw.size === "number" ? raw.size : null,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

function attachmentParentKey(parentType: "item" | "option", parentId: string) {
  return `${parentType}:${parentId}`;
}

async function replaceAttachmentsForParent(parentType: "item" | "option", parentId: string, metas: AttachmentMeta[]) {
  const existing = await idbGetAllByIndex<AttachmentRecord>("attachments", "parentKey", attachmentParentKey(parentType, parentId));
  const nextIds = new Set(metas.map((m) => m.id));
  for (const att of existing) {
    if (!nextIds.has(att.id)) await idbDelete("attachments", att.id);
  }
  for (const meta of metas) {
    await idbPut("attachments", {
      id: meta.id,
      parentType,
      parentId,
      parentKey: attachmentParentKey(parentType, parentId),
      name: meta.name,
      sourceUrl: meta.url,
      mime: meta.mime,
      size: meta.size,
      blob: new Blob([], { type: meta.mime || "" }),
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    } as AttachmentRecord);
  }
}

function sanitizeExportMeta(input: unknown): ExportBundleV1["exportMeta"] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const obj = input as Record<string, unknown>;
  const exportedAt = coerceNumberOrNull(obj.exportedAt);
  if (exportedAt === null) return undefined;
  const exportedBy = normalizeActor(obj.exportedBy);
  const schemaVersionRaw = coerceNumberOrNull(obj.schemaVersion);
  const schemaVersion = schemaVersionRaw === null ? 1 : Math.max(1, Math.round(schemaVersionRaw));
  const appVersion = typeof obj.appVersion === "string" && obj.appVersion.trim() ? obj.appVersion.trim() : undefined;
  const sessionId = typeof obj.sessionId === "string" && obj.sessionId.trim() ? obj.sessionId.trim() : undefined;
  return { exportedAt, exportedBy, appVersion, schemaVersion, sessionId };
}

function normalizeBundle(raw: unknown): ExportBundleV1 | ExportBundleV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // Bundle export format (v1/v2)
  if ((obj.version === 1 || obj.version === 2) && Array.isArray(obj.items) && Array.isArray(obj.rooms)) {
    const version = obj.version === 2 ? 2 : 1;
    const home = sanitizeHomeMeta(obj.home);
    const planner = sanitizePlannerMeta(obj.planner);
    const exportedAt = typeof obj.exportedAt === "string" ? obj.exportedAt : new Date().toISOString();
    const exportMeta = sanitizeExportMeta(obj.exportMeta);
    const importedRoomsRaw: Room[] = (obj.rooms as unknown[]).map((r) => {
      const rawId = normalizeRoomId((r as any)?.id);
      const rawName = normalizeRoomName((r as any)?.name ?? rawId ?? "");
      const id = rawId || (rawName ? rawName : newId("r"));
      const name = rawName || id;
      const createdAt = coerceNumberOrNull((r as any)?.createdAt) ?? nowMs();
      const updatedAt = coerceNumberOrNull((r as any)?.updatedAt) ?? createdAt;
      return {
        id,
        name,
        notes: typeof (r as any)?.notes === "string" ? (r as any).notes : "",
        sort: coerceSort((r as any)?.sort),
        createdAt,
        updatedAt,
        remoteId: typeof (r as any)?.remoteId === "string" ? (r as any).remoteId : undefined,
        syncState: typeof (r as any)?.syncState === "string" ? (r as any).syncState : undefined,
        provenance: sanitizeProvenance((r as any)?.provenance),
      };
    });

    const rooms: Room[] = ensureRoomNames(importedRoomsRaw.length ? importedRoomsRaw : makeDefaultRooms()).map((r, idx) => {
      if (typeof r.sort !== "number") r.sort = idx;
      return r;
    });
    const roomById = new Map<RoomId, Room>(rooms.map((r) => [r.id, r] as const));

    function ensureRoom(id: RoomId) {
      if (roomById.has(id)) return;
      const ts = nowMs();
      const name = normalizeRoomName(id) || `Room ${roomById.size + 1}`;
      const next: Room = { id, name, notes: "", sort: roomById.size, createdAt: ts, updatedAt: ts };
      roomById.set(id, next);
      rooms.push(next);
    }

    const measurements: Measurement[] = Array.isArray(obj.measurements)
      ? (obj.measurements as unknown[]).map((m) => {
          const mid = typeof (m as any)?.id === "string" ? (m as any).id : newId("m");
          const room = normalizeRoomId((m as any)?.room) ?? rooms[0]?.id ?? DEFAULT_ROOMS[0];
          ensureRoom(room);
          const valueIn = coerceNumberOrNull((m as any)?.valueIn) ?? 0;
          const createdAt = coerceNumberOrNull((m as any)?.createdAt) ?? nowMs();
          const updatedAt = coerceNumberOrNull((m as any)?.updatedAt) ?? createdAt;
          const confidence = ["low", "med", "high"].includes(String((m as any)?.confidence))
            ? (String((m as any).confidence) as Measurement["confidence"])
            : null;
          return {
            id: mid,
            room,
            label: String((m as any)?.label || "").trim() || "Measurement",
            valueIn,
            sort: coerceSort((m as any)?.sort),
            confidence,
            forCategory: typeof (m as any)?.forCategory === "string" ? (m as any).forCategory : null,
            forItemId: typeof (m as any)?.forItemId === "string" ? (m as any).forItemId : null,
            notes: typeof (m as any)?.notes === "string" ? (m as any).notes : null,
            createdAt,
            updatedAt,
            remoteId: typeof (m as any)?.remoteId === "string" ? (m as any).remoteId : undefined,
            syncState: typeof (m as any)?.syncState === "string" ? (m as any).syncState : undefined,
            provenance: sanitizeProvenance((m as any)?.provenance),
          };
        })
      : [];

    const stores: Store[] = Array.isArray((obj as any).stores)
      ? ((obj as any).stores as unknown[]).map((s) => {
          const sid = typeof (s as any)?.id === "string" ? (s as any).id : newId("s");
          const createdAt = coerceNumberOrNull((s as any)?.createdAt) ?? nowMs();
          const updatedAt = coerceNumberOrNull((s as any)?.updatedAt) ?? createdAt;
          return {
            id: sid,
            name: normalizeStoreName((s as any)?.name) || "Store",
            sort: coerceSort((s as any)?.sort),
            discountType: coerceDiscountType((s as any)?.discountType),
            discountValue: coerceNumberOrNull((s as any)?.discountValue),
            deliveryInfo: typeof (s as any)?.deliveryInfo === "string" ? (s as any).deliveryInfo : null,
            extraWarranty: typeof (s as any)?.extraWarranty === "string" ? (s as any).extraWarranty : null,
            trial: typeof (s as any)?.trial === "string" ? (s as any).trial : null,
            apr: typeof (s as any)?.apr === "string" ? (s as any).apr : null,
            notes: typeof (s as any)?.notes === "string" ? (s as any).notes : null,
            createdAt,
            updatedAt,
            remoteId: typeof (s as any)?.remoteId === "string" ? (s as any).remoteId : undefined,
            syncState: typeof (s as any)?.syncState === "string" ? (s as any).syncState : undefined,
            provenance: sanitizeProvenance((s as any)?.provenance),
          };
        })
      : [];

    const items: Item[] = (obj.items as unknown[]).map((it) => {
      const iid = typeof (it as any)?.id === "string" ? (it as any).id : newId("i");
      const room = normalizeRoomId((it as any)?.room) ?? rooms[0]?.id ?? DEFAULT_ROOMS[0];
      ensureRoom(room);
      const createdAt = coerceNumberOrNull((it as any)?.createdAt) ?? nowMs();
      const updatedAt = coerceNumberOrNull((it as any)?.updatedAt) ?? createdAt;
      const qtyRaw = coerceNumberOrNull((it as any)?.qty);
      return {
        id: iid,
        name: String((it as any)?.name || "").trim() || "Item",
        room,
        category: String((it as any)?.category || "Other").trim() || "Other",
        status: normalizeStatus((it as any)?.status),
        selectedOptionId: typeof (it as any)?.selectedOptionId === "string" ? (it as any).selectedOptionId : null,
        sort: coerceSort((it as any)?.sort),
        price: coerceNumberOrNull((it as any)?.price),
        discountType: coerceDiscountType((it as any)?.discountType),
        discountValue: coerceNumberOrNull((it as any)?.discountValue),
        qty: qtyRaw !== null && qtyRaw > 0 ? Math.round(qtyRaw) : 1,
        store: normalizeStoreName((it as any)?.store) || null,
        link: typeof (it as any)?.link === "string" ? (it as any).link : null,
        notes: typeof (it as any)?.notes === "string" ? (it as any).notes : null,
        priority: coerceNumberOrNull((it as any)?.priority),
        tags: coerceTags((it as any)?.tags),
        dimensions: coerceDims((it as any)?.dimensions),
        specs: coerceSpecs((it as any)?.specs),
        createdAt,
        updatedAt,
        remoteId: typeof (it as any)?.remoteId === "string" ? (it as any).remoteId : undefined,
        syncState: typeof (it as any)?.syncState === "string" ? (it as any).syncState : undefined,
        provenance: sanitizeProvenance((it as any)?.provenance),
      };
    });

    const options: Option[] = Array.isArray(obj.options)
      ? (obj.options as unknown[]).map((op) => {
          const oid = typeof (op as any)?.id === "string" ? (op as any).id : newId("o");
          const createdAt = coerceNumberOrNull((op as any)?.createdAt) ?? nowMs();
          const updatedAt = coerceNumberOrNull((op as any)?.updatedAt) ?? createdAt;
          return {
            id: oid,
            itemId: String((op as any)?.itemId || "").trim(),
            title: String((op as any)?.title || "").trim() || "Option",
            sort: coerceSort((op as any)?.sort),
            store: normalizeStoreName((op as any)?.store) || null,
            link: typeof (op as any)?.link === "string" ? (op as any).link : null,
            promoCode: typeof (op as any)?.promoCode === "string" ? (op as any).promoCode : null,
            price: coerceNumberOrNull((op as any)?.price),
            shipping: coerceNumberOrNull((op as any)?.shipping),
            taxEstimate: coerceNumberOrNull((op as any)?.taxEstimate),
            discount: coerceNumberOrNull((op as any)?.discount),
            discountType: coerceDiscountType((op as any)?.discountType) || (typeof (op as any)?.discount === "number" ? "amount" : null),
            discountValue:
              coerceNumberOrNull((op as any)?.discountValue) ??
              (typeof (op as any)?.discount === "number" ? (op as any).discount : null),
            dimensionsText: typeof (op as any)?.dimensionsText === "string" ? (op as any).dimensionsText : null,
            dimensions: coerceDims((op as any)?.dimensions),
            specs: coerceSpecs((op as any)?.specs),
            notes: typeof (op as any)?.notes === "string" ? (op as any).notes : null,
            priority: coerceNumberOrNull((op as any)?.priority),
            tags: coerceTags((op as any)?.tags),
            selected: Boolean((op as any)?.selected),
            sourceItemId: typeof (op as any)?.sourceItemId === "string" ? (op as any).sourceItemId : undefined,
            createdAt,
            updatedAt,
            remoteId: typeof (op as any)?.remoteId === "string" ? (op as any).remoteId : undefined,
            syncState: typeof (op as any)?.syncState === "string" ? (op as any).syncState : undefined,
            provenance: sanitizeProvenance((op as any)?.provenance),
          };
        })
      : [];

    if (version === 2) {
      const meta: ExportBundleV2["exportMeta"] = {
        exportedAt: exportMeta?.exportedAt ?? nowMs(),
        exportedBy: exportMeta?.exportedBy ?? "import",
        appVersion: exportMeta?.appVersion,
        schemaVersion: 2,
        sessionId: exportMeta?.sessionId,
      };
      return { version: 2, exportedAt, exportMeta: meta, home, planner, rooms, measurements, items, options, stores };
    }

    return { version: 1, exportedAt, exportMeta, home, planner, rooms, measurements, items, options, stores };
  }

  // Legacy single-file tracker import format (Town Hollywood JSON seed)
  if (typeof obj.title === "string" && (Array.isArray(obj.items) || Array.isArray(obj.measurements))) {
    const ts = nowMs();
    const home = sanitizeHomeMeta({
      name: DEFAULT_HOME.name,
      tags: DEFAULT_HOME.tags,
      description: `${obj.title}\n\n${DEFAULT_HOME.description}`,
    });

    // Ensure all rooms exist
    const rooms: Room[] = makeDefaultRooms().map((r) => ({ ...r, syncState: undefined }));
    const roomById = new Map(rooms.map((r) => [r.id, r] as const));

    function ensureLegacyRoom(id: RoomId) {
      if (roomById.has(id)) return;
      const name = normalizeRoomName(id) || `Room ${roomById.size + 1}`;
      const room: Room = { id, name, notes: "", sort: roomById.size, createdAt: ts, updatedAt: ts };
      roomById.set(id, room);
      rooms.push(room);
    }

    const nextSortByRoom: Record<RoomId, number> = {};

    function nextRoomSort(roomId: RoomId) {
      if (typeof nextSortByRoom[roomId] !== "number") nextSortByRoom[roomId] = 0;
      const next = nextSortByRoom[roomId];
      nextSortByRoom[roomId] = next + 1;
      return next;
    }

    const items: Item[] = (obj.items as unknown[] | undefined || []).map((it) => {
      const room = normalizeRoomId((it as any)?.room) ?? rooms[0]?.id ?? DEFAULT_ROOMS[0];
      ensureLegacyRoom(room);
      const specs = coerceSpecs((it as any)?.specs);
      return {
        id: newId("i"),
        name: String((it as any)?.title || "").trim() || "Item",
        room,
        category: String((it as any)?.category || "Other").trim() || "Other",
        status: normalizeStatus((it as any)?.status),
        sort: nextRoomSort(room),
        price: typeof (it as any)?.price === "number" ? (it as any).price : null,
        qty: typeof (it as any)?.quantity === "number" ? Math.round((it as any).quantity) : 1,
        store: normalizeStoreName((it as any)?.store) || null,
        link: typeof (it as any)?.link === "string" ? (it as any).link : null,
        notes: typeof (it as any)?.notes === "string" ? (it as any).notes : null,
        priority: typeof (it as any)?.priority === "number" ? (it as any).priority : null,
        dimensions: dimsFromLegacySpecs(specs),
        specs,
        createdAt: ts,
        updatedAt: ts,
      };
    });

    const byName = new Map(items.map((i) => [i.name.toLowerCase(), i.id]));

    const nextSortByItemId: Record<string, number> = {};

    const options: Option[] = (obj.options as unknown[] | undefined || [])
      .map((op) => {
        const parentTitle = String((op as any)?.parentTitle || "").trim().toLowerCase();
        const itemId = byName.get(parentTitle);
        if (!itemId) return null;
        const sort = typeof nextSortByItemId[itemId] === "number" ? nextSortByItemId[itemId] : 0;
        nextSortByItemId[itemId] = sort + 1;
        return {
          id: newId("o"),
          itemId,
          title: String((op as any)?.title || "").trim() || "Option",
          sort,
          store: normalizeStoreName((op as any)?.store) || null,
          link: typeof (op as any)?.link === "string" ? (op as any).link : null,
          promoCode: typeof (op as any)?.promo === "string" ? (op as any).promo : null,
          price: typeof (op as any)?.price === "number" ? (op as any).price : null,
          shipping: typeof (op as any)?.shipping === "number" ? (op as any).shipping : null,
          taxEstimate: typeof (op as any)?.tax === "number" ? (op as any).tax : null,
          discount: typeof (op as any)?.discount === "number" ? (op as any).discount : null,
          discountType: typeof (op as any)?.discount === "number" ? "amount" : null,
          discountValue: typeof (op as any)?.discount === "number" ? (op as any).discount : null,
          dimensionsText: typeof (op as any)?.dimensions === "string" ? (op as any).dimensions : null,
          notes: typeof (op as any)?.notes === "string" ? (op as any).notes : null,
          selected: false,
          createdAt: ts,
          updatedAt: ts,
        } satisfies Option;
      })
      .filter(Boolean) as Option[];

    const nextMeasSortByRoom: Record<RoomId, number> = {};

    function nextMeasSort(roomId: RoomId) {
      if (typeof nextMeasSortByRoom[roomId] !== "number") nextMeasSortByRoom[roomId] = 0;
      const next = nextMeasSortByRoom[roomId];
      nextMeasSortByRoom[roomId] = next + 1;
      return next;
    }

    const measurements: Measurement[] = (obj.measurements as unknown[] | undefined || []).map((m) => {
      const room = normalizeRoomId((m as any)?.room) ?? rooms[0]?.id ?? DEFAULT_ROOMS[0];
      ensureLegacyRoom(room);
      const unit = String((m as any)?.unit || "in").trim().toLowerCase();
      const rawValue = typeof (m as any)?.value === "number" ? (m as any).value : 0;
      const valueIn = unit === "cm" ? rawValue / 2.54 : rawValue;
      const confidence = ["low", "med", "high"].includes(String((m as any)?.confidence))
        ? (String((m as any).confidence) as Measurement["confidence"])
        : undefined;
      return {
        id: newId("m"),
        room,
        label: String((m as any)?.label || "").trim() || "Measurement",
        valueIn,
        sort: nextMeasSort(room),
        confidence,
        forCategory: null,
        forItemId: null,
        notes: typeof (m as any)?.notes === "string" ? (m as any).notes : null,
        createdAt: ts,
        updatedAt: ts,
      };
    });

    // Room notes (legacy "notes" array)
    const notesArr = Array.isArray(obj.notes) ? (obj.notes as any[]) : [];
    for (const n of notesArr) {
      const rid = normalizeRoomId(n?.room);
      if (!rid) continue;
      ensureLegacyRoom(rid);
      const r = rooms.find((x) => x.id === rid);
      if (!r) continue;
      if (typeof n?.notes === "string") r.notes = n.notes;
    }

    return {
      version: 1,
      exportedAt: new Date(ts).toISOString(),
      home,
      rooms,
      measurements,
      items,
      options,
    };
  }

  return null;
}

function makeHumanCreatedProvenance(input: Provenance | undefined, at: number): Provenance {
  const base = sanitizeProvenance(input) ?? {};
  const next: Provenance = {
    ...base,
    createdBy: base.createdBy ?? "human",
    createdAt: base.createdAt ?? at,
    lastEditedBy: "human",
    lastEditedAt: at,
    modifiedFields: null,
  };
  if (next.reviewStatus === "verified") {
    next.verifiedAt = typeof next.verifiedAt === "number" ? next.verifiedAt : at;
    next.verifiedBy = next.verifiedBy ?? "human";
    next.modifiedFields = null;
  }
  return next;
}

function touchProvenanceForHumanEdit(existing: Provenance | undefined, patch: Provenance | undefined, at: number): Provenance {
  const base = sanitizeProvenance(existing) ?? {};
  const delta = sanitizeProvenance(patch) ?? {};
  const next: Provenance = {
    ...base,
    ...delta,
    lastEditedBy: "human",
    lastEditedAt: at,
  };
  if (next.reviewStatus === "verified") {
    next.verifiedAt = typeof next.verifiedAt === "number" ? next.verifiedAt : at;
    next.verifiedBy = next.verifiedBy ?? "human";
    next.modifiedFields = null;
  }
  return next;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [home, setHome] = useState<HomeMeta>(DEFAULT_HOME);
  const [planner, setPlanner] = useState<PlannerMeta>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [unitPreference, setUnitPreferenceState] = useState<UnitPreference>("in");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [lastSyncSummary, setLastSyncSummary] = useState<SyncSummary | null>(null);

  const saveHome = useCallback(async (next: HomeMeta) => {
    const sanitized = sanitizeHomeMeta(next);
    await idbSetMeta("home", sanitized);
    setHome(sanitized);
    notifyDbChanged();
  }, []);

  const savePlanner = useCallback(async (next: PlannerMeta) => {
    const sanitized = sanitizePlannerMeta(next);
    await idbSetMeta("planner", sanitized);
    setPlanner(sanitized);
    notifyDbChanged();
  }, []);

  const saveUnitPreference = useCallback(async (unit: UnitPreference) => {
    const sanitized = sanitizeUnitPreference(unit);
    await idbSetMeta("unitPreference", sanitized);
    setUnitPreferenceState(sanitized);
    notifyDbChanged();
  }, []);

  const reloadAll = useCallback(async () => {
    const snap = await idbGetSnapshot();
    let nextRooms = ensureRoomNames(snap.rooms);

    if (!nextRooms.length) {
      nextRooms = makeDefaultRooms();
      await idbBulkPut("rooms", nextRooms);
    } else if (snap.rooms.some((r) => !normalizeRoomName((r as any)?.name))) {
      await idbBulkPut("rooms", nextRooms);
    }

    const homeMeta = sanitizeHomeMeta(snap.meta.home);
    if (!snap.meta.home) await idbSetMeta("home", homeMeta);
    const plannerMeta = sanitizePlannerMeta(snap.meta.planner);
    if (snap.meta.planner && !plannerMeta) await idbSetMeta("planner", plannerMeta);
    const unitPref = sanitizeUnitPreference(snap.meta.unitPreference);
    if (!snap.meta.unitPreference) await idbSetMeta("unitPreference", unitPref);
    const syncAt = typeof snap.meta.lastSyncAt === "number" ? snap.meta.lastSyncAt : null;
    const syncSummary = sanitizeSyncSummary(snap.meta.lastSyncSummary);

    const nextStores = snap.stores.slice();
    const storeByKey = new Map<string, Store>();
    for (const s of nextStores) {
      if (s.syncState === "deleted") continue;
      const key = storeKey(s.name);
      if (!key) continue;
      if (!storeByKey.has(key)) storeByKey.set(key, s);
    }
    const createdStores: Store[] = [];
    const ts = nowMs();
    const ensureStore = (nameRaw: unknown) => {
      const name = normalizeStoreName(nameRaw);
      if (!name) return;
      const key = storeKey(name);
      if (storeByKey.has(key)) return;
      const sort = nextStores.filter((s) => s.syncState !== "deleted").length + createdStores.length;
      const store: Store = {
        id: newId("s"),
        name,
        sort,
        discountType: null,
        discountValue: null,
        deliveryInfo: null,
        extraWarranty: null,
        trial: null,
        apr: null,
        notes: null,
        remoteId: null,
        syncState: "dirty",
        provenance: makeHumanCreatedProvenance(undefined, ts),
        createdAt: ts,
        updatedAt: ts,
      };
      storeByKey.set(key, store);
      createdStores.push(store);
      nextStores.push(store);
    };
    for (const it of snap.items) {
      if (it.syncState === "deleted") continue;
      ensureStore(it.store);
    }
    for (const opt of snap.options) {
      if (opt.syncState === "deleted") continue;
      ensureStore(opt.store);
    }
    if (createdStores.length) await idbBulkPut("stores", createdStores);

    setHome(homeMeta);
    setPlanner(plannerMeta);
    setRooms(nextRooms);
    setMeasurements(snap.measurements);
    setItems(snap.items);
    setOptions(snap.options);
    setStores(nextStores);
    setUnitPreferenceState(unitPref);
    setLastSyncAt(syncAt);
    setLastSyncSummary(syncSummary);

    setReady(true);
  }, []);

  useEffect(() => {
    reloadAll();
    return subscribeDbChanges(() => {
      // Keep it simple: reload everything (dataset is tiny).
      reloadAll();
    });
  }, [reloadAll]);

  const orderedRooms = useMemo(() => orderRooms(rooms), [rooms]);
  const roomNameById = useMemo(() => buildRoomNameMap(rooms), [rooms]);
  const storeByName = useMemo(() => buildStoreIndex(stores), [stores]);
  const orderedStores = useMemo(() => orderStores(stores), [stores]);
  const defaultRoomId = orderedRooms[0]?.id ?? DEFAULT_ROOMS[0];

  const resolveRoomId = useCallback(
    (raw: unknown) => {
      const rid = normalizeRoomId(raw);
      if (rid && rooms.some((r) => r.syncState !== "deleted" && r.id === rid)) return rid;
      return defaultRoomId;
    },
    [defaultRoomId, rooms],
  );

  const createRoom = useCallback(
    async (nameRaw: string) => {
      const name = normalizeRoomName(nameRaw);
      if (!name) return null;
      const allRooms = await idbGetAll<Room>("rooms");
      const existing = allRooms.find((r) => r.syncState !== "deleted" && normalizeRoomName(r.name).toLowerCase() === name.toLowerCase());
      if (existing) return existing.id;
      const ts = nowMs();
      const sort = allRooms.filter((r) => r.syncState !== "deleted").length;
      const room: Room = {
        id: name,
        name,
        notes: "",
        sort,
        createdAt: ts,
        updatedAt: ts,
        syncState: "dirty",
        remoteId: null,
        provenance: makeHumanCreatedProvenance(undefined, ts),
      };
      await idbPut("rooms", room);
      notifyDbChanged();
      return room.id;
    },
    [],
  );

  const deleteRoom = useCallback(async (id: RoomId, opts?: { moveTo?: RoomId }) => {
    const allRooms = await idbGetAll<Room>("rooms");
    const cur = allRooms.find((r) => r.id === id);
    if (!cur) return;
    const moveTo = opts?.moveTo;
    const ts = nowMs();

    const allItems = await idbGetAll<Item>("items");
    const allMeas = await idbGetAll<Measurement>("measurements");
    const itemsToMove = allItems.filter((i) => i.syncState !== "deleted" && i.room === id);
    const measToMove = allMeas.filter((m) => m.syncState !== "deleted" && m.room === id);

    if ((itemsToMove.length || measToMove.length) && !moveTo) {
      throw new Error("Room has items or measurements. Choose a destination room.");
    }

    if (moveTo) {
      const nextItems = itemsToMove.map((i) => ({ ...i, room: moveTo, updatedAt: ts, syncState: "dirty" }));
      const nextMeas = measToMove.map((m) => ({ ...m, room: moveTo, updatedAt: ts, syncState: "dirty" }));
      if (nextItems.length) await idbBulkPut("items", nextItems);
      if (nextMeas.length) await idbBulkPut("measurements", nextMeas);
    }

    await idbPut("rooms", { ...cur, syncState: "deleted", updatedAt: ts });
    notifyDbChanged();
  }, []);

  const createItem = useCallback(
    async (partial: Partial<Item>) => {
      const ts = nowMs();
      const room = resolveRoomId(partial.room);
      const allExisting = await idbGetAll<Item>("items");
      const minSort = allExisting
        .filter((i) => i.syncState !== "deleted" && i.room === room && typeof i.sort === "number")
        .reduce((min, i) => Math.min(min, i.sort as number), 0);
      const sort = minSort - 1; // New items bubble to the top of the room list.
      const id = newId("i");
      const item: Item = {
        id,
        remoteId: null,
        syncState: "dirty",
        name: (partial.name || "").toString().trim() || "New item",
        room,
        category: (partial.category || "Other").toString().trim() || "Other",
        status: normalizeStatus(partial.status),
        selectedOptionId: typeof partial.selectedOptionId === "string" ? partial.selectedOptionId : null,
        sort,
        price: typeof partial.price === "number" ? partial.price : null,
        discountType: coerceDiscountType(partial.discountType),
        discountValue: coerceNumberOrNull(partial.discountValue),
        qty: typeof partial.qty === "number" && partial.qty > 0 ? Math.round(partial.qty) : 1,
        store: typeof partial.store === "string" ? partial.store : null,
        link: typeof partial.link === "string" ? partial.link : null,
        notes: typeof partial.notes === "string" ? partial.notes : null,
        priority: typeof partial.priority === "number" ? partial.priority : null,
        tags: coerceTags(partial.tags),
        dimensions: partial.dimensions ? partial.dimensions : undefined,
        specs: partial.specs ? partial.specs : null,
        provenance: makeHumanCreatedProvenance(partial.provenance, ts),
        createdAt: ts,
        updatedAt: ts,
      };
      await idbPut("items", item);
      notifyDbChanged();
      return id;
    },
    [resolveRoomId],
  );

  const updateItem = useCallback(async (id: string, patch: Partial<Item>) => {
    const all = await idbGetAll<Item>("items");
    const cur = all.find((x) => x.id === id);
    if (!cur) return;
    const ts = nowMs();
    const nextTags = typeof patch.tags === "undefined" ? cur.tags ?? null : coerceTags(patch.tags);
    const nextDiscountType = typeof patch.discountType === "undefined" ? cur.discountType ?? null : coerceDiscountType(patch.discountType);
    const nextDiscountValue = typeof patch.discountValue === "undefined" ? cur.discountValue ?? null : coerceNumberOrNull(patch.discountValue);
    const next: Item = {
      ...cur,
      ...patch,
      room: resolveRoomId(patch.room ?? cur.room),
      status: normalizeStatus(patch.status ?? cur.status),
      category: typeof patch.category === "string" ? patch.category : cur.category,
      name: typeof patch.name === "string" ? patch.name : cur.name,
      tags: nextTags,
      discountType: nextDiscountType,
      discountValue: nextDiscountValue,
      updatedAt: ts,
      syncState: patch.syncState ?? "dirty",
      provenance: touchProvenanceForHumanEdit(cur.provenance, patch.provenance, ts),
    };
    await idbPut("items", next);
    notifyDbChanged();
  }, [resolveRoomId]);

  const deleteItem = useCallback(async (id: string) => {
    const all = await idbGetAll<Item>("items");
    const cur = all.find((x) => x.id === id);
    if (!cur) return;
    await idbPut("items", { ...cur, syncState: "deleted", updatedAt: nowMs() });
    notifyDbChanged();
  }, []);

  const convertItemToOption = useCallback(async (parentItemId: string, sourceItemId: string) => {
    if (parentItemId === sourceItemId) throw new Error("Choose a different item to import.");
    const [allItems, allOptions] = await Promise.all([idbGetAll<Item>("items"), idbGetAll<Option>("options")]);
    const parent = allItems.find((x) => x.id === parentItemId && x.syncState !== "deleted");
    const source = allItems.find((x) => x.id === sourceItemId && x.syncState !== "deleted");
    if (!parent || !source) throw new Error("Item not found or already removed.");

    const existingOptions = allOptions.filter((o) => o.syncState !== "deleted" && o.itemId === parentItemId);
    const sourceLink = String(source.link || "").trim().toLowerCase();
    const sourceTitle = String(source.name || "").trim().toLowerCase();
    const sourcePrice = typeof source.price === "number" ? source.price : null;

    const isDuplicate = existingOptions.some((o) => {
      if (o.sourceItemId && o.sourceItemId === sourceItemId) return true;
      const optLink = String(o.link || "").trim().toLowerCase();
      if (sourceLink && optLink && optLink === sourceLink) return true;
      const optTitle = String(o.title || "").trim().toLowerCase();
      const optPrice = typeof o.price === "number" ? o.price : null;
      if (sourceTitle && optTitle && sourceTitle === optTitle && sourcePrice === optPrice) return true;
      return false;
    });
    if (isDuplicate) throw new Error("Option already exists for this item.");

    const sourceOptions = allOptions.filter((o) => o.syncState !== "deleted" && o.itemId === sourceItemId);
    const nestedNote =
      sourceOptions.length > 0 ? `Imported from an item with ${sourceOptions.length} nested option${sourceOptions.length === 1 ? "" : "s"}. Nested options were not migrated.` : "";
    const baseNotes = typeof source.notes === "string" ? source.notes.trim() : "";
    const mergedNotes = [baseNotes, nestedNote].filter(Boolean).join("\n\n") || null;

    const minSort = existingOptions
      .filter((o) => typeof o.sort === "number")
      .reduce((min, o) => Math.min(min, o.sort as number), 0);
    const sort = minSort - 1;
    const ts = nowMs();
    const optionId = newId("o");
    const itemDiscount = itemDiscountAmount(source);
    const option: Option = {
      id: optionId,
      remoteId: null,
      syncState: "dirty",
      itemId: parentItemId,
      title: source.name || "Option",
      sort,
      store: source.store ?? null,
      link: source.link ?? null,
      price: source.price ?? null,
      discount: itemDiscount ?? null,
      discountType: source.discountType ?? (itemDiscount ? "amount" : null),
      discountValue: typeof source.discountValue === "number" ? source.discountValue : itemDiscount ?? null,
      notes: mergedNotes,
      priority: source.priority ?? null,
      tags: coerceTags(source.tags),
      dimensions: source.dimensions ? { ...source.dimensions } : undefined,
      specs: source.specs ? { ...source.specs } : null,
      selected: false,
      sourceItemId: sourceItemId,
      provenance: makeHumanCreatedProvenance(source.provenance, ts),
      createdAt: ts,
      updatedAt: ts,
    };

    await idbPut("options", option);

    if (sourceOptions.length) {
      const deletedOptions = sourceOptions.map((o) => ({ ...o, syncState: "deleted", updatedAt: ts }));
      await idbBulkPut("options", deletedOptions);
    }

    await idbPut("items", { ...source, syncState: "deleted", updatedAt: ts });
    try {
      await moveAttachmentsParent("item", sourceItemId, "option", optionId);
    } catch {
      // Ignore attachment move failures; item deletion will still proceed.
    }
    notifyDbChanged();
  }, []);

  const createOption = useCallback(async (partial: Partial<Option> & { itemId: string }) => {
    const ts = nowMs();
    const allExisting = await idbGetAll<Option>("options");
    const minSort = allExisting
      .filter((o) => o.syncState !== "deleted" && o.itemId === partial.itemId && typeof o.sort === "number")
      .reduce((min, o) => Math.min(min, o.sort as number), 0);
    const sort = minSort - 1;
    const id = newId("o");
    const opt: Option = {
      id,
      remoteId: null,
      syncState: "dirty",
      itemId: partial.itemId,
      title: (partial.title || "").toString().trim() || "Option",
      sort,
      store: typeof partial.store === "string" ? partial.store : null,
      link: typeof partial.link === "string" ? partial.link : null,
      promoCode: typeof partial.promoCode === "string" ? partial.promoCode : null,
      price: typeof partial.price === "number" ? partial.price : null,
      shipping: typeof partial.shipping === "number" ? partial.shipping : null,
      taxEstimate: typeof partial.taxEstimate === "number" ? partial.taxEstimate : null,
      discount: typeof partial.discount === "number" ? partial.discount : null,
      discountType: coerceDiscountType(partial.discountType) || (typeof partial.discount === "number" ? "amount" : null),
      discountValue:
        typeof partial.discountValue === "number"
          ? partial.discountValue
          : typeof partial.discount === "number"
            ? partial.discount
            : null,
      dimensionsText: typeof partial.dimensionsText === "string" ? partial.dimensionsText : null,
      dimensions: partial.dimensions ? partial.dimensions : undefined,
      specs: partial.specs ? partial.specs : null,
      notes: typeof partial.notes === "string" ? partial.notes : null,
      priority: typeof partial.priority === "number" ? partial.priority : null,
      tags: coerceTags(partial.tags),
      selected: Boolean(partial.selected),
      sourceItemId: typeof partial.sourceItemId === "string" ? partial.sourceItemId : undefined,
      provenance: makeHumanCreatedProvenance(partial.provenance, ts),
      createdAt: ts,
      updatedAt: ts,
    };
    await idbPut("options", opt);
    notifyDbChanged();
    return id;
  }, []);

  const updateOption = useCallback<UpdateOptionFn>(async (arg1: string, arg2: Partial<Option> | string, arg3?: Partial<Option>) => {
    const optionId = typeof arg3 === "undefined" ? arg1 : (arg2 as string);
    const parentItemId = typeof arg3 === "undefined" ? null : arg1;
    const patch = (typeof arg3 === "undefined" ? arg2 : arg3) as Partial<Option>;

    const all = await idbGetAll<Option>("options");
    const cur = all.find((x) => x.id === optionId && (!parentItemId || x.itemId === parentItemId));
    if (!cur) return;
    const ts = nowMs();
    const nextTags = typeof patch.tags === "undefined" ? cur.tags ?? null : coerceTags(patch.tags);
    const nextDiscountType =
      typeof patch.discountType === "undefined"
        ? cur.discountType ?? (typeof cur.discount === "number" ? "amount" : null)
        : coerceDiscountType(patch.discountType);
    const nextDiscountValue =
      typeof patch.discountValue === "undefined"
        ? cur.discountValue ?? (typeof cur.discount === "number" ? cur.discount : null)
        : coerceNumberOrNull(patch.discountValue);
    const nextDiscount =
      typeof patch.discount === "undefined"
        ? cur.discount ?? null
        : coerceNumberOrNull(patch.discount);
    const next: Option = {
      ...cur,
      ...patch,
      tags: nextTags,
      discountType: nextDiscountType,
      discountValue: nextDiscountValue,
      discount: nextDiscount,
      updatedAt: ts,
      syncState: patch.syncState ?? "dirty",
      provenance: touchProvenanceForHumanEdit(cur.provenance, patch.provenance, ts),
    };
    await idbPut("options", next);
    notifyDbChanged();
  }, []);

  const deleteOption = useCallback(async (id: string) => {
    const all = await idbGetAll<Option>("options");
    const cur = all.find((x) => x.id === id);
    if (!cur) return;
    await idbPut("options", { ...cur, syncState: "deleted", updatedAt: nowMs() });
    notifyDbChanged();
  }, []);

  const createMeasurement = useCallback(async (partial: Partial<Measurement> & { room: RoomId }) => {
    const ts = nowMs();
    const room = resolveRoomId(partial.room);
    const allExisting = await idbGetAll<Measurement>("measurements");
    const minSort = allExisting
      .filter((m) => m.syncState !== "deleted" && m.room === room && typeof m.sort === "number")
      .reduce((min, m) => Math.min(min, m.sort as number), 0);
    const sort = minSort - 1;
    const id = newId("m");
    const m: Measurement = {
      id,
      remoteId: null,
      syncState: "dirty",
      room,
      label: (partial.label || "").toString().trim() || "Measurement",
      valueIn: typeof partial.valueIn === "number" ? partial.valueIn : 0,
      sort,
      confidence:
        partial.confidence === "low" || partial.confidence === "med" || partial.confidence === "high"
          ? partial.confidence
          : null,
      forCategory: typeof partial.forCategory === "string" ? partial.forCategory : null,
      forItemId: typeof partial.forItemId === "string" ? partial.forItemId : null,
      notes: typeof partial.notes === "string" ? partial.notes : null,
      provenance: makeHumanCreatedProvenance(partial.provenance, ts),
      createdAt: ts,
      updatedAt: ts,
    };
    await idbPut("measurements", m);
    notifyDbChanged();
    return id;
  }, [resolveRoomId]);

  const updateMeasurement = useCallback(async (id: string, patch: Partial<Measurement>) => {
    const all = await idbGetAll<Measurement>("measurements");
    const cur = all.find((x) => x.id === id);
    if (!cur) return;
    const ts = nowMs();
    const next: Measurement = {
      ...cur,
      ...patch,
      room: resolveRoomId(patch.room ?? cur.room),
      forCategory:
        patch.forCategory === null ? null : typeof patch.forCategory === "string" ? patch.forCategory : cur.forCategory ?? null,
      forItemId:
        patch.forItemId === null ? null : typeof patch.forItemId === "string" ? patch.forItemId : cur.forItemId ?? null,
      updatedAt: ts,
      syncState: patch.syncState ?? "dirty",
      provenance: touchProvenanceForHumanEdit(cur.provenance, patch.provenance, ts),
    };
    await idbPut("measurements", next);
    notifyDbChanged();
  }, [resolveRoomId]);

  const deleteMeasurement = useCallback(async (id: string) => {
    const all = await idbGetAll<Measurement>("measurements");
    const cur = all.find((x) => x.id === id);
    if (!cur) return;
    await idbPut("measurements", { ...cur, syncState: "deleted", updatedAt: nowMs() });
    notifyDbChanged();
  }, []);

  const updateRoom = useCallback(async (id: RoomId, patch: Partial<Room>) => {
    const all = await idbGetAll<Room>("rooms");
    const cur = all.find((x) => x.id === id);
    const ts = nowMs();
    const base: Room =
      cur || { id, name: normalizeRoomName(id) || "Room", notes: "", createdAt: ts, updatedAt: ts, syncState: "dirty", remoteId: null };
    const nextName = normalizeRoomName(patch.name ?? base.name) || base.name;
    const next: Room = {
      ...base,
      ...patch,
      id,
      name: nextName,
      notes: typeof patch.notes === "string" ? patch.notes : base.notes,
      updatedAt: ts,
      syncState: patch.syncState ?? "dirty",
      provenance: touchProvenanceForHumanEdit(base.provenance, patch.provenance, ts),
    };
    await idbPut("rooms", next);
    notifyDbChanged();
  }, []);

  const createStore = useCallback(async (nameRaw: string) => {
    const name = normalizeStoreName(nameRaw);
    if (!name) return null;
    const allStores = await idbGetAll<Store>("stores");
    const key = storeKey(name);
    const existing = allStores.find((s) => s.syncState !== "deleted" && storeKey(s.name) === key);
    if (existing) return existing.id;
    const ts = nowMs();
    const sort = allStores.filter((s) => s.syncState !== "deleted").length;
    const store: Store = {
      id: newId("s"),
      name,
      sort,
      discountType: null,
      discountValue: null,
      deliveryInfo: null,
      extraWarranty: null,
      trial: null,
      apr: null,
      notes: null,
      remoteId: null,
      syncState: "dirty",
      provenance: makeHumanCreatedProvenance(undefined, ts),
      createdAt: ts,
      updatedAt: ts,
    };
    await idbPut("stores", store);
    notifyDbChanged();
    return store.id;
  }, []);

  const updateStore = useCallback(async (id: string, patch: Partial<Store>) => {
    const allStores = await idbGetAll<Store>("stores");
    const cur = allStores.find((s) => s.id === id);
    if (!cur) return;
    const ts = nowMs();
    const nextNameRaw = typeof patch.name === "string" ? patch.name : cur.name;
    const nextName = normalizeStoreName(nextNameRaw) || cur.name;
    const nextKey = storeKey(nextName);
    const prevKey = storeKey(cur.name);
    if (nextKey !== prevKey) {
      const clash = allStores.find((s) => s.id !== id && s.syncState !== "deleted" && storeKey(s.name) === nextKey);
      if (clash) throw new Error(`Store name already exists: ${clash.name}`);
    }

    if (nextKey !== prevKey) {
      const allItems = await idbGetAll<Item>("items");
      const allOptions = await idbGetAll<Option>("options");
      const nextItems: Item[] = [];
      const nextOptions: Option[] = [];
      for (const it of allItems) {
        if (it.syncState === "deleted") continue;
        if (storeKey(it.store) !== prevKey) continue;
        nextItems.push({ ...it, store: nextName, updatedAt: ts, syncState: "dirty" });
      }
      for (const opt of allOptions) {
        if (opt.syncState === "deleted") continue;
        if (storeKey(opt.store) !== prevKey) continue;
        nextOptions.push({ ...opt, store: nextName, updatedAt: ts, syncState: "dirty" });
      }
      if (nextItems.length) await idbBulkPut("items", nextItems);
      if (nextOptions.length) await idbBulkPut("options", nextOptions);
    }

    const next: Store = {
      ...cur,
      ...patch,
      name: nextName,
      discountType: typeof patch.discountType === "undefined" ? cur.discountType ?? null : coerceDiscountType(patch.discountType),
      discountValue: typeof patch.discountValue === "undefined" ? cur.discountValue ?? null : coerceNumberOrNull(patch.discountValue),
      deliveryInfo:
        typeof patch.deliveryInfo === "undefined" ? cur.deliveryInfo ?? null : typeof patch.deliveryInfo === "string" ? patch.deliveryInfo : null,
      extraWarranty:
        typeof patch.extraWarranty === "undefined" ? cur.extraWarranty ?? null : typeof patch.extraWarranty === "string" ? patch.extraWarranty : null,
      trial: typeof patch.trial === "undefined" ? cur.trial ?? null : typeof patch.trial === "string" ? patch.trial : null,
      apr: typeof patch.apr === "undefined" ? cur.apr ?? null : typeof patch.apr === "string" ? patch.apr : null,
      notes: typeof patch.notes === "undefined" ? cur.notes ?? null : typeof patch.notes === "string" ? patch.notes : null,
      updatedAt: ts,
      syncState: patch.syncState ?? "dirty",
      provenance: touchProvenanceForHumanEdit(cur.provenance, patch.provenance, ts),
    };
    await idbPut("stores", next);
    notifyDbChanged();
  }, []);

  const deleteStore = useCallback(async (id: string) => {
    const allStores = await idbGetAll<Store>("stores");
    const cur = allStores.find((s) => s.id === id);
    if (!cur) return;
    const ts = nowMs();
    const key = storeKey(cur.name);

    const allItems = await idbGetAll<Item>("items");
    const allOptions = await idbGetAll<Option>("options");
    const nextItems: Item[] = [];
    const nextOptions: Option[] = [];
    for (const it of allItems) {
      if (it.syncState === "deleted") continue;
      if (storeKey(it.store) !== key) continue;
      nextItems.push({ ...it, store: null, updatedAt: ts, syncState: "dirty" });
    }
    for (const opt of allOptions) {
      if (opt.syncState === "deleted") continue;
      if (storeKey(opt.store) !== key) continue;
      nextOptions.push({ ...opt, store: null, updatedAt: ts, syncState: "dirty" });
    }
    if (nextItems.length) await idbBulkPut("items", nextItems);
    if (nextOptions.length) await idbBulkPut("options", nextOptions);

    await idbPut("stores", { ...cur, syncState: "deleted", updatedAt: ts });
    notifyDbChanged();
  }, []);

  const reorderRooms = useCallback(async (orderedRoomIds: RoomId[]) => {
    const all = await idbGetAll<Room>("rooms");
    const roomById = new Map(all.filter((r) => r.syncState !== "deleted").map((r) => [r.id, r]));

    // Keep any missing rooms at the end in a stable order.
    const ordered = orderedRoomIds.filter((rid) => roomById.has(rid));
    const currentIds = orderRooms([...roomById.values()]).map((r) => r.id);
    const remaining = currentIds.filter((rid) => !ordered.includes(rid));
    const finalIds = [...ordered, ...remaining];

    const ts = nowMs();
    const updates: Room[] = finalIds.map((rid, idx) => {
      const cur = roomById.get(rid)!;
      return { ...cur, sort: idx, updatedAt: ts, syncState: "dirty" };
    });
    await idbBulkPut("rooms", updates);
    notifyDbChanged();
  }, []);

  const reorderStores = useCallback(async (orderedStoreIds: string[]) => {
    const all = await idbGetAll<Store>("stores");
    const storeById = new Map(all.filter((s) => s.syncState !== "deleted").map((s) => [s.id, s]));

    const ordered = orderedStoreIds.filter((id) => storeById.has(id));
    const currentIds = orderStores([...storeById.values()]).map((s) => s.id);
    const remaining = currentIds.filter((id) => !ordered.includes(id));
    const finalIds = [...ordered, ...remaining];

    const ts = nowMs();
    const updates: Store[] = finalIds.map((id, idx) => {
      const cur = storeById.get(id)!;
      return { ...cur, sort: idx, updatedAt: ts, syncState: "dirty" };
    });
    await idbBulkPut("stores", updates);
    notifyDbChanged();
  }, []);

  const reorderItems = useCallback(async (roomId: RoomId, orderedItemIds: string[]) => {
    const all = await idbGetAll<Item>("items");
    const inRoom = all.filter((i) => i.syncState !== "deleted" && i.room === roomId);
    const byId = new Map(inRoom.map((i) => [i.id, i]));

    function rank(it: Item) {
      return typeof it.sort === "number" ? it.sort : 999999;
    }

    const currentIds = [...inRoom]
      .sort((a, b) => {
        const sa = rank(a);
        const sb = rank(b);
        if (sa !== sb) return sa - sb;
        const pa = a.priority ?? 999;
        const pb = b.priority ?? 999;
        if (pa !== pb) return pa - pb;
        return b.updatedAt - a.updatedAt;
      })
      .map((i) => i.id);

    const ordered = orderedItemIds.filter((id) => byId.has(id));
    const remaining = currentIds.filter((id) => !ordered.includes(id));
    const finalIds = [...ordered, ...remaining];

    const ts = nowMs();
    const updates: Item[] = finalIds.map((id, idx) => {
      const cur = byId.get(id)!;
      return { ...cur, sort: idx, updatedAt: ts, syncState: "dirty" };
    });
    await idbBulkPut("items", updates);
    notifyDbChanged();
  }, []);

  const reorderMeasurements = useCallback(async (roomId: RoomId, orderedMeasurementIds: string[]) => {
    const all = await idbGetAll<Measurement>("measurements");
    const inRoom = all.filter((m) => m.syncState !== "deleted" && m.room === roomId);
    const byId = new Map(inRoom.map((m) => [m.id, m]));

    function rank(m: Measurement) {
      return typeof m.sort === "number" ? m.sort : 999999;
    }

    const currentIds = [...inRoom]
      .sort((a, b) => {
        const sa = rank(a);
        const sb = rank(b);
        if (sa !== sb) return sa - sb;
        return a.label.localeCompare(b.label);
      })
      .map((m) => m.id);

    const ordered = orderedMeasurementIds.filter((id) => byId.has(id));
    const remaining = currentIds.filter((id) => !ordered.includes(id));
    const finalIds = [...ordered, ...remaining];

    const ts = nowMs();
    const updates: Measurement[] = finalIds.map((id, idx) => {
      const cur = byId.get(id)!;
      return { ...cur, sort: idx, updatedAt: ts, syncState: "dirty" };
    });
    await idbBulkPut("measurements", updates);
    notifyDbChanged();
  }, []);

  const reorderOptions = useCallback(async (itemId: string, orderedOptionIds: string[]) => {
    const all = await idbGetAll<Option>("options");
    const forItem = all.filter((o) => o.syncState !== "deleted" && o.itemId === itemId);
    const byId = new Map(forItem.map((o) => [o.id, o]));

    function rank(o: Option) {
      return typeof o.sort === "number" ? o.sort : 999999;
    }

    const currentIds = [...forItem]
      .sort((a, b) => {
        const sa = rank(a);
        const sb = rank(b);
        if (sa !== sb) return sa - sb;
        return b.updatedAt - a.updatedAt;
      })
      .map((o) => o.id);

    const ordered = orderedOptionIds.filter((id) => byId.has(id));
    const remaining = currentIds.filter((id) => !ordered.includes(id));
    const finalIds = [...ordered, ...remaining];

    const ts = nowMs();
    const updates: Option[] = finalIds.map((id, idx) => {
      const cur = byId.get(id)!;
      return { ...cur, sort: idx, updatedAt: ts, syncState: "dirty" };
    });
    await idbBulkPut("options", updates);
    notifyDbChanged();
  }, []);

  const sortAndFilterOptions = useCallback(
    (parentItemId: string, opts: { sortKey: OptionSortKey; sortDir: OptionSortDir; minPrice?: number | null; maxPrice?: number | null }) => {
      const min = typeof opts.minPrice === "number" ? opts.minPrice : null;
      const max = typeof opts.maxPrice === "number" ? opts.maxPrice : null;
      const base = options.filter((o) => o.syncState !== "deleted" && o.itemId === parentItemId);
      const filtered = base.filter((o) => {
        if (min === null && max === null) return true;
        const total = optionTotalWithStore(o, storeByName.get(storeKey(o.store)) || null);
        if (total === null) return false;
        if (min !== null && total < min) return false;
        if (max !== null && total > max) return false;
        return true;
      });

      const dir = opts.sortDir === "desc" ? -1 : 1;
      const sorted = filtered.slice().sort((a, b) => {
        if (opts.sortKey === "name") {
          const na = a.title.trim().toLowerCase();
          const nb = b.title.trim().toLowerCase();
          if (na !== nb) return na.localeCompare(nb) * dir;
        } else if (opts.sortKey === "priority") {
          const pa = typeof a.priority === "number" ? a.priority : 999999;
          const pb = typeof b.priority === "number" ? b.priority : 999999;
          if (pa !== pb) return (pa - pb) * dir;
        } else {
          const ta = optionTotalWithStore(a, storeByName.get(storeKey(a.store)) || null);
          const tb = optionTotalWithStore(b, storeByName.get(storeKey(b.store)) || null);
          if (ta === null && tb !== null) return 1;
          if (tb === null && ta !== null) return -1;
          if (ta !== null && tb !== null && ta !== tb) return (ta - tb) * dir;
        }
        const sa = typeof a.sort === "number" ? a.sort : 999999;
        const sb = typeof b.sort === "number" ? b.sort : 999999;
        if (sa !== sb) return sa - sb;
        return b.updatedAt - a.updatedAt;
      });

      return sorted;
    },
    [options, storeByName],
  );

  const renameCategory = useCallback(async (oldName: string, newName: string) => {
    const from = oldName.trim();
    const to = newName.trim();
    if (!from || !to) return;
    if (from.toLowerCase() === to.toLowerCase()) return;

    const ts = nowMs();

    const allItems = await idbGetAll<Item>("items");
    const nextItems: Item[] = [];
    const fromLower = from.toLowerCase();
    for (const it of allItems) {
      if (it.syncState === "deleted") continue;
      if (String(it.category || "").trim().toLowerCase() !== fromLower) continue;
      nextItems.push({ ...it, category: to, updatedAt: ts, syncState: "dirty" });
    }
    if (nextItems.length) await idbBulkPut("items", nextItems);

    const allMeas = await idbGetAll<Measurement>("measurements");
    const nextMeas: Measurement[] = [];
    for (const m of allMeas) {
      if (m.syncState === "deleted") continue;
      if (String(m.forCategory || "").trim().toLowerCase() !== fromLower) continue;
      nextMeas.push({ ...m, forCategory: to, updatedAt: ts, syncState: "dirty" });
    }
    if (nextMeas.length) await idbBulkPut("measurements", nextMeas);

    if (nextItems.length || nextMeas.length) notifyDbChanged();
  }, []);

  const exportBundle = useCallback(
    async (opts?: { includeDeleted?: boolean }): Promise<ExportBundleV2> => {
      const snap = await idbGetSnapshot();
      const allAttachments = await idbGetAll<AttachmentRecord>("attachments");
      const attachmentByParentKey = new Map<string, AttachmentMeta[]>();
      for (const att of allAttachments) {
        if (!att.sourceUrl) continue;
        const entry: AttachmentMeta = {
          id: att.id,
          url: att.sourceUrl,
          name: att.name ?? null,
          mime: att.mime ?? null,
          size: typeof att.size === "number" ? att.size : null,
          createdAt: typeof att.createdAt === "number" ? att.createdAt : Date.now(),
          updatedAt: typeof att.updatedAt === "number" ? att.updatedAt : Date.now(),
        };
        const key = `${att.parentType}:${att.parentId}`;
        if (!attachmentByParentKey.has(key)) attachmentByParentKey.set(key, []);
        attachmentByParentKey.get(key)!.push(entry);
      }
      const includeDeleted = Boolean(opts?.includeDeleted);
      const itemsBase = includeDeleted ? snap.items : snap.items.filter((i) => i.syncState !== "deleted");
      const optsBase = includeDeleted ? snap.options : snap.options.filter((o) => o.syncState !== "deleted");
      const itemsOut = itemsBase.map((it) => ({
        ...it,
        attachments: attachmentByParentKey.get(`item:${it.id}`) || [],
      })) as any[];
      const optsOut = optsBase.map((o) => ({
        ...o,
        attachments: attachmentByParentKey.get(`option:${o.id}`) || [],
      })) as any[];
      const measOut = includeDeleted ? snap.measurements : snap.measurements.filter((m) => m.syncState !== "deleted");
      const roomsOut = includeDeleted ? snap.rooms : snap.rooms.filter((r) => r.syncState !== "deleted");
      const storesOut = includeDeleted ? snap.stores : snap.stores.filter((s) => s.syncState !== "deleted");
      const homeMeta = sanitizeHomeMeta(snap.meta.home);
      const plannerMeta = sanitizePlannerMeta(snap.meta.planner);
      const exportedAt = nowMs();
      const bundle: ExportBundleV2 = {
        version: 2,
        exportedAt: new Date(exportedAt).toISOString(),
        exportMeta: {
          exportedAt,
          exportedBy: "human",
          schemaVersion: 2,
          sessionId: newId("export"),
        },
        home: homeMeta,
        planner: plannerMeta,
        rooms: roomsOut,
        measurements: measOut,
        items: itemsOut,
        options: optsOut,
        stores: storesOut,
      };
      return bundle;
    },
    [],
  );

  const importBundle = useCallback(async (bundle: unknown, opts?: { mode?: "merge" | "replace"; aiAssisted?: boolean }) => {
    const normalized = normalizeBundle(bundle);
    if (!normalized) {
      const keys =
        bundle && typeof bundle === "object" && !Array.isArray(bundle) ? Object.keys(bundle as Record<string, unknown>) : [];
      throw new Error(`Unrecognized import format${keys.length ? ` (keys: ${keys.join(", ")})` : ""}`);
    }

    const mode = opts?.mode || "merge";
    const sessionId = newId("import");
    const importedAt = nowMs();

    const detectedAi =
      normalized.exportMeta?.exportedBy === "ai" ||
      [...normalized.items, ...normalized.options, ...normalized.measurements].some(
        (e) => e.provenance?.createdBy === "ai" || e.provenance?.lastEditedBy === "ai",
      );
    const aiAssisted = Boolean(opts?.aiAssisted) || detectedAi;
    const actor: Actor = aiAssisted ? "ai" : "import";

    const existingSnap = mode === "merge" ? await idbGetSnapshot() : null;

    function asStringArray(value: unknown): string[] {
      return Array.isArray(value) ? value.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
    }

    function uniqStable(values: string[]): string[] {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const v of values) {
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
      }
      return out;
    }

    function buildNewProvenance(incoming: Provenance | undefined): Provenance {
      const base = sanitizeProvenance(incoming) ?? {};
      return {
        ...base,
        createdBy: actor,
        createdAt: importedAt,
        lastEditedBy: actor,
        lastEditedAt: importedAt,
        dataSource: base.dataSource ?? "estimated",
        sourceRef: typeof base.sourceRef === "undefined" ? null : base.sourceRef,
        reviewStatus: "needs_review",
        verifiedAt: null,
        verifiedBy: null,
        modifiedFields: null,
        changeLog: null,
      };
    }

    function buildChangedProvenance(existing: Provenance | undefined, incoming: Provenance | undefined, changes: ReturnType<typeof diffMeasurement>): Provenance {
      const prev = sanitizeProvenance(existing) ?? {};
      const inc = sanitizeProvenance(incoming) ?? {};

      const prevFields = asStringArray(prev.modifiedFields);
      const nextFields = uniqStable([...prevFields, ...changes.map((c) => c.field)]);

      const prevLog = Array.isArray(prev.changeLog) ? prev.changeLog : [];
      const nextLog = [
        ...prevLog,
        ...changes.map((c) => ({
          field: c.field,
          from: c.from,
          to: c.to,
          by: actor,
          at: importedAt,
          sessionId,
        })),
      ];

      return {
        ...prev,
        ...inc,
        createdBy: typeof prev.createdBy === "undefined" ? inc.createdBy : prev.createdBy,
        createdAt: typeof prev.createdAt === "undefined" ? inc.createdAt : prev.createdAt,
        verifiedAt: typeof prev.verifiedAt === "undefined" ? inc.verifiedAt : prev.verifiedAt,
        verifiedBy: typeof prev.verifiedBy === "undefined" ? inc.verifiedBy : prev.verifiedBy,
        lastEditedBy: actor,
        lastEditedAt: importedAt,
        reviewStatus: "ai_modified",
        modifiedFields: nextFields,
        changeLog: nextLog,
      };
    }

    if (mode === "replace") {
      await idbResetAll();
      await idbSetMeta("home", normalized.home);
    }

    if (normalized.planner) {
      await idbSetMeta("planner", sanitizePlannerMeta(normalized.planner));
    }

    await idbBulkPut("rooms", normalized.rooms);

    const incomingStores = Array.isArray(normalized.stores) ? normalized.stores : [];
    const existingStoresById = new Map((existingSnap?.stores || []).map((s) => [s.id, s] as const));
    const storesToPut: Store[] = [];
    for (const incoming of incomingStores) {
      const existing = existingStoresById.get(incoming.id);
      if (!existing) {
        storesToPut.push({
          ...incoming,
          syncState: incoming.syncState === "deleted" ? "deleted" : "dirty",
          remoteId: typeof incoming.remoteId === "undefined" ? null : incoming.remoteId,
          updatedAt: importedAt,
          provenance: buildNewProvenance(incoming.provenance),
        });
        continue;
      }
      const changes = diffStore(existing, incoming);
      if (!changes.length) continue;
      storesToPut.push({
        ...existing,
        ...incoming,
        createdAt: existing.createdAt,
        remoteId: typeof existing.remoteId === "undefined" ? incoming.remoteId : existing.remoteId,
        syncState: incoming.syncState === "deleted" ? "deleted" : "dirty",
        updatedAt: importedAt,
        provenance: buildChangedProvenance(existing.provenance, incoming.provenance, changes),
      });
    }
    if (storesToPut.length) await idbBulkPut("stores", storesToPut);

    const existingMeasById = new Map((existingSnap?.measurements || []).map((m) => [m.id, m] as const));
    const measToPut: Measurement[] = [];
    for (const incoming of normalized.measurements) {
      const existing = existingMeasById.get(incoming.id);
      if (!existing) {
        measToPut.push({
          ...incoming,
          syncState: incoming.syncState === "deleted" ? "deleted" : "dirty",
          remoteId: typeof incoming.remoteId === "undefined" ? null : incoming.remoteId,
          updatedAt: importedAt,
          provenance: buildNewProvenance(incoming.provenance),
        });
        continue;
      }
      const changes = diffMeasurement(existing, incoming);
      if (!changes.length) continue;
      measToPut.push({
        ...existing,
        ...incoming,
        createdAt: existing.createdAt,
        remoteId: typeof existing.remoteId === "undefined" ? incoming.remoteId : existing.remoteId,
        syncState: incoming.syncState === "deleted" ? "deleted" : "dirty",
        updatedAt: importedAt,
        provenance: buildChangedProvenance(existing.provenance, incoming.provenance, changes),
      });
    }
    if (measToPut.length) await idbBulkPut("measurements", measToPut);

    const existingItemsById = new Map((existingSnap?.items || []).map((i) => [i.id, i] as const));
    const itemsToPut: Item[] = [];
    for (const incoming of normalized.items) {
      const existing = existingItemsById.get(incoming.id);
      if (!existing) {
        itemsToPut.push({
          ...incoming,
          syncState: incoming.syncState === "deleted" ? "deleted" : "dirty",
          remoteId: typeof incoming.remoteId === "undefined" ? null : incoming.remoteId,
          updatedAt: importedAt,
          provenance: buildNewProvenance(incoming.provenance),
        });
        continue;
      }
      const changes = diffItem(existing, incoming);
      if (!changes.length) continue;
      itemsToPut.push({
        ...existing,
        ...incoming,
        createdAt: existing.createdAt,
        remoteId: typeof existing.remoteId === "undefined" ? incoming.remoteId : existing.remoteId,
        syncState: incoming.syncState === "deleted" ? "deleted" : "dirty",
        updatedAt: importedAt,
        provenance: buildChangedProvenance(existing.provenance, incoming.provenance, changes),
      });
    }
    if (itemsToPut.length) await idbBulkPut("items", itemsToPut);

    const existingOptsById = new Map((existingSnap?.options || []).map((o) => [o.id, o] as const));
    const optsToPut: Option[] = [];
    for (const incoming of normalized.options) {
      const existing = existingOptsById.get(incoming.id);
      if (!existing) {
        optsToPut.push({
          ...incoming,
          syncState: incoming.syncState === "deleted" ? "deleted" : "dirty",
          remoteId: typeof incoming.remoteId === "undefined" ? null : incoming.remoteId,
          updatedAt: importedAt,
          provenance: buildNewProvenance(incoming.provenance),
        });
        continue;
      }
      const changes = diffOption(existing, incoming);
      if (!changes.length) continue;
      optsToPut.push({
        ...existing,
        ...incoming,
        createdAt: existing.createdAt,
        remoteId: typeof existing.remoteId === "undefined" ? incoming.remoteId : existing.remoteId,
        syncState: incoming.syncState === "deleted" ? "deleted" : "dirty",
        updatedAt: importedAt,
        provenance: buildChangedProvenance(existing.provenance, incoming.provenance, changes),
      });
    }
    if (optsToPut.length) await idbBulkPut("options", optsToPut);

    const rawItems = Array.isArray((bundle as any)?.items) ? ((bundle as any).items as any[]) : [];
    for (const raw of rawItems) {
      const id = typeof raw?.id === "string" ? raw.id : "";
      if (!id) continue;
      const atts = raw?.attachments;
      if (!Array.isArray(atts)) continue;
      const metas = atts.map(parseAttachmentMeta).filter(Boolean) as AttachmentMeta[];
      await replaceAttachmentsForParent("item", id, metas);
    }

    const rawOptions = Array.isArray((bundle as any)?.options) ? ((bundle as any).options as any[]) : [];
    for (const raw of rawOptions) {
      const id = typeof raw?.id === "string" ? raw.id : "";
      if (!id) continue;
      const atts = raw?.attachments;
      if (!Array.isArray(atts)) continue;
      const metas = atts.map(parseAttachmentMeta).filter(Boolean) as AttachmentMeta[];
      await replaceAttachmentsForParent("option", id, metas);
    }

    notifyDbChanged();
  }, []);

  const resetLocal = useCallback(async () => {
    await idbResetAll();
    notifyDbChanged();
  }, []);

  const loadExampleTownHollywood = useCallback(
    async (mode: "merge" | "replace" = "merge") => {
      const example = getTownHollywoodExampleBundle();
      await importBundle(example, { mode });
    },
    [importBundle],
  );

  const dirtyCounts = useMemo(
    () => ({
      items: items.filter((i) => i.syncState !== "clean").length,
      options: options.filter((o) => o.syncState !== "clean").length,
      measurements: measurements.filter((m) => m.syncState !== "clean").length,
      rooms: rooms.filter((r) => r.syncState !== "clean").length,
      stores: stores.filter((s) => s.syncState !== "clean").length,
    }),
    [items, measurements, options, rooms, stores],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      ready,
      home,
      planner,
      rooms,
      orderedRooms,
      roomNameById,
      measurements,
      items,
      options,
      stores,
      orderedStores,
      unitPreference,
      lastSyncAt,
      lastSyncSummary,
      dirtyCounts,
      saveHome,
      savePlanner,
      setUnitPreference: saveUnitPreference,
      reorderRooms,
      reorderStores,
      reorderItems,
      reorderMeasurements,
      reorderOptions,
      renameCategory,
      createRoom,
      deleteRoom,
      createItem,
      updateItem,
      deleteItem,
      convertItemToOption,
      createOption,
      updateOption,
      deleteOption,
      sortAndFilterOptions,
      createMeasurement,
      updateMeasurement,
      deleteMeasurement,
      updateRoom,
      createStore,
      updateStore,
      deleteStore,
      exportBundle,
      importBundle,
      resetLocal,
      loadExampleTownHollywood,
    }),
    [
      ready,
      home,
      planner,
      rooms,
      orderedRooms,
      roomNameById,
      measurements,
      items,
      options,
      stores,
      orderedStores,
      unitPreference,
      lastSyncAt,
      lastSyncSummary,
      dirtyCounts,
      saveHome,
      savePlanner,
      saveUnitPreference,
      reorderRooms,
      reorderStores,
      reorderItems,
      reorderMeasurements,
      reorderOptions,
      renameCategory,
      createRoom,
      deleteRoom,
      createItem,
      updateItem,
      deleteItem,
      convertItemToOption,
      createOption,
      updateOption,
      deleteOption,
      sortAndFilterOptions,
      createMeasurement,
      updateMeasurement,
      deleteMeasurement,
      updateRoom,
      createStore,
      updateStore,
      deleteStore,
      exportBundle,
      importBundle,
      resetLocal,
      loadExampleTownHollywood,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within <DataProvider />");
  return ctx;
}
