import type { ExportBundleV1, Item, Measurement, Option, Room } from "@/lib/domain";
import { idbDelete, idbGet, idbGetSnapshot, idbPut, idbSetMeta } from "@/storage/idb";
import { notifyDbChanged } from "@/storage/notify";

type PushResponse = {
  ok: boolean;
  created?: {
    items?: Record<string, string>;
    options?: Record<string, string>;
    measurements?: Record<string, string>;
    rooms?: Record<string, string>;
  };
  counts?: Record<string, number>;
  message?: string;
};

type PullResponse = { ok: boolean; bundle?: ExportBundleV1; message?: string };

function isRecordId(id: string) {
  return id.startsWith("rec");
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
}

async function rekeyOption(localId: string, remoteId: string) {
  const opt = await idbGet<Option>("options", localId);
  if (!opt) return;
  const next: Option = { ...opt, id: remoteId, remoteId, syncState: "clean" };
  await idbPut("options", next);
  await idbDelete("options", localId);
}

async function rekeyMeasurement(localId: string, remoteId: string) {
  const m = await idbGet<Measurement>("measurements", localId);
  if (!m) return;
  const next: Measurement = { ...m, id: remoteId, remoteId, syncState: "clean" };
  await idbPut("measurements", next);
  await idbDelete("measurements", localId);
}

async function applyPulledBundle(bundle: ExportBundleV1) {
  // Upsert remote records into local DB and mark them clean.
  for (const r of bundle.rooms || []) {
    const name = (r as any).name || r.id;
    const room: Room = { ...r, name, syncState: "clean", remoteId: r.remoteId || r.id || null };
    await idbPut("rooms", room);
  }
  for (const m of bundle.measurements || []) {
    const meas: Measurement = { ...m, syncState: "clean", remoteId: m.remoteId || m.id || null };
    await idbPut("measurements", meas);
  }
  for (const it of bundle.items || []) {
    const item: Item = { ...it, syncState: "clean", remoteId: it.remoteId || it.id || null };
    await idbPut("items", item);
  }
  for (const o of bundle.options || []) {
    const opt: Option = { ...o, syncState: "clean", remoteId: o.remoteId || o.id || null };
    await idbPut("options", opt);
  }
}

export async function syncNow() {
  const snap = await idbGetSnapshot();
  const dirty = {
    // Treat missing syncState as dirty so imported/example data can be pushed on first sync.
    items: snap.items.filter((x) => x.syncState !== "clean"),
    options: snap.options.filter((x) => x.syncState !== "clean"),
    measurements: snap.measurements.filter((x) => x.syncState !== "clean"),
    rooms: snap.rooms.filter((x) => x.syncState !== "clean"),
  };

  // Push changes
  const pushRes = await fetchWithTimeout("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dirty),
  });
  const pushParsed = await readJsonOrText<PushResponse>(pushRes);
  const pushJson = pushParsed.json;
  if (!pushRes.ok || !pushJson?.ok) {
    const msg = pushJson?.message || pushParsed.text || `Sync push failed (${pushRes.status})`;
    throw new Error(msg);
  }

  const created = pushJson.created || {};

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

  // Mark updated records clean; delete locally-deleted records.
  const snapAfter = await idbGetSnapshot();
  for (const it of snapAfter.items) {
    if (it.syncState === "dirty" && isRecordId(it.id)) await idbPut("items", { ...it, syncState: "clean" });
    if (it.syncState === "deleted") await idbDelete("items", it.id);
  }
  for (const o of snapAfter.options) {
    if (o.syncState === "dirty" && isRecordId(o.id)) await idbPut("options", { ...o, syncState: "clean" });
    if (o.syncState === "deleted") await idbDelete("options", o.id);
  }
  for (const m of snapAfter.measurements) {
    if (m.syncState === "dirty" && isRecordId(m.id)) await idbPut("measurements", { ...m, syncState: "clean" });
    if (m.syncState === "deleted") await idbDelete("measurements", m.id);
  }
  for (const r of snapAfter.rooms) {
    if (r.syncState === "dirty") await idbPut("rooms", { ...r, syncState: "clean" });
  }

  // Pull remote and merge
  const pullRes = await fetchWithTimeout("/api/sync/pull", {}, 20000);
  const pullParsed = await readJsonOrText<PullResponse>(pullRes);
  const pullJson = pullParsed.json;
  if (!pullRes.ok || !pullJson?.ok || !pullJson.bundle) {
    const msg = pullJson?.message || pullParsed.text || `Sync pull failed (${pullRes.status})`;
    throw new Error(msg);
  }
  await applyPulledBundle(pullJson.bundle);

  const summary = {
    push: pushJson.counts || {},
    pull: {
      items: pullJson.bundle.items.length,
      options: pullJson.bundle.options.length,
      measurements: pullJson.bundle.measurements.length,
      rooms: pullJson.bundle.rooms.length,
    },
  };

  await idbSetMeta("lastSyncAt", Date.now());
  await idbSetMeta("lastSyncSummary", summary);
  notifyDbChanged();

  return summary;
}
