import { createRecords, deleteRecords, getAirtableConfig, listAllRecords, updateRecords } from "../_lib/airtable.js";

function buildNotes(userNotesRaw: any, meta: any) {
  const userNotes = typeof userNotesRaw === "string" ? userNotesRaw.trimEnd() : "";
  const metaObj = meta && typeof meta === "object" ? meta : null;
  if (!metaObj || Object.keys(metaObj).length === 0) return userNotes;
  const json = JSON.stringify(metaObj);
  return `${userNotes ? `${userNotes}\n\n` : ""}--- app_meta ---\n${json}\n--- /app_meta ---`;
}

function parseBody(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: any) => (data += String(chunk)));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function isRemoteId(id: any) {
  return typeof id === "string" && id.startsWith("rec");
}

function dimsToText(d: any) {
  if (!d || typeof d !== "object") return "";
  const w = typeof d.wIn === "number" ? d.wIn : null;
  const dd = typeof d.dIn === "number" ? d.dIn : null;
  const h = typeof d.hIn === "number" ? d.hIn : null;
  if (w === null && dd === null && h === null) return "";
  const parts = [w, dd, h].map((n) => (typeof n === "number" ? String(n) : "?"));
  return `${parts.join("x")} in`;
}

function sanitizeAttachments(raw: any) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const att of raw) {
    if (!att || typeof att !== "object") continue;
    const url = typeof att.url === "string" ? att.url.trim() : "";
    if (!url) continue;
    out.push({
      id: typeof att.id === "string" ? att.id : null,
      url,
      name: typeof att.name === "string" ? att.name : null,
      mime: typeof att.mime === "string" ? att.mime : null,
      size: typeof att.size === "number" ? att.size : null,
      createdAt: typeof att.createdAt === "number" ? att.createdAt : Date.now(),
      updatedAt: typeof att.updatedAt === "number" ? att.updatedAt : Date.now(),
    });
  }
  return out;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
    return;
  }

  try {
    const body = await parseBody(req);
    const mode = typeof body?.mode === "string" ? body.mode : "commit";
    const forceCreate = mode === "reset";
    const items = Array.isArray(body.items) ? body.items : [];
    const options = Array.isArray(body.options) ? body.options : [];
    const measurements = Array.isArray(body.measurements) ? body.measurements : [];
    const rooms = Array.isArray(body.rooms) ? body.rooms : [];

    const { token, baseId, tableId, view } = getAirtableConfig();
    const PRIORITY_FIELD = process.env.AIRTABLE_PRIORITY_FIELD || "Priority";
    const SYNC_SOURCE = process.env.AIRTABLE_SYNC_SOURCE || "app";
    const SYNC_SOURCE_FIELD = process.env.AIRTABLE_SYNC_SOURCE_FIELD || "Last Sync Source";
    const SYNC_AT_FIELD = process.env.AIRTABLE_SYNC_AT_FIELD || "Last Sync At";
    const syncAtIso = new Date().toISOString();

    if (forceCreate) {
      const existing = await listAllRecords({ token, baseId, tableId, view });
      const ids = existing.map((r) => r.id).filter(Boolean);
      if (ids.length) await deleteRecords({ token, baseId, tableId, ids });
    }

    // --- Items ---
    const itemCreates: any[] = [];
    const itemCreateLocalIds: string[] = [];
    const itemUpdates: any[] = [];
    const itemDeletes: string[] = [];

    for (const it of items) {
      const localId = String(it.id || "").trim();
      if (!localId) continue;

      const syncState = String(it.syncState || "").trim();
      const remoteId = forceCreate ? null : isRemoteId(it.remoteId) ? it.remoteId : isRemoteId(it.id) ? it.id : null;

      if (syncState === "deleted") {
        if (remoteId) itemDeletes.push(remoteId);
        continue;
      }

      const meta = {
        category: it.category || "Other",
        dimensions: it.dimensions || null,
        sort: typeof it.sort === "number" ? it.sort : null,
        specs: it.specs || null,
        attachments: sanitizeAttachments(it.attachments),
        createdAt: typeof it.createdAt === "number" ? it.createdAt : Date.now(),
        updatedAt: typeof it.updatedAt === "number" ? it.updatedAt : Date.now(),
      };

      const fields: any = {
        "Record Type": "Item",
        Title: String(it.name || "Item"),
        Room: String(it.room || "Living"),
        Status: String(it.status || "Idea"),
        Price: typeof it.price === "number" ? it.price : null,
        Quantity: typeof it.qty === "number" ? Math.round(it.qty) : 1,
        Store: typeof it.store === "string" ? it.store : null,
        Link: typeof it.link === "string" ? it.link : null,
        Notes: buildNotes(it.notes, meta),
        Dimensions: dimsToText(it.dimensions),
      };
      fields[SYNC_SOURCE_FIELD] = SYNC_SOURCE;
      fields[SYNC_AT_FIELD] = syncAtIso;
      if (typeof it.priority === "number") fields[PRIORITY_FIELD] = Math.round(it.priority);

      if (remoteId) itemUpdates.push({ id: remoteId, fields });
      else {
        itemCreates.push({ fields });
        itemCreateLocalIds.push(localId);
      }
    }

    const createdItemRecords = itemCreates.length ? await createRecords({ token, baseId, tableId, records: itemCreates }) : [];
    const itemIdMap: Record<string, string> = {};
    for (let i = 0; i < createdItemRecords.length; i++) {
      const localId = itemCreateLocalIds[i];
      if (!localId) continue;
      itemIdMap[localId] = createdItemRecords[i].id;
    }

    const updatedItemRecords = itemUpdates.length ? await updateRecords({ token, baseId, tableId, records: itemUpdates }) : [];

    // --- Measurements ---
    const measCreates: any[] = [];
    const measCreateLocalIds: string[] = [];
    const measUpdates: any[] = [];
    const measDeletes: string[] = [];

    for (const m of measurements) {
      const localId = String(m.id || "").trim();
      if (!localId) continue;
      const syncState = String(m.syncState || "").trim();
      const remoteId = forceCreate ? null : isRemoteId(m.remoteId) ? m.remoteId : isRemoteId(m.id) ? m.id : null;
      if (syncState === "deleted") {
        if (remoteId) measDeletes.push(remoteId);
        continue;
      }
      const valueIn = typeof m.valueIn === "number" ? m.valueIn : 0;
      const meta = {
        sort: typeof m.sort === "number" ? m.sort : null,
        forCategory: typeof m.forCategory === "string" ? m.forCategory : null,
        forItemId: typeof m.forItemId === "string" ? m.forItemId : null,
        createdAt: typeof m.createdAt === "number" ? m.createdAt : Date.now(),
        updatedAt: typeof m.updatedAt === "number" ? m.updatedAt : Date.now(),
      };
      const fields: any = {
        "Record Type": "Measurement",
        Title: String(m.label || "Measurement"),
        "Measure Label": String(m.label || "Measurement"),
        Room: String(m.room || "Living"),
        "Value (in)": valueIn,
        "Value (cm)": valueIn * 2.54,
        "Unit Entered": "in",
        Confidence: m.confidence || null,
        Notes: buildNotes(m.notes, meta),
      };
      fields[SYNC_SOURCE_FIELD] = SYNC_SOURCE;
      fields[SYNC_AT_FIELD] = syncAtIso;
      if (remoteId) measUpdates.push({ id: remoteId, fields });
      else {
        measCreates.push({ fields });
        measCreateLocalIds.push(localId);
      }
    }

    const createdMeasRecords = measCreates.length ? await createRecords({ token, baseId, tableId, records: measCreates }) : [];
    const measurementIdMap: Record<string, string> = {};
    for (let i = 0; i < createdMeasRecords.length; i++) {
      const localId = measCreateLocalIds[i];
      if (!localId) continue;
      measurementIdMap[localId] = createdMeasRecords[i].id;
    }
    const updatedMeasRecords = measUpdates.length ? await updateRecords({ token, baseId, tableId, records: measUpdates }) : [];

    // --- Rooms (stored as Record Type = Note, one per room) ---
    const roomCreates: any[] = [];
    const roomCreateLocalIds: string[] = [];
    const roomUpdates: any[] = [];

    for (const r of rooms) {
      const rid = String(r.id || "").trim();
      if (!rid) continue;
      const syncState = String(r.syncState || "").trim();
      if (syncState === "deleted") continue;
      const remoteId = forceCreate ? null : isRemoteId(r.remoteId) ? r.remoteId : null;
      const meta = {
        sort: typeof r.sort === "number" ? r.sort : null,
        createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
        updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
      };
      const fields: any = {
        "Record Type": "Note",
        Title: `${rid} notes`,
        Room: rid,
        Notes: buildNotes(r.notes || "", meta),
      };
      fields[SYNC_SOURCE_FIELD] = SYNC_SOURCE;
      fields[SYNC_AT_FIELD] = syncAtIso;
      if (remoteId) roomUpdates.push({ id: remoteId, fields });
      else {
        roomCreates.push({ fields });
        roomCreateLocalIds.push(rid);
      }
    }

    const createdRoomRecords = roomCreates.length ? await createRecords({ token, baseId, tableId, records: roomCreates }) : [];
    const roomIdMap: Record<string, string> = {};
    for (let i = 0; i < createdRoomRecords.length; i++) {
      const localId = roomCreateLocalIds[i];
      if (!localId) continue;
      roomIdMap[localId] = createdRoomRecords[i].id;
    }
    const updatedRoomRecords = roomUpdates.length ? await updateRecords({ token, baseId, tableId, records: roomUpdates }) : [];

    // --- Options ---
    const optCreates: any[] = [];
    const optCreateLocalIds: string[] = [];
    const optUpdates: any[] = [];
    const optDeletes: string[] = [];

    // Track selected option per item so we can update item.Selected Option Id
    const selectedOptionByItem: Record<string, string> = {};

    for (const o of options) {
      const localId = String(o.id || "").trim();
      if (!localId) continue;
      const syncState = String(o.syncState || "").trim();
      const remoteId = forceCreate ? null : isRemoteId(o.remoteId) ? o.remoteId : isRemoteId(o.id) ? o.id : null;
      if (syncState === "deleted") {
        if (remoteId) optDeletes.push(remoteId);
        continue;
      }

      const parentLocal = String(o.itemId || "").trim();
      const parentRemote = itemIdMap[parentLocal] || (isRemoteId(parentLocal) ? parentLocal : null);
      if (!parentRemote) continue; // parent not known yet

      const finalTotal =
        (typeof o.price === "number" ? o.price : 0) +
        (typeof o.shipping === "number" ? o.shipping : 0) +
        (typeof o.taxEstimate === "number" ? o.taxEstimate : 0) -
        (typeof o.discount === "number" ? o.discount : 0);

      const meta = {
        selected: Boolean(o.selected),
        sort: typeof o.sort === "number" ? o.sort : null,
        attachments: sanitizeAttachments(o.attachments),
        createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
        updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
      };

      const fields: any = {
        "Record Type": "Option",
        Title: String(o.title || "Option"),
        "Parent Item Record Id": parentRemote,
        Store: typeof o.store === "string" ? o.store : null,
        Link: typeof o.link === "string" ? o.link : null,
        "Promo Code": typeof o.promoCode === "string" ? o.promoCode : null,
        Discount: typeof o.discount === "number" ? o.discount : null,
        Shipping: typeof o.shipping === "number" ? o.shipping : null,
        "Tax Estimate": typeof o.taxEstimate === "number" ? o.taxEstimate : null,
        "Final Total": Number.isFinite(finalTotal) ? finalTotal : null,
        Price: typeof o.price === "number" ? o.price : null,
        Dimensions: typeof o.dimensionsText === "string" ? o.dimensionsText : null,
        Notes: buildNotes(o.notes, meta),
      };
      fields[SYNC_SOURCE_FIELD] = SYNC_SOURCE;
      fields[SYNC_AT_FIELD] = syncAtIso;

      if (remoteId) {
        optUpdates.push({ id: remoteId, fields });
        if (meta.selected) selectedOptionByItem[parentRemote] = remoteId;
      } else {
        optCreates.push({ fields });
        optCreateLocalIds.push(localId);
        // selected mapping handled after create
      }
    }

    const createdOptRecords = optCreates.length ? await createRecords({ token, baseId, tableId, records: optCreates }) : [];
    const optionIdMap: Record<string, string> = {};
    for (let i = 0; i < createdOptRecords.length; i++) {
      const localId = optCreateLocalIds[i];
      if (!localId) continue;
      optionIdMap[localId] = createdOptRecords[i].id;
    }

    const updatedOptRecords = optUpdates.length ? await updateRecords({ token, baseId, tableId, records: optUpdates }) : [];

    // After creates, we can't reliably know which created option was selected without an id field.
    // We keep selection server-side via meta, but item.Selected Option Id is best-effort only.

    // Apply deletes last
    const deleted = {
      items: itemDeletes.length ? await deleteRecords({ token, baseId, tableId, ids: itemDeletes }) : [],
      options: optDeletes.length ? await deleteRecords({ token, baseId, tableId, ids: optDeletes }) : [],
      measurements: measDeletes.length ? await deleteRecords({ token, baseId, tableId, ids: measDeletes }) : [],
    };

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        created: {
          items: itemIdMap,
          options: optionIdMap,
          measurements: measurementIdMap,
          rooms: roomIdMap,
        },
        counts: {
          createdItems: createdItemRecords.length,
          updatedItems: updatedItemRecords.length,
          createdOptions: createdOptRecords.length,
          updatedOptions: updatedOptRecords.length,
          createdMeasurements: createdMeasRecords.length,
          updatedMeasurements: updatedMeasRecords.length,
          createdRooms: createdRoomRecords.length,
          updatedRooms: updatedRoomRecords.length,
          deletedItems: deleted.items.length,
          deletedOptions: deleted.options.length,
          deletedMeasurements: deleted.measurements.length,
        },
        message: "Sync push complete",
      }),
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: err?.message || "Sync push failed" }));
  }
}
