import { createRecords, deleteRecords, getAirtableConfig, listAllRecords, updateRecords } from "../_lib/airtable.js";

type PushError = {
  entity: "item" | "option" | "measurement" | "room" | "store";
  action: "create" | "update";
  id?: string;
  title?: string;
  message: string;
};

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

function isNotFoundError(message: string) {
  return /NOT_FOUND|does not exist/i.test(message || "");
}

function normalizeStoreValue(value: any): string | null {
  const name = typeof value === "string" ? value.trim() : "";
  return name ? name : null;
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

function optionBaseTotal(o: any) {
  return (typeof o.price === "number" ? o.price : 0) + (typeof o.shipping === "number" ? o.shipping : 0) + (typeof o.taxEstimate === "number" ? o.taxEstimate : 0);
}

function optionDiscountAmount(o: any) {
  const value = typeof o.discountValue === "number" ? o.discountValue : null;
  const type = typeof o.discountType === "string" ? o.discountType : null;
  if (value !== null && value > 0) {
    if (type === "amount") return value;
    if (type === "percent") return optionBaseTotal(o) * (value / 100);
  }
  return typeof o.discount === "number" ? o.discount : 0;
}

async function safeCreateRecords(opts: { token: string; baseId: string; tableId: string; records: any[]; typecast?: boolean }) {
  if (!opts.records.length) return { records: [] as Array<any | null>, errors: [] as Array<{ index: number; message: string }> };
  try {
    const created = await createRecords(opts);
    return { records: created as Array<any | null>, errors: [] as Array<{ index: number; message: string }> };
  } catch {
    const results: Array<any | null> = new Array(opts.records.length).fill(null);
    const errors: Array<{ index: number; message: string }> = [];
    for (let i = 0; i < opts.records.length; i++) {
      try {
        const created = await createRecords({ ...opts, records: [opts.records[i]] });
        results[i] = created[0] || null;
      } catch (err: any) {
        errors.push({ index: i, message: err?.message || "Unknown error" });
      }
    }
    return { records: results, errors };
  }
}

async function safeUpdateRecords(opts: { token: string; baseId: string; tableId: string; records: any[]; typecast?: boolean }) {
  if (!opts.records.length) return { records: [] as Array<any | null>, errors: [] as Array<{ index: number; message: string }> };
  try {
    const updated = await updateRecords(opts);
    return { records: updated as Array<any | null>, errors: [] as Array<{ index: number; message: string }> };
  } catch {
    const results: Array<any | null> = new Array(opts.records.length).fill(null);
    const errors: Array<{ index: number; message: string }> = [];
    for (let i = 0; i < opts.records.length; i++) {
      try {
        const updated = await updateRecords({ ...opts, records: [opts.records[i]] });
        results[i] = updated[0] || null;
      } catch (err: any) {
        errors.push({ index: i, message: err?.message || "Unknown error" });
      }
    }
    return { records: results, errors };
  }
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
    const stores = Array.isArray(body.stores) ? body.stores : [];

    const { token, baseId, tableId, view } = getAirtableConfig();
    const PRIORITY_FIELD = process.env.AIRTABLE_PRIORITY_FIELD || "Priority";
    const SYNC_SOURCE = process.env.AIRTABLE_SYNC_SOURCE || "app";
    const SYNC_SOURCE_FIELD = process.env.AIRTABLE_SYNC_SOURCE_FIELD || "Last Sync Source";
    const SYNC_AT_FIELD = process.env.AIRTABLE_SYNC_AT_FIELD || "Last Sync At";
    const syncAtIso = new Date().toISOString();
    const pushErrors: PushError[] = [];

    if (forceCreate) {
      const existing = await listAllRecords({ token, baseId, tableId, view });
      const ids = existing.map((r) => r.id).filter(Boolean);
      if (ids.length) await deleteRecords({ token, baseId, tableId, ids });
    }

    // --- Items ---
    const itemCreates: any[] = [];
    const itemCreateLocalIds: string[] = [];
    const itemUpdates: any[] = [];
    const itemUpdateLocalIds: string[] = [];
    const itemDeletes: string[] = [];
    const itemIdMap: Record<string, string> = {};

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
        discountType: it.discountType || null,
        discountValue: typeof it.discountValue === "number" ? it.discountValue : null,
        localId,
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
        Store: normalizeStoreValue(it.store),
        Link: typeof it.link === "string" ? it.link : null,
        Notes: buildNotes(it.notes, meta),
        Dimensions: dimsToText(it.dimensions),
      };
      if (typeof it.selectedOptionId === "string" && it.selectedOptionId) {
        fields["Selected Option Id"] = it.selectedOptionId;
      }
      fields[SYNC_SOURCE_FIELD] = SYNC_SOURCE;
      fields[SYNC_AT_FIELD] = syncAtIso;
      if (typeof it.priority === "number") fields[PRIORITY_FIELD] = Math.round(it.priority);

      if (remoteId) {
        itemIdMap[localId] = remoteId;
        itemUpdates.push({ id: remoteId, fields });
        itemUpdateLocalIds.push(localId);
      }
      else {
        itemCreates.push({ fields });
        itemCreateLocalIds.push(localId);
      }
    }

    const itemCreateResult = await safeCreateRecords({ token, baseId, tableId, records: itemCreates, typecast: true });
    for (let i = 0; i < itemCreateResult.records.length; i++) {
      const localId = itemCreateLocalIds[i];
      if (!localId) continue;
      const rec = itemCreateResult.records[i];
      if (rec && rec.id) itemIdMap[localId] = rec.id;
    }

    if (itemCreateResult.errors.length) {
      for (const err of itemCreateResult.errors) {
        const title = itemCreates[err.index]?.fields?.Title;
        pushErrors.push({ entity: "item", action: "create", title, message: err.message });
      }
    }
    const itemUpdateResult = await safeUpdateRecords({ token, baseId, tableId, records: itemUpdates, typecast: true });
    const itemRecreateRecords: any[] = [];
    const itemRecreateLocalIds: string[] = [];
    if (itemUpdateResult.errors.length) {
      for (const err of itemUpdateResult.errors) {
        const title = itemUpdates[err.index]?.fields?.Title;
        const id = itemUpdates[err.index]?.id;
        if (isNotFoundError(err.message)) {
          itemRecreateRecords.push({ fields: itemUpdates[err.index]?.fields || {} });
          itemRecreateLocalIds.push(itemUpdateLocalIds[err.index]);
        } else {
          pushErrors.push({ entity: "item", action: "update", id, title, message: err.message });
        }
      }
    }
    const itemRecreateResult = await safeCreateRecords({
      token,
      baseId,
      tableId,
      records: itemRecreateRecords,
      typecast: true,
    });
    if (itemRecreateResult.errors.length) {
      for (const err of itemRecreateResult.errors) {
        const title = itemRecreateRecords[err.index]?.fields?.Title;
        pushErrors.push({ entity: "item", action: "create", title, message: err.message });
      }
    }
    for (let i = 0; i < itemRecreateResult.records.length; i++) {
      const localId = itemRecreateLocalIds[i];
      const rec = itemRecreateResult.records[i];
      if (localId && rec && rec.id) itemIdMap[localId] = rec.id;
    }

    // --- Measurements ---
    const measCreates: any[] = [];
    const measCreateLocalIds: string[] = [];
    const measUpdates: any[] = [];
    const measUpdateLocalIds: string[] = [];
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
      if (remoteId) {
        measUpdates.push({ id: remoteId, fields });
        measUpdateLocalIds.push(localId);
      }
      else {
        measCreates.push({ fields });
        measCreateLocalIds.push(localId);
      }
    }

    const measCreateResult = await safeCreateRecords({ token, baseId, tableId, records: measCreates, typecast: true });
    const measurementIdMap: Record<string, string> = {};
    for (let i = 0; i < measCreateResult.records.length; i++) {
      const localId = measCreateLocalIds[i];
      if (!localId) continue;
      const rec = measCreateResult.records[i];
      if (rec && rec.id) measurementIdMap[localId] = rec.id;
    }
    if (measCreateResult.errors.length) {
      for (const err of measCreateResult.errors) {
        const title = measCreates[err.index]?.fields?.Title;
        pushErrors.push({ entity: "measurement", action: "create", title, message: err.message });
      }
    }
    const measUpdateResult = await safeUpdateRecords({ token, baseId, tableId, records: measUpdates, typecast: true });
    const measRecreateRecords: any[] = [];
    const measRecreateLocalIds: string[] = [];
    if (measUpdateResult.errors.length) {
      for (const err of measUpdateResult.errors) {
        const title = measUpdates[err.index]?.fields?.Title;
        const id = measUpdates[err.index]?.id;
        if (isNotFoundError(err.message)) {
          measRecreateRecords.push({ fields: measUpdates[err.index]?.fields || {} });
          measRecreateLocalIds.push(measUpdateLocalIds[err.index]);
        } else {
          pushErrors.push({ entity: "measurement", action: "update", id, title, message: err.message });
        }
      }
    }
    const measRecreateResult = await safeCreateRecords({
      token,
      baseId,
      tableId,
      records: measRecreateRecords,
      typecast: true,
    });
    if (measRecreateResult.errors.length) {
      for (const err of measRecreateResult.errors) {
        const title = measRecreateRecords[err.index]?.fields?.Title;
        pushErrors.push({ entity: "measurement", action: "create", title, message: err.message });
      }
    }
    for (let i = 0; i < measRecreateResult.records.length; i++) {
      const localId = measRecreateLocalIds[i];
      const rec = measRecreateResult.records[i];
      if (localId && rec && rec.id) measurementIdMap[localId] = rec.id;
    }

    // --- Rooms (stored as Record Type = Note, one per room) ---
    const roomCreates: any[] = [];
    const roomCreateLocalIds: string[] = [];
    const roomUpdates: any[] = [];
    const roomUpdateLocalIds: string[] = [];

    for (const r of rooms) {
      const rid = String(r.id || "").trim();
      if (!rid) continue;
      const syncState = String(r.syncState || "").trim();
      if (syncState === "deleted") continue;
      const remoteId = forceCreate ? null : isRemoteId(r.remoteId) ? r.remoteId : null;
      const meta = {
        sort: typeof r.sort === "number" ? r.sort : null,
        recordType: "Room",
        createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
        updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
      };
      const fields: any = {
        "Record Type": "Room",
        Title: `${rid} room`,
        Room: rid,
        Notes: buildNotes(r.notes || "", meta),
      };
      fields[SYNC_SOURCE_FIELD] = SYNC_SOURCE;
      fields[SYNC_AT_FIELD] = syncAtIso;
      if (remoteId) {
        roomUpdates.push({ id: remoteId, fields });
        roomUpdateLocalIds.push(rid);
      }
      else {
        roomCreates.push({ fields });
        roomCreateLocalIds.push(rid);
      }
    }

    const roomCreateResult = await safeCreateRecords({ token, baseId, tableId, records: roomCreates, typecast: true });
    const roomIdMap: Record<string, string> = {};
    for (let i = 0; i < roomCreateResult.records.length; i++) {
      const localId = roomCreateLocalIds[i];
      if (!localId) continue;
      const rec = roomCreateResult.records[i];
      if (rec && rec.id) roomIdMap[localId] = rec.id;
    }
    if (roomCreateResult.errors.length) {
      for (const err of roomCreateResult.errors) {
        const title = roomCreates[err.index]?.fields?.Room || roomCreates[err.index]?.fields?.Title;
        pushErrors.push({ entity: "room", action: "create", title, message: err.message });
      }
    }
    const roomUpdateResult = await safeUpdateRecords({ token, baseId, tableId, records: roomUpdates, typecast: true });
    const roomRecreateRecords: any[] = [];
    const roomRecreateLocalIds: string[] = [];
    if (roomUpdateResult.errors.length) {
      for (const err of roomUpdateResult.errors) {
        const title = roomUpdates[err.index]?.fields?.Room || roomUpdates[err.index]?.fields?.Title;
        const id = roomUpdates[err.index]?.id;
        if (isNotFoundError(err.message)) {
          roomRecreateRecords.push({ fields: roomUpdates[err.index]?.fields || {} });
          roomRecreateLocalIds.push(roomUpdateLocalIds[err.index]);
        } else {
          pushErrors.push({ entity: "room", action: "update", id, title, message: err.message });
        }
      }
    }
    const roomRecreateResult = await safeCreateRecords({
      token,
      baseId,
      tableId,
      records: roomRecreateRecords,
      typecast: true,
    });
    if (roomRecreateResult.errors.length) {
      for (const err of roomRecreateResult.errors) {
        const title = roomRecreateRecords[err.index]?.fields?.Room || roomRecreateRecords[err.index]?.fields?.Title;
        pushErrors.push({ entity: "room", action: "create", title, message: err.message });
      }
    }
    for (let i = 0; i < roomRecreateResult.records.length; i++) {
      const localId = roomRecreateLocalIds[i];
      const rec = roomRecreateResult.records[i];
      if (localId && rec && rec.id) roomIdMap[localId] = rec.id;
    }

    // --- Stores ---
    const storeCreates: any[] = [];
    const storeCreateLocalIds: string[] = [];
    const storeUpdates: any[] = [];
    const storeUpdateLocalIds: string[] = [];
    const storeDeletes: string[] = [];

    for (const s of stores) {
      const localId = String(s.id || "").trim();
      if (!localId) continue;
      const syncState = String(s.syncState || "").trim();
      const remoteId = forceCreate ? null : isRemoteId(s.remoteId) ? s.remoteId : isRemoteId(s.id) ? s.id : null;

      if (syncState === "deleted") {
        if (remoteId) storeDeletes.push(remoteId);
        continue;
      }

      const meta = {
        sort: typeof s.sort === "number" ? s.sort : null,
        discountType: s.discountType || null,
        discountValue: typeof s.discountValue === "number" ? s.discountValue : null,
        shippingCost: typeof s.shippingCost === "number" ? s.shippingCost : null,
        deliveryInfo: typeof s.deliveryInfo === "string" ? s.deliveryInfo : null,
        extraWarranty: typeof s.extraWarranty === "string" ? s.extraWarranty : null,
        trial: typeof s.trial === "string" ? s.trial : null,
        apr: typeof s.apr === "string" ? s.apr : null,
        recordType: "Store",
        createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
        updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
      };

      const name = normalizeStoreValue(s.name) || "Store";
      const fields: any = {
        "Record Type": "Store",
        Title: name,
        Store: name,
        Notes: buildNotes(s.notes, meta),
      };
      fields[SYNC_SOURCE_FIELD] = SYNC_SOURCE;
      fields[SYNC_AT_FIELD] = syncAtIso;

      if (remoteId) {
        storeUpdates.push({ id: remoteId, fields });
        storeUpdateLocalIds.push(localId);
      }
      else {
        storeCreates.push({ fields });
        storeCreateLocalIds.push(localId);
      }
    }

    const storeCreateResult = await safeCreateRecords({ token, baseId, tableId, records: storeCreates, typecast: true });
    const storeIdMap: Record<string, string> = {};
    for (let i = 0; i < storeCreateResult.records.length; i++) {
      const localId = storeCreateLocalIds[i];
      if (!localId) continue;
      const rec = storeCreateResult.records[i];
      if (rec && rec.id) storeIdMap[localId] = rec.id;
    }
    if (storeCreateResult.errors.length) {
      for (const err of storeCreateResult.errors) {
        const title = storeCreates[err.index]?.fields?.Title;
        pushErrors.push({ entity: "store", action: "create", title, message: err.message });
      }
    }
    const storeUpdateResult = await safeUpdateRecords({ token, baseId, tableId, records: storeUpdates, typecast: true });
    const storeRecreateRecords: any[] = [];
    const storeRecreateLocalIds: string[] = [];
    if (storeUpdateResult.errors.length) {
      for (const err of storeUpdateResult.errors) {
        const title = storeUpdates[err.index]?.fields?.Title;
        const id = storeUpdates[err.index]?.id;
        if (isNotFoundError(err.message)) {
          storeRecreateRecords.push({ fields: storeUpdates[err.index]?.fields || {} });
          storeRecreateLocalIds.push(storeUpdateLocalIds[err.index]);
        } else {
          pushErrors.push({ entity: "store", action: "update", id, title, message: err.message });
        }
      }
    }
    const storeRecreateResult = await safeCreateRecords({
      token,
      baseId,
      tableId,
      records: storeRecreateRecords,
      typecast: true,
    });
    if (storeRecreateResult.errors.length) {
      for (const err of storeRecreateResult.errors) {
        const title = storeRecreateRecords[err.index]?.fields?.Title;
        pushErrors.push({ entity: "store", action: "create", title, message: err.message });
      }
    }
    for (let i = 0; i < storeRecreateResult.records.length; i++) {
      const localId = storeRecreateLocalIds[i];
      const rec = storeRecreateResult.records[i];
      if (localId && rec && rec.id) storeIdMap[localId] = rec.id;
    }

    // --- Options ---
    const optCreates: any[] = [];
    const optCreateLocalIds: string[] = [];
    const optUpdates: any[] = [];
    const optUpdateLocalIds: string[] = [];
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
      const mappedParentRemote = itemIdMap[parentLocal] || null;
      const parentRemote =
        mappedParentRemote ||
        (typeof o.parentRemoteId === "string" && isRemoteId(o.parentRemoteId) ? o.parentRemoteId : null) ||
        (isRemoteId(parentLocal) ? parentLocal : null);
      if (!parentRemote) continue; // parent not known yet

      const finalTotal = optionBaseTotal(o) - optionDiscountAmount(o);

      const meta = {
        selected: Boolean(o.selected),
        sort: typeof o.sort === "number" ? o.sort : null,
        discountType: o.discountType || null,
        discountValue: typeof o.discountValue === "number" ? o.discountValue : null,
        parentLocalId: parentLocal || null,
        parentRemoteId: parentRemote || null,
        localId,
        attachments: sanitizeAttachments(o.attachments),
        createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
        updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
      };

      const fields: any = {
        "Record Type": "Option",
        Title: String(o.title || "Option"),
        "Parent Item Record Id": parentRemote,
        "Parent Item Key": parentRemote || parentLocal || null,
        Store: normalizeStoreValue(o.store),
        Link: typeof o.link === "string" ? o.link : null,
        "Promo Code": typeof o.promoCode === "string" ? o.promoCode : null,
        Discount: optionDiscountAmount(o) || null,
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
        optUpdateLocalIds.push(localId);
        if (meta.selected) selectedOptionByItem[parentRemote] = remoteId;
      } else {
        optCreates.push({ fields });
        optCreateLocalIds.push(localId);
        // selected mapping handled after create
      }
    }

    const optCreateResult = await safeCreateRecords({ token, baseId, tableId, records: optCreates, typecast: true });
    const optionIdMap: Record<string, string> = {};
    for (let i = 0; i < optCreateResult.records.length; i++) {
      const localId = optCreateLocalIds[i];
      if (!localId) continue;
      const rec = optCreateResult.records[i];
      if (rec && rec.id) optionIdMap[localId] = rec.id;
    }

    if (optCreateResult.errors.length) {
      for (const err of optCreateResult.errors) {
        const title = optCreates[err.index]?.fields?.Title;
        pushErrors.push({ entity: "option", action: "create", title, message: err.message });
      }
    }
    const optUpdateResult = await safeUpdateRecords({ token, baseId, tableId, records: optUpdates, typecast: true });
    const optRecreateRecords: any[] = [];
    const optRecreateLocalIds: string[] = [];
    if (optUpdateResult.errors.length) {
      for (const err of optUpdateResult.errors) {
        const title = optUpdates[err.index]?.fields?.Title;
        const id = optUpdates[err.index]?.id;
        if (isNotFoundError(err.message)) {
          optRecreateRecords.push({ fields: optUpdates[err.index]?.fields || {} });
          optRecreateLocalIds.push(optUpdateLocalIds[err.index]);
        } else {
          pushErrors.push({ entity: "option", action: "update", id, title, message: err.message });
        }
      }
    }
    const optRecreateResult = await safeCreateRecords({
      token,
      baseId,
      tableId,
      records: optRecreateRecords,
      typecast: true,
    });
    if (optRecreateResult.errors.length) {
      for (const err of optRecreateResult.errors) {
        const title = optRecreateRecords[err.index]?.fields?.Title;
        pushErrors.push({ entity: "option", action: "create", title, message: err.message });
      }
    }
    for (let i = 0; i < optRecreateResult.records.length; i++) {
      const localId = optRecreateLocalIds[i];
      const rec = optRecreateResult.records[i];
      if (localId && rec && rec.id) optionIdMap[localId] = rec.id;
    }

    // After creates, we can't reliably know which created option was selected without an id field.
    // We keep selection server-side via meta, but item.Selected Option Id is best-effort only.

    // Apply deletes last
    const deleted = {
      items: itemDeletes.length ? await deleteRecords({ token, baseId, tableId, ids: itemDeletes }) : [],
      options: optDeletes.length ? await deleteRecords({ token, baseId, tableId, ids: optDeletes }) : [],
      measurements: measDeletes.length ? await deleteRecords({ token, baseId, tableId, ids: measDeletes }) : [],
      stores: storeDeletes.length ? await deleteRecords({ token, baseId, tableId, ids: storeDeletes }) : [],
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
          stores: storeIdMap,
        },
        counts: {
          createdItems: itemCreateResult.records.filter(Boolean).length + itemRecreateResult.records.filter(Boolean).length,
          updatedItems: itemUpdateResult.records.filter(Boolean).length,
          createdOptions: optCreateResult.records.filter(Boolean).length + optRecreateResult.records.filter(Boolean).length,
          updatedOptions: optUpdateResult.records.filter(Boolean).length,
          createdMeasurements: measCreateResult.records.filter(Boolean).length + measRecreateResult.records.filter(Boolean).length,
          updatedMeasurements: measUpdateResult.records.filter(Boolean).length,
          createdRooms: roomCreateResult.records.filter(Boolean).length + roomRecreateResult.records.filter(Boolean).length,
          updatedRooms: roomUpdateResult.records.filter(Boolean).length,
          createdStores: storeCreateResult.records.filter(Boolean).length + storeRecreateResult.records.filter(Boolean).length,
          updatedStores: storeUpdateResult.records.filter(Boolean).length,
          deletedItems: deleted.items.length,
          deletedOptions: deleted.options.length,
          deletedMeasurements: deleted.measurements.length,
          deletedStores: deleted.stores.length,
        },
        errors: pushErrors.length ? pushErrors : undefined,
        message: pushErrors.length ? `Sync push complete with ${pushErrors.length} error(s)` : "Sync push complete",
      }),
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: err?.message || "Sync push failed" }));
  }
}
