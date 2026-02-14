type ParsedProduct = {
  name: string;
  price: number | null;
  description: string | null;
  imageUrl: string | null;
  brand: string | null;
  sourceUrl: string;
  sourceDomain: string;
  currency: string | null;
  originalPrice: number | null;
  discountPercent: number | null;
  dimensionsText: string | null;
  variantText: string | null;
  specs: Array<{ key: string; value: string }>;
  raw: {
    jsonLdCount: number;
    meta: Record<string, string | null>;
  };
  captureMethod: "fallback_scraper";
};

type ScrapingBeeAttempt = "fast" | "rendered";

type ScrapingBeeResult = {
  ok: boolean;
  status: number;
  statusText: string;
  html: string;
  mode: ScrapingBeeAttempt;
};

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

function parsePercent(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  if (typeof value !== "string") return null;
  const text = normalizeWhitespace(value);
  if (!text) return null;
  const match = text.match(/([0-9]{1,3}(?:\.[0-9]+)?)\s*%/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
}

function normalizeCurrency(value: unknown): string | null {
  const raw = normalizeWhitespace(value).toUpperCase();
  if (!raw) return null;
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  if (raw === "$") return "USD";
  return null;
}

function sourceDomainFromUrl(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
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

function extractCurrencyFromOffers(offers: unknown): string | null {
  if (!offers) return null;
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const next = extractCurrencyFromOffers(offer);
      if (next) return next;
    }
    return null;
  }
  if (typeof offers !== "object") return normalizeCurrency(offers);
  const obj = offers as Record<string, unknown>;
  const direct = normalizeCurrency(firstNonEmpty(obj.priceCurrency, obj.currency));
  if (direct) return direct;
  if (obj.priceSpecification) {
    const nested = extractCurrencyFromOffers(obj.priceSpecification);
    if (nested) return nested;
  }
  return null;
}

function extractOriginalPriceFromOffers(offers: unknown): number | null {
  if (!offers) return null;
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const next = extractOriginalPriceFromOffers(offer);
      if (next !== null) return next;
    }
    return null;
  }
  if (typeof offers !== "object") return null;
  const obj = offers as Record<string, unknown>;
  const direct = parsePrice(firstNonEmpty(obj.highPrice, obj.listPrice, obj.msrp, obj.strikethroughPrice));
  if (direct !== null) return direct;
  if (obj.priceSpecification) {
    const nested = extractOriginalPriceFromOffers(obj.priceSpecification);
    if (nested !== null) return nested;
  }
  return null;
}

function appendSpec(
  out: Array<{ key: string; value: string }>,
  seen: Set<string>,
  rawKey: unknown,
  rawValue: unknown,
) {
  const key = normalizeWhitespace(rawKey);
  const value = normalizeWhitespace(rawValue);
  if (!key || !value) return;
  const k = key.toLowerCase();
  if (seen.has(k)) return;
  seen.add(k);
  out.push({ key: key.slice(0, 80), value: value.slice(0, 300) });
}

function collectAdditionalPropertySpecs(
  value: unknown,
  out: Array<{ key: string; value: string }>,
  seen: Set<string>,
) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectAdditionalPropertySpecs(entry, out, seen);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  appendSpec(out, seen, obj.name || obj.propertyID, obj.value || obj.description);
}

function extractSpecsFromTables(html: string): Array<{ key: string; value: string }> {
  const specs: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();
  const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let tableMatch: RegExpExecArray | null = null;
  while ((tableMatch = tableRegex.exec(html)) && specs.length < 24) {
    const table = tableMatch[0];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null = null;
    while ((rowMatch = rowRegex.exec(table)) && specs.length < 24) {
      const row = rowMatch[1] || "";
      const cellRegex = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null = null;
      while ((cellMatch = cellRegex.exec(row)) && cells.length < 3) {
        cells.push(stripTags(cellMatch[2] || ""));
      }
      if (cells.length < 2) continue;
      appendSpec(specs, seen, cells[0], cells[1]);
    }
  }
  return specs;
}

function extractDimensionsText(specs: Array<{ key: string; value: string }>, description: string | null): string | null {
  const dim = specs.find((entry) => /(dimension|size|width|depth|height|length)/i.test(entry.key));
  if (dim) return `${dim.key}: ${dim.value}`;
  const fromDescription = normalizeWhitespace(description).match(
    /((?:dimension|size|width|depth|height|length)[^.;\n]{0,120})/i,
  );
  return fromDescription?.[1] ? normalizeWhitespace(fromDescription[1]) : null;
}

