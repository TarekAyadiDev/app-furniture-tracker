import { getAirtableConfig, listAllRecords } from "../_lib/airtable.js";

function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function splitNotes(notesRaw: any) {
  const notes = typeof notesRaw === "string" ? notesRaw : "";
  const openTag = "--- app_meta ---";
  const closeTag = "--- /app_meta ---";
  const start = notes.lastIndexOf(openTag);
  const end = notes.lastIndexOf(closeTag);
  if (start === -1 || end === -1 || end < start) return { userNotes: notes, meta: null as any };
  const jsonText = notes
    .slice(start + openTag.length, end)
    .trim()
    .replace(/^\n+/, "")
    .trim();
  let meta: any = null;
  try {
    meta = jsonText ? JSON.parse(jsonText) : null;
  } catch {
    meta = null;
  }
  const before = notes.slice(0, start).trimEnd();
  const after = notes.slice(end + closeTag.length).trimStart();
  const userNotes = [before, after].filter(Boolean).join("\n\n").trimEnd();
  return { userNotes, meta };
}

function parseDims(text: any) {
  const s = typeof text === "string" ? text : "";
  const m = s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  return { wIn: Number(m[1]), dIn: Number(m[2]), hIn: Number(m[3]) };
}

function normalizeRoom(room: any) {
  const r = String(room || "").trim();
  return r || "Living";
}

function firstString(value: any): string | null {
  if (typeof value === "string") {
    const s = value.trim();
    return s ? s : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        const s = entry.trim();
        if (s) return s;
      }
    }
  }
  return null;
}

function firstRecordId(value: any): string | null {
  const v = firstString(value);
  return v && v.startsWith("rec") ? v : null;
}

