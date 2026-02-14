type ParsedProduct = {
  name: string;
  price: number | null;
  description: string | null;
  imageUrl: string | null;
  brand: string | null;
  sourceUrl: string;
};

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

function normalizeWhitespace(input: unknown): string {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}

function stripTags(input: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(input)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const raw of values) {
    const value = normalizeWhitespace(raw);
    if (value) return value;
  }
  return null;
}

function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = normalizeWhitespace(raw);
  if (!value) return null;
  if (value.startsWith("//")) return `https:${value}`;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const text = normalizeWhitespace(value);
  if (!text) return null;
  const sanitized = text.replace(/[^0-9.,-]/g, "");
  let normalized = sanitized;
  if (sanitized.includes(",") && sanitized.includes(".")) {
    normalized = sanitized.replace(/,/g, "");
  } else if (sanitized.includes(",")) {
    normalized = /,\d{1,2}$/.test(sanitized) ? sanitized.replace(",", ".") : sanitized.replace(/,/g, "");
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const fallback = text.match(/-?\d+(?:\.\d+)?/);
  if (!fallback) return null;
  const parsed = Number(fallback[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  return stripTags(match[1]);
}

function extractFirstH1(html: string): string | null {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match?.[1]) return null;
  return stripTags(match[1]);
}

function readMetaTags(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const tagRegex = /<meta\b[^>]*>/gi;
  let tagMatch: RegExpExecArray | null = null;
  while ((tagMatch = tagRegex.exec(html))) {
    const tag = tagMatch[0];
    const attrRegex = /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let attrMatch: RegExpExecArray | null = null;
    let key = "";
    let content = "";
    while ((attrMatch = attrRegex.exec(tag))) {
      const attrName = String(attrMatch[1] || "").toLowerCase();
      const attrValue = decodeHtmlEntities(String(attrMatch[2] || attrMatch[3] || attrMatch[4] || "")).trim();
      if (!attrValue) continue;
      if (attrName === "name" || attrName === "property" || attrName === "itemprop") key = attrValue.toLowerCase();
      if (attrName === "content") content = attrValue;
    }
    if (key && content && !map.has(key)) map.set(key, normalizeWhitespace(content));
  }
  return map;
}

function getMeta(map: Map<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = map.get(key.toLowerCase());
    if (value) return value;
  }
  return null;
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isProductType(typeValue: unknown): boolean {
  if (typeof typeValue === "string") return typeValue.toLowerCase().includes("product");
  if (Array.isArray(typeValue)) return typeValue.some((entry) => typeof entry === "string" && entry.toLowerCase().includes("product"));
  return false;
}

function collectProductsFromNode(node: unknown, out: Record<string, any>[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const entry of node) collectProductsFromNode(entry, out);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (isProductType(obj["@type"])) out.push(obj as Record<string, any>);
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") collectProductsFromNode(value, out);
  }
}

function extractProductsFromLdJson(html: string): Record<string, any>[] {
  const products: Record<string, any>[] = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = scriptRegex.exec(html))) {
    const raw = String(match[1] || "")
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .trim();
    if (!raw) continue;
    const parsed = parseJson(raw);
    if (!parsed) continue;
    collectProductsFromNode(parsed, products);
  }
  return products;
}

function extractBrand(value: unknown): string | null {
  if (typeof value === "string") return normalizeWhitespace(value) || null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const next = extractBrand(entry);
      if (next) return next;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return firstNonEmpty(obj.name, obj.brand, obj.title);
  }
  return null;
}

function extractImage(value: unknown): string | null {
  if (typeof value === "string") return normalizeUrl(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const next = extractImage(entry);
      if (next) return next;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return normalizeUrl(firstNonEmpty(obj.url, obj.contentUrl, obj.image, obj.src));
  }
  return null;
}