function collectRegexPrices(html: string, pattern: RegExp): number[] {
  const prices: number[] = [];
  const regex = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html))) {
    if (!match?.[1]) continue;
    const parsed = parsePrice(match[1]);
    if (parsed !== null) prices.push(parsed);
  }
  return prices;
}

function firstPriceFromPatterns(html: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const candidates = collectRegexPrices(html, pattern);
    if (!candidates.length) continue;
    return candidates[0];
  }
  return null;
}

function extractPriceFromHtmlSignals(html: string): number | null {
  // High-confidence price markers used by Amazon and common storefront scripts.
  const strongPatterns = [
    /"priceToPay"\s*:\s*\{[\s\S]{0,220}?"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/gi,
    /"priceAmount"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/gi,
    /"currentPrice"\s*:\s*"?\$?([0-9][0-9,]*(?:\.[0-9]{1,2})?)"?/gi,
    /"salePrice"\s*:\s*"?\$?([0-9][0-9,]*(?:\.[0-9]{1,2})?)"?/gi,
    /"ourPrice"\s*:\s*"?\$?([0-9][0-9,]*(?:\.[0-9]{1,2})?)"?/gi,
    /"listPrice"\s*:\s*"?\$?([0-9][0-9,]*(?:\.[0-9]{1,2})?)"?/gi,
    /<span[^>]*class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*<\/span>/gi,
  ];
  const strong = firstPriceFromPatterns(html, strongPatterns);
  if (strong !== null) return strong;

  // Safer generic JSON fallback (requires explicit currency context).
  const guardedPatterns = [
    /"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?\s*,\s*"priceCurrency"\s*:\s*"[A-Z]{3}"/gi,
    /"priceCurrency"\s*:\s*"[A-Z]{3}"\s*,\s*"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/gi,
  ];
  return firstPriceFromPatterns(html, guardedPatterns);
}

function extractOriginalPriceFromHtmlSignals(html: string): number | null {
  const patterns = [
    /"listPrice"\s*:\s*"?\$?([0-9][0-9,]*(?:\.[0-9]{1,2})?)"?/gi,
    /"strikeThroughPrice"\s*:\s*"?\$?([0-9][0-9,]*(?:\.[0-9]{1,2})?)"?/gi,
    /"highPrice"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]{1,2})?)"?/gi,
    /class=["'][^"']*(?:a-text-price|priceBlockStrikePriceString)[^"']*["'][^>]*>\s*\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*</gi,
  ];
  return firstPriceFromPatterns(html, patterns);
}

function extractDiscountPercentFromHtmlSignals(html: string): number | null {
  const patterns = [
    /([0-9]{1,2})\s*%\s*off/gi,
    /"savingsPercentage"\s*:\s*"?([0-9]{1,2}(?:\.[0-9])?)"?/gi,
  ];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(html);
    if (!match?.[1]) continue;
    const parsed = parsePercent(`${match[1]}%`);
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
    extractPriceFromHtmlSignals(html);
  const currency =
    normalizeCurrency(getMeta(meta, "product:price:currency", "og:price:currency", "pricecurrency")) ??
    extractCurrencyFromOffers(ld?.offers);
  const originalPrice =
    extractOriginalPriceFromOffers(ld?.offers) ??
    parsePrice(getMeta(meta, "product:original_price", "product:list_price")) ??
    extractOriginalPriceFromHtmlSignals(html);
  const derivedDiscount =
    price !== null && originalPrice !== null && originalPrice > price
      ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
      : null;
  const discountPercent =
    parsePercent(getMeta(meta, "product:discount", "discount")) ??
    extractDiscountPercentFromHtmlSignals(html) ??
    derivedDiscount;

  const specs = extractSpecsFromTables(html);
  const seenSpecs = new Set(specs.map((entry) => entry.key.toLowerCase()));
  collectAdditionalPropertySpecs(ld?.additionalProperty, specs, seenSpecs);

  const dimensionsText = extractDimensionsText(specs, description || null);
  const variantText = firstNonEmpty(
    getMeta(meta, "product:color", "color", "product:size", "size", "product:material", "material"),
    specs.find((s) => /(color|size|finish|material|style)/i.test(s.key))?.value,
  );

  const extractedFieldCount = [name, description, imageUrl, brand, price].filter((value) => value !== null).length;
  if (extractedFieldCount === 0) return null;

  return {
    name: name || "New Item",
    price,
    description: description || null,
    imageUrl: imageUrl || null,
    brand: brand || null,
    sourceUrl,
    sourceDomain: sourceDomainFromUrl(sourceUrl),
    currency: currency || null,
    originalPrice,
    discountPercent,
    dimensionsText: dimensionsText || null,
    variantText: variantText || null,
    specs,
    raw: {
      jsonLdCount: products.length,
      meta: {
        ogTitle: getMeta(meta, "og:title"),
        ogImage: getMeta(meta, "og:image"),
        ogDescription: getMeta(meta, "og:description"),
      },
    },
    captureMethod: "fallback_scraper",
  };
}

