import { createRecords, getAirtableConfig } from "./_lib/airtable.js";
import fs from "node:fs";
import path from "node:path";

const ALLOWED_STATUSES = new Set(["Idea", "Shortlist", "Selected", "Ordered", "Delivered", "Installed"]);
const ENV_FILES = [".env.local", ".env.development.local", ".env.development", ".env"];

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Clipper-Token");
}

function parseBody(req: any): Promise<any> {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: any) => (data += String(chunk)));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function cleanEnvValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

function readEnvValueFromFiles(key: string): string {
  for (const fileName of ENV_FILES) {
    const absPath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(absPath)) continue;
    try {
      const content = fs.readFileSync(absPath, "utf8");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        if (match[1] !== key) continue;
        const value = cleanEnvValue(match[2] || "");
        if (value) return value;
      }
    } catch {
      continue;
    }
  }
  return "";
}

function resolveExpectedClipperToken(): string {
  const fromEnv = String(process.env.CLIPPER_TOKEN || "").trim();
  if (fromEnv && fromEnv !== "YOUR_CLIPPER_TOKEN") return fromEnv;

  // Local dev fallback: read directly from .env* so token changes work without restart.
  if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") return "";
  const fromFiles = readEnvValueFromFiles("CLIPPER_TOKEN").trim();
  if (fromFiles && fromFiles !== "YOUR_CLIPPER_TOKEN") return fromFiles;
  return "";
}

function readClipperToken(req: any, body: any): string {
  const incomingHeaderRaw = req.headers?.["x-clipper-token"];
  const incomingHeader = Array.isArray(incomingHeaderRaw)
    ? String(incomingHeaderRaw[0] || "").trim()
    : String(incomingHeaderRaw || "").trim();
  if (incomingHeader) return incomingHeader;
  const incomingBody = String(body?.clipperToken || "").trim();
  return incomingBody;
}

function isLocalHostRequest(req: any): boolean {
  const host = String(req?.headers?.host || "").toLowerCase();
  return host.includes("127.0.0.1") || host.includes("localhost");
}

function buildNotes(userNotesRaw: any, meta: any) {
  const userNotes = typeof userNotesRaw === "string" ? userNotesRaw.trimEnd() : "";
  const metaObj = meta && typeof meta === "object" ? meta : null;
  if (!metaObj || Object.keys(metaObj).length === 0) return userNotes;
  const json = JSON.stringify(metaObj);
  return `--- app_meta ---\n${json}\n--- /app_meta ---${userNotes ? `\n\n${userNotes}` : ""}`;
}

