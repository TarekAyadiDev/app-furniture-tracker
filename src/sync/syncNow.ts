import type { ExportBundleV1, Item, Measurement, Option, Room, Store, SubItem } from "@/lib/domain";
import { newId } from "@/lib/id";
import { idbDelete, idbGet, idbGetAll, idbGetAllByIndex, idbGetSnapshot, idbPut, idbSetMeta } from "@/storage/idb";
import { notifyDbChanged } from "@/storage/notify";
import { rekeyAttachmentParent, type AttachmentRecord } from "@/storage/attachments";

type AttachmentMeta = {
  id: string;
  url: string;
  name: string | null;
  mime: string | null;
  size: number | null;
  createdAt: number;
  updatedAt: number;
};

type PushResponse = {
  ok: boolean;
  created?: {
    items?: Record<string, string>;
    options?: Record<string, string>;
    measurements?: Record<string, string>;
    rooms?: Record<string, string>;
    stores?: Record<string, string>;
  };
  counts?: Record<string, number>;
  errors?: Array<{ entity: string; action: string; id?: string; title?: string; message: string }>;
  message?: string;
};

type PullResponse = { ok: boolean; bundle?: ExportBundleV1; message?: string };
type PushMode = "commit" | "reset";

function isRecordId(id: string) {
  return id.startsWith("rec");
}