function hasCriticalProductFields(product: ParsedProduct | null): boolean {
  if (!product) return false;
  const normalizedName = normalizeWhitespace(product.name).toLowerCase();
  const hasName = normalizedName.length > 0 && normalizedName !== "new item";
  const hasPrice = typeof product.price === "number" && Number.isFinite(product.price) && product.price > 0;
  const hasImage = Boolean(normalizeWhitespace(product.imageUrl));
  if (!hasName) return false;
  return hasPrice || hasImage;
}

function looksLikeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?.*)?$/.test(pathname)) return true;
    if (pathname.includes("/image/upload/")) return true;
    return false;
  } catch {
    return false;
  }
}

async function fetchScrapingBeeHtml(apiKey: string, inputUrl: string, mode: ScrapingBeeAttempt): Promise<ScrapingBeeResult> {
  const endpoint = new URL("https://app.scrapingbee.com/api/v1/");
  endpoint.searchParams.set("api_key", apiKey);
  endpoint.searchParams.set("url", inputUrl);
  endpoint.searchParams.set("wait", mode === "rendered" ? "3000" : "1000");
  endpoint.searchParams.set("render_js", mode === "rendered" ? "true" : "false");
  endpoint.searchParams.set("block_resources", mode === "rendered" ? "false" : "true");

  const upstreamRes = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml",
    },
  });

  return {
    ok: upstreamRes.ok,
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    html: await upstreamRes.text(),
    mode,
  };
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

    if (looksLikeImageUrl(inputUrl)) {
      const imageOnlyProduct: ParsedProduct = {
        name: "New Item",
        price: null,
        description: null,
        imageUrl: inputUrl,
        brand: null,
        sourceUrl: inputUrl,
        sourceDomain: sourceDomainFromUrl(inputUrl),
        currency: null,
        originalPrice: null,
        discountPercent: null,
        dimensionsText: null,
        variantText: null,
        specs: [],
        raw: {
          jsonLdCount: 0,
          meta: {
            ogTitle: null,
            ogImage: inputUrl,
            ogDescription: null,
          },
        },
        captureMethod: "fallback_scraper",
      };
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, data: imageOnlyProduct, mode: "image_url_shortcut" }));
      return;
    }

    const attempts: ScrapingBeeAttempt[] = ["fast", "rendered"];
    let bestProduct: ParsedProduct | null = null;
    let bestMode: ScrapingBeeAttempt | null = null;
    let lastError = "";

    for (const mode of attempts) {
      const upstream = await fetchScrapingBeeHtml(apiKey, inputUrl, mode);
      if (!upstream.ok) {
        lastError = `ScrapingBee request failed (${upstream.status} ${upstream.statusText})`;
        continue;
      }
      if (!normalizeWhitespace(upstream.html)) {
        lastError = "ScrapingBee returned an empty response.";
        continue;
      }

      const extracted = extractProduct(upstream.html, inputUrl);
      if (!extracted) {
        lastError = "Could not extract product data from that URL.";
        continue;
      }

      bestProduct = extracted;
      bestMode = mode;

      if (hasCriticalProductFields(extracted)) {
        break;
      }
    }

    if (!bestProduct) {
      res.statusCode = 422;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, message: lastError || "Could not extract product data from that URL." }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        data: bestProduct,
        mode: bestMode || "fast",
        fallbackUsed: bestMode === "rendered",
      }),
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, message: err?.message || "Failed to extract product details." }));
  }
}