function normalizeText(input: unknown): string {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionalString(input: unknown): string | null {
  const value = normalizeText(input);
  return value || null;
}

function normalizeUrl(input: unknown): string | null {
  const raw = normalizeText(input);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const raw = normalizeText(input);
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") && cleaned.includes(".")
    ? cleaned.replace(/,/g, "")
    : cleaned.includes(",")
      ? /,\d{1,2}$/.test(cleaned)
        ? cleaned.replace(",", ".")
        : cleaned.replace(/,/g, "")
      : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function normalizeQty(input: unknown): number {
  const value = normalizeNumber(input);
  if (value === null || value <= 0) return 1;
  return Math.max(1, Math.round(value));
}

function normalizeDomain(input: unknown, sourceUrl: string): string {
  const raw = normalizeText(input).replace(/^www\./i, "");
  if (raw) return raw;
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function normalizeCaptureMethod(input: unknown): "browser" | "fallback_scraper" {
  return String(input || "").trim().toLowerCase() === "fallback_scraper" ? "fallback_scraper" : "browser";
}

function toSpecsMap(raw: unknown): Record<string, string | number | boolean | null> {
  const map: Record<string, string | number | boolean | null> = {};
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const key = normalizeText((entry as any).key).slice(0, 80);
    if (!key) continue;
    const valueRaw = (entry as any).value;
    if (valueRaw === null || typeof valueRaw === "undefined") {
      map[key] = null;
      continue;
    }
    if (typeof valueRaw === "boolean" || typeof valueRaw === "number") {
      map[key] = valueRaw;
      continue;
    }
    map[key] = normalizeText(valueRaw).slice(0, 500) || null;
  }
  return map;
}

function truncateJson(value: unknown, maxChars = 20000): string | null {
  if (typeof value === "undefined") return null;
  let json = "";
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (!json) return null;
  if (json.length <= maxChars) return json;
  return `${json.slice(0, maxChars)}...<truncated>`;
}

export default async function handler(req: any, res: any) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
    return;
  }

  try {
    const body = await parseBody(req);
    const incomingToken = readClipperToken(req, body);

    let expectedToken = resolveExpectedClipperToken();

    // Local dev convenience: if server env token is missing, trust extension token.
    // Never do this on Vercel/production.
    const canUseLocalBypass =
      !expectedToken &&
      process.env.VERCEL !== "1" &&
      process.env.NODE_ENV !== "production" &&
      isLocalHostRequest(req) &&
      Boolean(incomingToken);
    if (canUseLocalBypass) {
      expectedToken = incomingToken;
    }

    if (!expectedToken) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          message: "Missing CLIPPER_TOKEN in environment variables.",
          hint: "Set CLIPPER_TOKEN in .env.local (local) or Vercel env vars (production).",
        }),
      );
      return;
    }

    if (!incomingToken || incomingToken !== expectedToken) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: "Unauthorized clipper request." }));
      return;
    }

    const sourceUrl = normalizeUrl(body?.sourceUrl || body?.url);
    const name = normalizeText(body?.name);
    if (!sourceUrl || !name) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: "Missing required fields: sourceUrl and name." }));
      return;
    }

    const sourceDomain = normalizeDomain(body?.sourceDomain, sourceUrl);
    const captureMethod = normalizeCaptureMethod(body?.captureMethod);
    const room = normalizeText(body?.room || "Living") || "Living";
    const status = ALLOWED_STATUSES.has(String(body?.status || "").trim()) ? String(body.status).trim() : "Shortlist";
    const qty = normalizeQty(body?.qty);
    const price = normalizeNumber(body?.price);
    const originalPrice = normalizeNumber(body?.originalPrice);
    const discountPercent = normalizeNumber(body?.discountPercent);
    const currency = normalizeOptionalString(body?.currency);
    const imageUrl = normalizeUrl(body?.imageUrl);
    const brand = normalizeOptionalString(body?.brand);
    const description = normalizeOptionalString(body?.description);
    const dimensionsText = normalizeOptionalString(body?.dimensionsText);
    const variantText = normalizeOptionalString(body?.variantText);
    const store = normalizeOptionalString(body?.store);

    const specs = toSpecsMap(body?.specs);
    if (brand) specs.brand = brand;
    if (imageUrl) specs.imageUrl = imageUrl;
    if (currency) specs.currency = currency;
    if (originalPrice !== null) specs.originalPrice = originalPrice;
    if (discountPercent !== null) specs.discountPercent = discountPercent;
    if (dimensionsText) specs.dimensionsText = dimensionsText;
    if (variantText) specs.variantText = variantText;
    if (sourceDomain) specs.sourceDomain = sourceDomain;
    specs.captureMethod = captureMethod;
    specs.captureSource = "extension";

    const clipRawJson = truncateJson(body?.raw, 20000);
    const meta = {
      category: "Other",
      kind: "standalone",
      dimensions: null,
      sort: null,
      specs: Object.keys(specs).length ? specs : null,
      discountType: null,
      discountValue: null,
      clipper: {
        captureMethod,
        sourceUrl,
        sourceDomain,
        clippedAt: Date.now(),
        rawJson: clipRawJson,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const { token, baseId, tableId } = getAirtableConfig();
    const SYNC_SOURCE = process.env.AIRTABLE_SYNC_SOURCE || "app-clipper";
    const SYNC_SOURCE_FIELD = process.env.AIRTABLE_SYNC_SOURCE_FIELD || "Last Sync Source";
    const SYNC_AT_FIELD = process.env.AIRTABLE_SYNC_AT_FIELD || "Last Sync At";
    const syncAtIso = new Date().toISOString();

    const fields: Record<string, unknown> = {
      "Record Type": "Item",
      Title: name,
      Room: room,
      Status: status,
      Price: price,
      Quantity: qty,
      Store: store,
      Link: sourceUrl,
      Notes: buildNotes(description, meta),
      Dimensions: dimensionsText,
      [SYNC_SOURCE_FIELD]: SYNC_SOURCE,
      [SYNC_AT_FIELD]: syncAtIso,
    };

    const created = await createRecords({
      token,
      baseId,
      tableId,
      typecast: true,
      records: [{ fields }],
    });

    const itemId = created?.[0]?.id;
    if (!itemId) {
      throw new Error("Clip created without an Airtable record id.");
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        itemId,
        captureMethod,
        sourceUrl,
      }),
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: err?.message || "Failed to create clipped item." }));
  }
}
