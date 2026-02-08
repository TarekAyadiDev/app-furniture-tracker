import { getAirtableConfig, listAllRecords } from "../_lib/airtable.js";

function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function splitNotes(notesRaw: any) {
  const notes = typeof notesRaw === "string" ? notesRaw : "";
  const start = notes.lastIndexOf("--- app_meta ---");
  const end = notes.lastIndexOf("--- /app_meta ---");
  if (start === -1 || end === -1 || end < start) return { userNotes: notes, meta: null as any };
  const jsonText = notes
    .slice(start + "--- app_meta ---".length, end)
    .trim()
    .replace(/^\n+/, "")
    .trim();
  let meta: any = null;
  try {
    meta = jsonText ? JSON.parse(jsonText) : null;
  } catch {
    meta = null;
  }
  const userNotes = notes.slice(0, start).trimEnd();
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
    const roomsMap = new Map<string, any>();

    for (const rec of records) {
      const f = rec.fields || {};
      const rt = String(f["Record Type"] || "").trim();
      const { userNotes, meta } = splitNotes(f["Notes"]);

      if (rt === "Item") {
        const dims = meta?.dimensions || parseDims(f["Dimensions"]) || null;
        items.push({
          id: rec.id,
          remoteId: rec.id,
          syncState: "clean",
          name: String(f["Title"] || "").trim() || "Item",
          room: normalizeRoom(f["Room"]),
          category: String(meta?.category || f["Category"] || "Other").trim() || "Other",
          status: normalizeStatus(f["Status"]),
          sort: toNumber(meta?.sort),
          price: toNumber(f["Price"]),
          selectedOptionId: typeof f["Selected Option Id"] === "string" ? f["Selected Option Id"] : null,
          discountType: typeof meta?.discountType === "string" ? meta.discountType : null,
          discountValue: toNumber(meta?.discountValue),
          qty: toNumber(f["Quantity"]) ? Math.round(toNumber(f["Quantity"]) as number) : 1,
          store: typeof f["Store"] === "string" ? f["Store"] : null,
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
        const parentId = String(f["Parent Item Record Id"] || f["Parent Item Key"] || "").trim();
        options.push({
          id: rec.id,
          remoteId: rec.id,
          syncState: "clean",
          itemId: parentId,
          title: String(f["Title"] || "").trim() || "Option",
          sort: toNumber(meta?.sort),
          store: typeof f["Store"] === "string" ? f["Store"] : null,
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
          room: normalizeRoom(f["Room"]),
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

      if (rt === "Note") {
        const room = normalizeRoom(f["Room"]);
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
        },
      }),
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: err?.message || "Sync pull failed" }));
  }
}