function normalizeStatus(status: any) {
  const s = String(status || "").trim();
  const allowed = ["Idea", "Shortlist", "Selected", "Ordered", "Delivered", "Installed"];
  return allowed.includes(s) ? s : "Idea";
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
    return;
  }

  try {
    const { token, baseId, tableId, view } = getAirtableConfig();
    let records = await listAllRecords({ token, baseId, tableId, view });
    if (view) {
      const types = new Set(records.map((r) => String(r?.fields?.["Record Type"] || "").trim()));
      const hasItem = types.has("Item");
      const hasOption = types.has("Option");
      const hasNote = types.has("Note");
      const hasMeasurement = types.has("Measurement");
      if (hasItem && (!hasOption || !hasNote || !hasMeasurement)) {
        // Fallback: view may be filtering out Options/Notes/Measurements.
        records = await listAllRecords({ token, baseId, tableId });
      }
    }

    const items: any[] = [];
    const options: any[] = [];
    const measurements: any[] = [];
    const stores: any[] = [];
    const roomsMap = new Map<string, any>();
    const itemLocalToRemote = new Map<string, string>();
    const itemRemoteToLocal = new Map<string, string>();
    const optionLocalToRemote = new Map<string, string>();
    const optionRemoteToLocal = new Map<string, string>();

    for (const rec of records) {
      const f = rec.fields || {};
      const rt = String(f["Record Type"] || "").trim();
      const { userNotes, meta } = splitNotes(f["Notes"]);

      if (rt === "Item") {
        const dims = meta?.dimensions || parseDims(f["Dimensions"]) || null;
        const localIdRaw = typeof meta?.localId === "string" ? meta.localId.trim() : "";
        const localId = localIdRaw && !localIdRaw.startsWith("rec") ? localIdRaw : "";
        if (localId) {
          itemLocalToRemote.set(localId, rec.id);
          itemRemoteToLocal.set(rec.id, localId);
        }
        const itemId = localId || rec.id;
        items.push({
          id: itemId,
          remoteId: rec.id,
          syncState: "clean",
          name: String(f["Title"] || "").trim() || "Item",
          room: normalizeRoom(firstString(f["Room"]) || f["Room"]),
          category: String(meta?.category || f["Category"] || "Other").trim() || "Other",
          status: normalizeStatus(f["Status"]),
          sort: toNumber(meta?.sort),
          price: toNumber(f["Price"]),
          selectedOptionId: firstRecordId(f["Selected Option Id"]),
          discountType:
            typeof meta?.discountType === "string"
              ? meta.discountType
              : typeof f["Discount Type"] === "string"
                ? f["Discount Type"]
                : null,
          discountValue: toNumber(meta?.discountValue),
          qty: toNumber(f["Quantity"]) ? Math.round(toNumber(f["Quantity"]) as number) : 1,
          store: firstString(f["Store"]),
          link: typeof f["Link"] === "string" ? f["Link"] : null,
          notes: userNotes || null,
          priority: toNumber(f["Priority"] ?? f["Prioirity"]),
          dimensions: dims || undefined,
          specs: meta?.specs && typeof meta.specs === "object" ? meta.specs : null,
          attachments: Array.isArray(meta?.attachments) ? meta.attachments : [],
          createdAt: toNumber(meta?.createdAt) || Date.now(),
          updatedAt: toNumber(meta?.updatedAt) || Date.now(),
        });
        continue;
      }

      if (rt === "Option") {
        const parentRecordId = firstRecordId(f["Parent Item Record Id"]);
        const parentKey = firstString(f["Parent Item Key"]);
        const parentRemoteId = firstRecordId(meta?.parentRemoteId);
        const parentLocalIdRaw = typeof meta?.parentLocalId === "string" ? meta.parentLocalId.trim() : parentKey || "";
        const parentLocalId = parentLocalIdRaw && !parentLocalIdRaw.startsWith("rec") ? parentLocalIdRaw : "";
        const localIdRaw = typeof meta?.localId === "string" ? meta.localId.trim() : "";
        const localId = localIdRaw && !localIdRaw.startsWith("rec") ? localIdRaw : "";
        if (localId) {
          optionLocalToRemote.set(localId, rec.id);
          optionRemoteToLocal.set(rec.id, localId);
        }
        const mappedParent = parentRecordId ? itemRemoteToLocal.get(parentRecordId) || parentRecordId : null;
        const parentId = mappedParent || parentRemoteId || parentLocalId || "";
        const optionId = localId || rec.id;
        options.push({
          id: optionId,
          remoteId: rec.id,
          syncState: "clean",
          itemId: parentId,
          title: String(f["Title"] || "").trim() || "Option",
          sort: toNumber(meta?.sort),
          store: firstString(f["Store"]),
          link: typeof f["Link"] === "string" ? f["Link"] : null,
          promoCode: typeof f["Promo Code"] === "string" ? f["Promo Code"] : null,
          price: toNumber(f["Price"]),
          shipping: toNumber(f["Shipping"]),
          taxEstimate: toNumber(f["Tax Estimate"]),
          discount: toNumber(f["Discount"]),
          discountType: typeof meta?.discountType === "string" ? meta.discountType : toNumber(f["Discount"]) !== null ? "amount" : null,
          discountValue: toNumber(meta?.discountValue) ?? toNumber(f["Discount"]),
          dimensionsText: typeof f["Dimensions"] === "string" ? f["Dimensions"] : null,
          notes: userNotes || null,
          selected: Boolean(meta?.selected),
          attachments: Array.isArray(meta?.attachments) ? meta.attachments : [],
          createdAt: toNumber(meta?.createdAt) || Date.now(),
          updatedAt: toNumber(meta?.updatedAt) || Date.now(),
        });
        continue;
      }

      if (rt === "Measurement") {
        const label = String(f["Measure Label"] || f["Title"] || "").trim() || "Measurement";
        let valueIn = toNumber(f["Value (in)"]);
        if (valueIn === null) {
          const raw = toNumber(f["Value"]);
          const unit = String(f["Unit Entered"] || "in").trim().toLowerCase();
          if (raw !== null) valueIn = unit === "cm" ? raw / 2.54 : raw;
        }
        measurements.push({
          id: rec.id,
          remoteId: rec.id,
          syncState: "clean",
          room: normalizeRoom(firstString(f["Room"]) || f["Room"]),
          label,
          valueIn: valueIn ?? 0,
          sort: toNumber(meta?.sort),
          confidence: f["Confidence"] || null,
          forCategory: typeof meta?.forCategory === "string" ? meta.forCategory : null,
          forItemId: typeof meta?.forItemId === "string" ? meta.forItemId : null,
          notes: userNotes || null,
          createdAt: toNumber(meta?.createdAt) || Date.now(),
          updatedAt: toNumber(meta?.updatedAt) || Date.now(),
        });
        continue;
      }

      if (rt === "Store" || meta?.recordType === "Store") {
        const name = String(f["Title"] || f["Store"] || "").trim() || "Store";
        stores.push({
          id: rec.id,
          remoteId: rec.id,
          syncState: "clean",
          name,
          sort: toNumber(meta?.sort),
          discountType: typeof meta?.discountType === "string" ? meta.discountType : null,
          discountValue: toNumber(meta?.discountValue) ?? toNumber(f["Discount Value"] ?? f["Discount"]),
          shippingCost: toNumber(meta?.shippingCost) ?? toNumber(f["Shipping Cost"] ?? f["Delivery Cost"] ?? f["Shipping"]),
          deliveryInfo:
            typeof meta?.deliveryInfo === "string"
              ? meta.deliveryInfo
              : typeof f["Delivery Info"] === "string"
                ? f["Delivery Info"]
                : null,
          extraWarranty:
            typeof meta?.extraWarranty === "string"
              ? meta.extraWarranty
              : typeof f["Extra Warranty"] === "string"
                ? f["Extra Warranty"]
                : null,
          trial:
            typeof meta?.trial === "string"
              ? meta.trial
              : typeof f["Trial"] === "string"
                ? f["Trial"]
                : null,
          apr:
            typeof meta?.apr === "string"
              ? meta.apr
              : typeof f["APR"] === "string"
                ? f["APR"]
                : null,
          notes: userNotes || null,
          createdAt: toNumber(meta?.createdAt) || Date.now(),
          updatedAt: toNumber(meta?.updatedAt) || Date.now(),
        });
        continue;
      }

      if (rt === "Note" || rt === "Room") {
        if (meta?.recordType === "Store") {
          const name = String(f["Title"] || f["Store"] || "").trim() || "Store";
          stores.push({
            id: rec.id,
            remoteId: rec.id,
            syncState: "clean",
            name,
            sort: toNumber(meta?.sort),
            discountType: typeof meta?.discountType === "string" ? meta.discountType : null,
            discountValue: toNumber(meta?.discountValue) ?? toNumber(f["Discount Value"] ?? f["Discount"]),
            shippingCost: toNumber(meta?.shippingCost) ?? toNumber(f["Shipping Cost"] ?? f["Delivery Cost"] ?? f["Shipping"]),
            deliveryInfo:
              typeof meta?.deliveryInfo === "string"
                ? meta.deliveryInfo
                : typeof f["Delivery Info"] === "string"
                  ? f["Delivery Info"]
                  : null,
            extraWarranty:
              typeof meta?.extraWarranty === "string"
                ? meta.extraWarranty
                : typeof f["Extra Warranty"] === "string"
                  ? f["Extra Warranty"]
                  : null,
            trial:
              typeof meta?.trial === "string"
                ? meta.trial
                : typeof f["Trial"] === "string"
                  ? f["Trial"]
                  : null,
            apr:
              typeof meta?.apr === "string"
                ? meta.apr
                : typeof f["APR"] === "string"
                  ? f["APR"]
                  : null,
            notes: userNotes || null,
            createdAt: toNumber(meta?.createdAt) || Date.now(),
            updatedAt: toNumber(meta?.updatedAt) || Date.now(),
          });
        } else {
          const room = normalizeRoom(firstString(f["Room"]) || f["Room"]);
          roomsMap.set(room, {
            id: room,
            name: room,
            remoteId: rec.id,
            syncState: "clean",
            notes: userNotes || "",
            sort: toNumber(meta?.sort),
            createdAt: toNumber(meta?.createdAt) || Date.now(),
            updatedAt: toNumber(meta?.updatedAt) || Date.now(),
          });
        }
      }
    }

    const roomIds = new Set<string>();
    for (const it of items) roomIds.add(it.room);
    for (const m of measurements) roomIds.add(m.room);
    for (const rid of roomsMap.keys()) roomIds.add(rid);

    const rooms = [...roomIds].map(
      (rid) =>
        roomsMap.get(rid) || {
          id: rid,
          name: rid,
          remoteId: null,
          syncState: "clean",
          notes: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
    );

    for (const opt of options) {
      if (typeof opt.itemId !== "string" || !opt.itemId) continue;
      if (opt.itemId.startsWith("rec")) {
        const mapped = itemRemoteToLocal.get(opt.itemId);
        if (mapped) opt.itemId = mapped;
      }
    }
    for (const it of items) {
      if (typeof it.selectedOptionId !== "string" || !it.selectedOptionId) continue;
      if (it.selectedOptionId.startsWith("rec")) {
        const mapped = optionRemoteToLocal.get(it.selectedOptionId);
        if (mapped) it.selectedOptionId = mapped;
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        bundle: {
          version: 1,
          exportedAt: new Date().toISOString(),
          rooms,
          measurements,
          items,
          options,
          stores,
        },
      }),
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: err?.message || "Sync pull failed" }));
  }
}