function attachmentParentKey(parentType: "item" | "option" | "subItem", parentId: string) {
  return `${parentType}:${parentId}`;
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

async function replaceAttachmentsForParent(
  parentType: "item" | "option" | "subItem",
  parentId: string,
  metas: AttachmentMeta[],
) {
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

async function readJsonOrText<T>(res: Response): Promise<{ json: T | null; text: string }> {
  const text = await res.text().catch(() => "");
  if (!text) return { json: null, text: "" };
  try {
    return { json: JSON.parse(text) as T, text };
  } catch {
    return { json: null, text };
  }
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function rekeyItem(localId: string, remoteId: string) {
  const item = await idbGet<Item>("items", localId);
  if (!item) return;
  const next: Item = { ...item, id: remoteId, remoteId, syncState: "clean" };
  await idbPut("items", next);
  await idbDelete("items", localId);

  // Update options that referenced the local item id.
  const snap = await idbGetSnapshot();
  for (const o of snap.options) {
    if (o.itemId === localId) {
      await idbPut("options", { ...o, itemId: remoteId, syncState: o.syncState || "dirty" });
    }
  }
  await rekeyAttachmentParent("item", localId, remoteId);
}

async function rekeyOption(localId: string, remoteId: string) {
  const opt = await idbGet<Option>("options", localId);
  if (!opt) return;
  const next: Option = { ...opt, id: remoteId, remoteId, syncState: "clean" };
  await idbPut("options", next);
  await idbDelete("options", localId);
  const snap = await idbGetSnapshot();
  for (const s of snap.subItems) {
    if (s.optionId === localId) {
      await idbPut("subItems", { ...s, optionId: remoteId, syncState: s.syncState || "dirty" });
    }
  }
  await rekeyAttachmentParent("option", localId, remoteId);
}

async function rekeyMeasurement(localId: string, remoteId: string) {
  const m = await idbGet<Measurement>("measurements", localId);
  if (!m) return;
  const next: Measurement = { ...m, id: remoteId, remoteId, syncState: "clean" };
  await idbPut("measurements", next);
  await idbDelete("measurements", localId);
}

async function rekeyStore(localId: string, remoteId: string) {
  const s = await idbGet<Store>("stores", localId);
  if (!s) return;
  const next: Store = { ...s, id: remoteId, remoteId, syncState: "clean" };
  await idbPut("stores", next);
  await idbDelete("stores", localId);
}

async function applyPulledBundle(bundle: ExportBundleV1) {
  // Upsert remote records into local DB and mark them clean.
  for (const r of bundle.rooms || []) {
    const name = (r as any).name || r.id;
    const room: Room = { ...r, name, syncState: "clean", remoteId: r.remoteId || r.id || null };
    await idbPut("rooms", room);
  }
  for (const s of (bundle as any).stores || []) {
    const store: Store = { ...s, syncState: "clean", remoteId: (s as any).remoteId || (s as any).id || null };
    await idbPut("stores", store);
  }
  for (const m of bundle.measurements || []) {
    const meas: Measurement = { ...m, syncState: "clean", remoteId: m.remoteId || m.id || null };
    await idbPut("measurements", meas);
  }
  for (const it of bundle.items || []) {
    const anyItem = it as any;
    const attachments = Array.isArray(anyItem.attachments) ? anyItem.attachments : [];
    const { attachments: _ignoredItemAttachments, ...itemRest } = anyItem;
    const item: Item = { ...itemRest, syncState: "clean", remoteId: anyItem.remoteId || anyItem.id || null };
    await idbPut("items", item);
    const metas = attachments.map(parseAttachmentMeta).filter(Boolean) as AttachmentMeta[];
    await replaceAttachmentsForParent("item", item.id, metas);
  }
  for (const o of bundle.options || []) {
    const anyOpt = o as any;
    const attachments = Array.isArray(anyOpt.attachments) ? anyOpt.attachments : [];
    const { attachments: _ignoredOptAttachments, ...optRest } = anyOpt;
    const opt: Option = { ...optRest, syncState: "clean", remoteId: anyOpt.remoteId || anyOpt.id || null };
    await idbPut("options", opt);
    const metas = attachments.map(parseAttachmentMeta).filter(Boolean) as AttachmentMeta[];
    await replaceAttachmentsForParent("option", opt.id, metas);
  }
  for (const s of (bundle as any).subItems || []) {
    const anySub = s as any;
    const attachments = Array.isArray(anySub.attachments) ? anySub.attachments : [];
    const { attachments: _ignoredSubAttachments, ...subRest } = anySub;
    const sub: SubItem = { ...subRest, syncState: "clean", remoteId: anySub.remoteId || anySub.id || null };
    await idbPut("subItems", sub);
    const metas = attachments.map(parseAttachmentMeta).filter(Boolean) as AttachmentMeta[];
    await replaceAttachmentsForParent("subItem", sub.id, metas);
  }
}

export async function syncNow() {
  const push = await pushChanges("commit");
  const pull = await pullChanges();
  const summary = { push: push.counts, pull: pull.counts };
  await idbSetMeta("lastSyncAt", Date.now());
  await idbSetMeta("lastPullAt", Date.now());
  await idbSetMeta("lastSyncSummary", summary);
  notifyDbChanged();
  return summary;
}

async function pushChanges(mode: PushMode = "commit") {
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
  const dirty = {
    // Treat missing syncState as dirty so imported/example data can be pushed on first sync.
    items: snap.items
      .filter((x) => x.syncState !== "clean")
      .map((it) => ({
        ...it,
        attachments: attachmentByParentKey.get(`item:${it.id}`) || [],
      })),
    options: snap.options
      .filter((x) => x.syncState !== "clean")
      .map((o) => ({
        ...o,
        parentRemoteId: snap.items.find((it) => it.id === o.itemId)?.remoteId || null,
        attachments: attachmentByParentKey.get(`option:${o.id}`) || [],
      })),
    measurements: snap.measurements.filter((x) => x.syncState !== "clean"),
    rooms: snap.rooms.filter((x) => x.syncState !== "clean"),
    stores: snap.stores.filter((x) => x.syncState !== "clean"),
  };

  const pushRes = await fetchWithTimeout("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, ...dirty }),
  });
  const pushParsed = await readJsonOrText<PushResponse>(pushRes);
  const pushJson = pushParsed.json;
  if (!pushRes.ok || !pushJson?.ok) {
    const msg = pushJson?.message || pushParsed.text || `Sync push failed (${pushRes.status})`;
    throw new Error(msg);
  }

  const created = pushJson.created || {};
  const failedUpdateIds = new Set<string>();
  for (const err of pushJson.errors || []) {
    if (err.action === "update" && typeof err.id === "string" && err.id) failedUpdateIds.add(err.id);
  }

  // Rekey newly-created records so all devices converge on Airtable record ids.
  for (const [localId, remoteId] of Object.entries(created.items || {})) {
    await rekeyItem(localId, remoteId);
  }
  for (const [localId, remoteId] of Object.entries(created.measurements || {})) {
    await rekeyMeasurement(localId, remoteId);
  }
  for (const [localId, remoteId] of Object.entries(created.options || {})) {
    await rekeyOption(localId, remoteId);
  }
  for (const [roomId, remoteId] of Object.entries(created.rooms || {})) {
    const r = await idbGet<Room>("rooms", roomId);
    if (r) await idbPut("rooms", { ...r, remoteId, syncState: "clean" });
  }
  for (const [localId, remoteId] of Object.entries(created.stores || {})) {
    await rekeyStore(localId, remoteId);
  }

  // Mark updated records clean; delete locally-deleted records.
  const snapAfter = await idbGetSnapshot();
  for (const it of snapAfter.items) {
    if (it.syncState === "dirty" && isRecordId(it.id) && !failedUpdateIds.has(it.id)) {
      await idbPut("items", { ...it, syncState: "clean" });
    }
    if (it.syncState === "deleted") await idbDelete("items", it.id);
  }
  for (const o of snapAfter.options) {
    if (o.syncState === "dirty" && isRecordId(o.id) && !failedUpdateIds.has(o.id)) {
      await idbPut("options", { ...o, syncState: "clean" });
    }
    if (o.syncState === "deleted") await idbDelete("options", o.id);
  }
  for (const m of snapAfter.measurements) {
    if (m.syncState === "dirty" && isRecordId(m.id) && !failedUpdateIds.has(m.id)) {
      await idbPut("measurements", { ...m, syncState: "clean" });
    }
    if (m.syncState === "deleted") await idbDelete("measurements", m.id);
  }
  for (const r of snapAfter.rooms) {
    if (r.syncState === "dirty" && !failedUpdateIds.has(r.remoteId || r.id)) {
      await idbPut("rooms", { ...r, syncState: "clean" });
    }
  }
  for (const s of snapAfter.stores) {
    if (s.syncState === "dirty" && isRecordId(s.id) && !failedUpdateIds.has(s.id)) {
      await idbPut("stores", { ...s, syncState: "clean" });
    }
    if (s.syncState === "deleted") await idbDelete("stores", s.id);
  }

  return { counts: pushJson.counts || {}, errors: pushJson.errors || [] };
}

async function pullChanges() {
  const pullRes = await fetchWithTimeout("/api/sync/pull", {}, 20000);
  const pullParsed = await readJsonOrText<PullResponse>(pullRes);
  const pullJson = pullParsed.json;
  if (!pullRes.ok || !pullJson?.ok || !pullJson.bundle) {
    const msg = pullJson?.message || pullParsed.text || `Sync pull failed (${pullRes.status})`;
    throw new Error(msg);
  }
  await applyPulledBundle(pullJson.bundle);

  return {
    counts: {
      items: pullJson.bundle.items.length,
      options: pullJson.bundle.options.length,
      measurements: pullJson.bundle.measurements.length,
      rooms: pullJson.bundle.rooms.length,
      stores: Array.isArray((pullJson.bundle as any).stores) ? (pullJson.bundle as any).stores.length : 0,
    },
  };
}

export async function pushNow(mode: PushMode = "commit") {
  const push = await pushChanges(mode);
  const summary = { push: push.counts, pull: { items: 0, options: 0, measurements: 0, rooms: 0, stores: 0 } };
  await idbSetMeta("lastSyncAt", Date.now());
  await idbSetMeta("lastSyncSummary", summary);
  notifyDbChanged();
  return { ...summary, pushErrors: push.errors };
}

export async function pullNow() {
  const pull = await pullChanges();
  const summary = { push: {}, pull: pull.counts };
  await idbSetMeta("lastSyncAt", Date.now());
  await idbSetMeta("lastPullAt", Date.now());
  await idbSetMeta("lastSyncSummary", summary);
  notifyDbChanged();
  return summary;
}
