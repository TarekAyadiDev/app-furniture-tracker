(() => {
  function cleanText(input) {
    return String(input || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const raw = cleanText(value);
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
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }

  function parsePriceText(input) {
    const text = cleanText(input);
    if (!text) return { amount: null, currency: null };
    const currencyMap = [
      { re: /\$/g, code: "USD" },
      { re: /€/g, code: "EUR" },
      { re: /£/g, code: "GBP" },
      { re: /AED|USD|EUR|GBP|CAD|AUD|SAR|QAR/i, code: null },
    ];
    let currency = null;
    for (const entry of currencyMap) {
      if (entry.re.test(text)) {
        currency = entry.code || (text.match(/AED|USD|EUR|GBP|CAD|AUD|SAR|QAR/i) || [null])[0];
        break;
      }
    }
    const amount = toNumber(text);
    return { amount, currency: currency ? String(currency).toUpperCase() : null };
  }

  function firstTruthy(...values) {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      const text = cleanText(value);
      if (text) return text;
    }
    return null;
  }

  function firstNumber(...values) {
    for (const value of values) {
      const num = toNumber(value);
      if (num !== null) return num;
    }
    return null;
  }

  function textFromSelector(selector, root = document) {
    const node = root.querySelector(selector);
    if (!node) return null;
    return cleanText(node.textContent || "");
  }

  function attrFromSelector(selector, attr, root = document) {
    const node = root.querySelector(selector);
    if (!node) return null;
    const value = node.getAttribute(attr);
    return cleanText(value);
  }

  function metaContent(key, attr = "property") {
    const node = document.querySelector(`meta[${attr}="${key}"]`);
    return cleanText(node?.getAttribute("content"));
  }

  function collectProductNodes(node, out) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const entry of node) collectProductNodes(entry, out);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node;
    const type = obj["@type"];
    const typeValues = Array.isArray(type) ? type : [type];
    const hasProduct = typeValues.some((entry) => String(entry || "").toLowerCase().includes("product"));
    if (hasProduct) out.push(obj);
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") collectProductNodes(value, out);
    }
  }

  function extractOffer(offers) {
    if (!offers) return { price: null, currency: null, originalPrice: null, discountPercent: null };
    if (Array.isArray(offers)) {
      for (const offer of offers) {
        const next = extractOffer(offer);
        if (next.price !== null) return next;
      }
      return { price: null, currency: null, originalPrice: null, discountPercent: null };
    }
    if (typeof offers !== "object") return { price: toNumber(offers), currency: null, originalPrice: null, discountPercent: null };
    const obj = offers;
    const price = firstNumber(obj.price, obj.lowPrice, obj.highPrice);
    const currency = cleanText(obj.priceCurrency || "");
    return {
      price,
      currency: currency || null,
      originalPrice: firstNumber(obj.listPrice, obj.highPrice),
      discountPercent: firstNumber(obj.discount, obj.discountPercent),
    };
  }

  function extractImage(value) {
    if (!value) return null;
    if (typeof value === "string") return cleanText(value) || null;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const next = extractImage(entry);
        if (next) return next;
      }
      return null;
    }
    if (typeof value === "object") {
      return firstTruthy(value.url, value.contentUrl, value.image, value.src);
    }
    return null;
  }

  function parseJsonLd() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const rawScripts = [];
    const products = [];
    for (const script of scripts) {
      const text = cleanText(script.textContent || "");
      if (!text) continue;
      rawScripts.push(text.slice(0, 2000));
      try {
        const parsed = JSON.parse(script.textContent || "{}");
        collectProductNodes(parsed, products);
      } catch {
        // ignore malformed JSON-LD
      }
    }

    let best = null;
    let bestScore = -1;
    for (const product of products) {
      const offers = extractOffer(product.offers);
      const candidate = {
        name: firstTruthy(product.name, product.headline),
        description: firstTruthy(product.description),
        brand: typeof product.brand === "object" ? firstTruthy(product.brand?.name, product.brand?.brand) : firstTruthy(product.brand),
        imageUrl: extractImage(product.image),
        price: offers.price,
        currency: offers.currency,
        originalPrice: offers.originalPrice,
        discountPercent: offers.discountPercent,
      };
      const score = [candidate.name, candidate.price, candidate.imageUrl, candidate.brand, candidate.description].filter(Boolean).length;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return {
      data: best || {
        name: null,
        description: null,
        brand: null,
        imageUrl: null,
        price: null,
        currency: null,
        originalPrice: null,
        discountPercent: null,
      },
      raw: rawScripts.slice(0, 8),
    };
  }

  function parseOpenGraph() {
    const priceMeta = metaContent("product:price:amount") || metaContent("og:price:amount") || metaContent("price");
    const parsedPrice = parsePriceText(priceMeta);
    return {
      title: firstTruthy(metaContent("og:title"), metaContent("twitter:title"), document.title),
      imageUrl: firstTruthy(metaContent("og:image"), metaContent("twitter:image"), metaContent("twitter:image:src")),
      description: firstTruthy(metaContent("og:description"), metaContent("description", "name"), metaContent("twitter:description")),
      price: parsedPrice.amount,
      currency: firstTruthy(metaContent("product:price:currency"), metaContent("og:price:currency"), parsedPrice.currency),
      raw: {
        ogTitle: metaContent("og:title"),
        ogImage: metaContent("og:image"),
        ogDescription: metaContent("og:description"),
        metaDescription: metaContent("description", "name"),
        ogPrice: metaContent("product:price:amount") || metaContent("og:price:amount"),
      },
    };
  }

  function amazonData() {
    if (!/amazon\./i.test(location.hostname)) {
      return {
        name: null,
        price: null,
        currency: null,
        originalPrice: null,
        discountPercent: null,
        imageUrl: null,
        brand: null,
        description: null,
        dimensionsText: null,
        variantText: null,
        specs: [],
        raw: null,
      };
    }

    const title = firstTruthy(textFromSelector("#productTitle"), textFromSelector("h1 span#title"));

    const priceSelectors = [
      "#corePriceDisplay_desktop_feature_div .a-offscreen",
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
    ];
    let price = null;
    let currency = null;
    for (const selector of priceSelectors) {
      const text = textFromSelector(selector);
      if (!text) continue;
      const parsed = parsePriceText(text);
      if (parsed.amount !== null) {
        price = parsed.amount;
        currency = parsed.currency;
        break;
      }
    }

    const listPrice = parsePriceText(
      firstTruthy(
        textFromSelector("#corePrice_feature_div .basisPrice .a-offscreen"),
        textFromSelector("#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen"),
      ),
    );

    const discountPercent = firstNumber(
      textFromSelector("#corePriceDisplay_desktop_feature_div .savingsPercentage"),
      textFromSelector("#corePrice_feature_div .savingsPercentage"),
    );

    let imageUrl = firstTruthy(attrFromSelector("#landingImage", "src"), attrFromSelector("#imgTagWrapperId img", "src"));
    const dynamicImageRaw = attrFromSelector("#landingImage", "data-a-dynamic-image");
    if (!imageUrl && dynamicImageRaw) {
      try {
        const parsed = JSON.parse(dynamicImageRaw);
        const firstKey = Object.keys(parsed || {})[0];
        if (firstKey) imageUrl = firstKey;
      } catch {
        // ignore
      }
    }

    const brand = firstTruthy(textFromSelector("#bylineInfo"), textFromSelector("a#bylineInfo"));
    const bullets = Array.from(document.querySelectorAll("#feature-bullets li span.a-list-item"))
      .map((node) => cleanText(node.textContent || ""))
      .filter(Boolean);
    const description = bullets.length ? bullets.slice(0, 8).join(" | ") : null;

    const specs = [];
    for (const row of document.querySelectorAll("#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr")) {
      const key = cleanText(row.querySelector("th")?.textContent || row.children?.[0]?.textContent || "");
      const value = cleanText(row.querySelector("td")?.textContent || row.children?.[1]?.textContent || "");
      if (!key || !value) continue;
      specs.push({ key, value });
    }

    const dimensionCandidate = specs.find((entry) => /dimension|size|width|height|depth|length/i.test(entry.key));
    const dimensionsText = firstTruthy(dimensionCandidate?.value, bullets.find((line) => /dimension|size/i.test(line)));

    const variantPieces = [
      textFromSelector("#variation_color_name .selection"),
      textFromSelector("#variation_size_name .selection"),
      textFromSelector("#variation_style_name .selection"),
    ].filter(Boolean);

    return {
      name: title,
      price,
      currency,
      originalPrice: listPrice.amount,
      discountPercent,
      imageUrl,
      brand,
      description,
      dimensionsText,
      variantText: variantPieces.length ? variantPieces.join(" | ") : null,
      specs: specs.slice(0, 30),
      raw: {
        title,
        priceText: priceSelectors.map((selector) => ({ selector, value: textFromSelector(selector) })).filter((entry) => entry.value),
        byline: textFromSelector("#bylineInfo"),
      },
    };
  }

  function genericData() {
    const name = firstTruthy(textFromSelector("h1"), textFromSelector('[itemprop="name"]'));
    const description = firstTruthy(
      textFromSelector('[itemprop="description"]'),
      textFromSelector("main p"),
      textFromSelector("article p"),
    );

    const priceCandidates = [
      textFromSelector('[itemprop="price"]'),
      textFromSelector('[data-testid*="price"]'),
      textFromSelector('[class*="price"]'),
      textFromSelector('[id*="price"]'),
    ].filter(Boolean);
    let price = null;
    let currency = null;
    for (const candidate of priceCandidates) {
      const parsed = parsePriceText(candidate);
      if (parsed.amount !== null) {
        price = parsed.amount;
        currency = parsed.currency;
        break;
      }
    }

    const imageUrl = firstTruthy(
      attrFromSelector('meta[property="og:image"]', "content"),
      attrFromSelector('img[itemprop="image"]', "src"),
      attrFromSelector("main img", "src"),
    );

    const specs = [];
    for (const row of document.querySelectorAll("table tr")) {
      const key = cleanText(row.querySelector("th")?.textContent || row.children?.[0]?.textContent || "");
      const value = cleanText(row.querySelector("td")?.textContent || row.children?.[1]?.textContent || "");
      if (!key || !value) continue;
      specs.push({ key, value });
    }

    const bulletLines = Array.from(document.querySelectorAll("li"))
      .map((node) => cleanText(node.textContent || ""))
      .filter((line) => line && line.length <= 220)
      .slice(0, 40);
    const dimensionsText = firstTruthy(
      specs.find((entry) => /dimension|size|width|height|depth|length/i.test(entry.key))?.value,
      bulletLines.find((line) => /dimension|size|width|height|depth|length/i.test(line)),
    );

    const variantText = firstTruthy(
      textFromSelector('select[name*="color"] option:checked'),
      textFromSelector('select[name*="size"] option:checked'),
      textFromSelector('[aria-label*="Color"] [aria-pressed="true"]'),
      textFromSelector('[aria-label*="Size"] [aria-pressed="true"]'),
    );

    return {
      name,
      price,
      currency,
      imageUrl,
      description,
      dimensionsText,
      variantText,
      specs: specs.slice(0, 30),
      raw: {
        priceCandidates: priceCandidates.slice(0, 6),
        topBullet: bulletLines.slice(0, 8),
      },
    };
  }

  function mergeSpecs(...groups) {
    const out = [];
    const seen = new Set();
    for (const group of groups) {
      if (!Array.isArray(group)) continue;
      for (const entry of group) {
        if (!entry || typeof entry !== "object") continue;
        const key = cleanText(entry.key);
        const value = cleanText(entry.value);
        if (!key || !value) continue;
        const id = `${key.toLowerCase()}::${value.toLowerCase()}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ key, value });
      }
    }
    return out.slice(0, 40);
  }

  function buildPayload() {
    const ld = parseJsonLd();
    const og = parseOpenGraph();
    const amazon = amazonData();
    const generic = genericData();

    const sourceUrl = location.href;
    const sourceDomain = location.hostname.replace(/^www\./i, "");
    const name = firstTruthy(amazon.name, ld.data.name, og.title, generic.name);
    const price = firstNumber(amazon.price, ld.data.price, og.price, generic.price);
    const currency = firstTruthy(amazon.currency, ld.data.currency, og.currency, generic.currency);
    const originalPrice = firstNumber(amazon.originalPrice, ld.data.originalPrice);
    const discountPercent = firstNumber(
      amazon.discountPercent,
      ld.data.discountPercent,
      originalPrice !== null && price !== null && originalPrice > price ? ((originalPrice - price) / originalPrice) * 100 : null,
    );
    const imageUrl = firstTruthy(amazon.imageUrl, ld.data.imageUrl, og.imageUrl, generic.imageUrl);
    const brand = firstTruthy(amazon.brand, ld.data.brand);
    const description = firstTruthy(amazon.description, ld.data.description, og.description, generic.description);
    const dimensionsText = firstTruthy(amazon.dimensionsText, generic.dimensionsText);
    const variantText = firstTruthy(amazon.variantText, generic.variantText);
    const specs = mergeSpecs(amazon.specs, generic.specs);

    return {
      sourceUrl,
      sourceDomain,
      name: name || null,
      price,
      currency: currency || null,
      originalPrice,
      discountPercent,
      imageUrl: imageUrl || null,
      brand: brand || null,
      description: description || null,
      dimensionsText: dimensionsText || null,
      specs,
      variantText: variantText || null,
      captureMethod: "browser",
      raw: {
        jsonLd: ld.raw,
        og: og.raw,
        siteSpecific: {
          amazon: amazon.raw,
          generic: generic.raw,
        },
      },
    };
  }

  window.__FT_BUILD_PAYLOAD__ = buildPayload;
})();