function extractPriceFromOffers(offers: unknown): number | null {
  if (!offers) return null;
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const next = extractPriceFromOffers(offer);
      if (next !== null) return next;
    }
    return null;
  }
  if (typeof offers === "object") {
    const obj = offers as Record<string, unknown>;
    const direct = parsePrice(firstNonEmpty(obj.price, obj.lowPrice, obj.highPrice));
    if (direct !== null) return direct;
    if (obj.priceSpecification) {
      const nested = extractPriceFromOffers(obj.priceSpecification);
      if (nested !== null) return nested;
    }
    return null;
  }
  return parsePrice(offers);
}

function extractFirstPriceFromHtml(html: string): number | null {
  const patterns = [
    /"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/i,
    /\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const parsed = parsePrice(match[1]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function bestLdProduct(products: Record<string, any>[]): Record<string, any> | null {
  let best: Record<string, any> | null = null;
  let score = -1;
  for (const product of products) {
    const nextScore = [
      firstNonEmpty(product.name),
      extractPriceFromOffers(product.offers),
      firstNonEmpty(product.description),
      extractImage(product.image),
      extractBrand(product.brand),
    ].filter((value) => value !== null).length;
    if (nextScore > score) {
      score = nextScore;
      best = product;
    }
  }
  return best;
}

function extractProduct(html: string, sourceUrl: string): ParsedProduct | null {
  const meta = readMetaTags(html);
  const products = extractProductsFromLdJson(html);
  const ld = bestLdProduct(products);

  const name = firstNonEmpty(
    ld?.name,
    getMeta(meta, "og:title", "twitter:title", "title"),
    extractFirstH1(html),
    extractTitleTag(html),
  );
  const description = firstNonEmpty(ld?.description, getMeta(meta, "description", "og:description", "twitter:description"));
  const imageUrl = normalizeUrl(
    firstNonEmpty(extractImage(ld?.image), getMeta(meta, "og:image", "twitter:image", "twitter:image:src", "image")),
  );
  const brand = firstNonEmpty(extractBrand(ld?.brand), getMeta(meta, "product:brand", "brand", "og:brand"));
  const price =
    parsePrice(getMeta(meta, "product:price:amount", "og:price:amount", "price", "itemprop:price")) ??
    extractPriceFromOffers(ld?.offers) ??
    parsePrice(ld?.price) ??
    extractFirstPriceFromHtml(html);

  const extractedFieldCount = [name, description, imageUrl, brand, price].filter((value) => value !== null).length;
  if (extractedFieldCount === 0) return null;

  return {
    name: name || "New Item",
    price,
    description: description || null,
    imageUrl: imageUrl || null,
    brand: brand || null,
    sourceUrl,
  };
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
    const inputUrl = normalizeUrl(typeof body?.url === "string" ? body.url : "");
    if (!inputUrl) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: "Please provide a valid product URL." }));
      return;
    }

    const keyRaw = process.env.SCRAPINGBEE_API_KEY;
    const apiKey = typeof keyRaw === "string" ? keyRaw.trim() : "";
    if (!apiKey || apiKey === "YOUR_SCRAPINGBEE_API_KEY") {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: "Missing SCRAPINGBEE_API_KEY in environment variables." }));
      return;
    }

    const endpoint = new URL("https://app.scrapingbee.com/api/v1/");
    endpoint.searchParams.set("api_key", apiKey);
    endpoint.searchParams.set("url", inputUrl);
    endpoint.searchParams.set("render_js", "false");
    endpoint.searchParams.set("block_resources", "true");
    endpoint.searchParams.set("wait", "1000");

    const upstreamRes = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml",
      },
    });
    const html = await upstreamRes.text();
    if (!upstreamRes.ok) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          message: `ScrapingBee request failed (${upstreamRes.status} ${upstreamRes.statusText})`,
        }),
      );
      return;
    }

    if (!normalizeWhitespace(html)) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: "ScrapingBee returned an empty response." }));
      return;
    }

    const product = extractProduct(html, inputUrl);
    if (!product) {
      res.statusCode = 422;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: "Could not extract product data from that URL." }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, data: product }));
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: err?.message || "Failed to extract product details." }));
  }
}
