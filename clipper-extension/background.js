const DEFAULT_PORTAL_URL = "https://app-furniture-tracker.vercel.app";

const DEFAULT_SETTINGS = {
  baseApiUrl: "",
  baseWebUrl: "",
  token: "",
  autoCaptureOnPopupOpen: true,
  openEditTab: true,
};

const SETTINGS_KEY = "ft.clipper.settings";
const LAST_STATUS_KEY = "ft.clipper.lastStatus";

function cleanText(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function clipText(input, max = 240) {
  const value = cleanText(input);
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function trimSlash(input) {
  const value = cleanText(input);
  return value ? value.replace(/\/+$/, "") : "";
}

function normalizeBaseUrl(input) {
  const value = trimSlash(input);
  return value.replace(/\/api$/i, "");
}

function normalizeSettings(input) {
  const raw = input && typeof input === "object" ? input : {};
  return {
    baseApiUrl: normalizeBaseUrl(raw.baseApiUrl),
    baseWebUrl: normalizeBaseUrl(raw.baseWebUrl),
    token: cleanText(raw.token),
    autoCaptureOnPopupOpen: raw.autoCaptureOnPopupOpen !== false,
    openEditTab: raw.openEditTab !== false,
  };
}

async function getSettings() {
  const saved = await chrome.storage.local.get([SETTINGS_KEY]);
  return normalizeSettings(saved[SETTINGS_KEY]);
}

async function saveSettings(next) {
  const normalized = normalizeSettings(next);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

async function getLastStatus() {
  const saved = await chrome.storage.local.get([LAST_STATUS_KEY]);
  return saved[LAST_STATUS_KEY] || null;
}

async function setLastStatus(status) {
  const next = {
    at: Date.now(),
    ...status,
  };
  await chrome.storage.local.set({ [LAST_STATUS_KEY]: next });
  if (next.ok) console.log("[clipper] success", next);
  else console.error("[clipper] failure", next);
  return next;
}

function normalizeNumber(input) {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const raw = cleanText(input);
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

function normalizeUrl(input) {
  const raw = cleanText(input);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeDomain(input, fallbackUrl) {
  const value = cleanText(input).replace(/^www\./i, "");
  if (value) return value;
  try {
    return new URL(fallbackUrl).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function shouldUseFallback(payload) {
  const hasName = Boolean(cleanText(payload?.name));
  const hasPrice = typeof payload?.price === "number" && Number.isFinite(payload.price);
  const hasImage = Boolean(cleanText(payload?.imageUrl));
  if (!hasName) return true;
  return !hasPrice && !hasImage;
}

function isAppHost(hostname) {
  return hostname === "app-furniture-tracker.vercel.app" || hostname === "localhost" || hostname === "127.0.0.1";
}

function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return isAppHost(parsed.hostname);
  } catch {
    return false;
  }
}

function getUrlOrigin(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function uniqueNonEmpty(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const value = normalizeBaseUrl(raw);
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function ensureSupportedTab(tab) {
  const url = cleanText(tab?.url);
  if (!tab?.id || !url) throw new Error("No active tab URL found.");
  if (/^(chrome|edge|about|chrome-extension):/i.test(url)) {
    throw new Error("This page cannot be clipped. Open a regular product page first.");
  }
  return { id: tab.id, url };
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab) throw new Error("No active tab found.");
  return ensureSupportedTab(tab);
}

async function getActiveTabSafe() {
  try {
    return await getActiveTab();
  } catch {
    return null;
  }
}

async function listKnownAppOrigins(activeTabUrl = "") {
  const origins = [];

  const addOrigin = (rawUrl) => {
    if (!rawUrl || !isAppUrl(rawUrl)) return;
    const origin = normalizeBaseUrl(getUrlOrigin(rawUrl));
    if (!origin) return;
    if (origins.includes(origin)) return;
    origins.push(origin);
  };

  addOrigin(activeTabUrl);

  try {
    const appTabs = await chrome.tabs.query({
      url: [
        "https://app-furniture-tracker.vercel.app/*",
        "http://localhost:*/*",
        "http://127.0.0.1:*/*",
        "https://localhost:*/*",
        "https://127.0.0.1:*/*",
      ],
    });
    appTabs
      .slice()
      .sort((a, b) => (Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0)))
      .forEach((tab) => addOrigin(tab.url));
  } catch (err) {
    console.warn("[clipper] failed to query app tabs", err);
  }

  addOrigin(DEFAULT_PORTAL_URL);
  return origins;
}

async function resolveTargets(settings, activeTabUrl = "") {
  const configuredApi = normalizeBaseUrl(settings?.baseApiUrl);
  const configuredWeb = normalizeBaseUrl(settings?.baseWebUrl);
  const appOrigins = await listKnownAppOrigins(activeTabUrl);
  const autoOrigin = appOrigins[0] || normalizeBaseUrl(DEFAULT_PORTAL_URL);

  const baseApiUrl = configuredApi || configuredWeb || autoOrigin;
  const baseWebUrl = configuredWeb || configuredApi || autoOrigin;

  return {
    baseApiUrl,
    baseWebUrl,
    candidateApiUrls: uniqueNonEmpty([baseApiUrl, ...appOrigins]),
    autoOrigin,
    activeTabIsApp: Boolean(activeTabUrl && isAppUrl(activeTabUrl)),
    usedConfiguredApi: Boolean(configuredApi),
    usedConfiguredWeb: Boolean(configuredWeb),
  };
}

async function extractFromBrowser(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      if (typeof window.__FT_BUILD_PAYLOAD__ !== "function") return null;
      try {
        return window.__FT_BUILD_PAYLOAD__();
      } catch (err) {
        return { __error: String(err?.message || err || "Unknown content extraction error") };
      }
    },
  });

  const payload = results?.[0]?.result || null;
  if (!payload) throw new Error("Content script returned no payload.");
  if (payload.__error) throw new Error(payload.__error);
  return payload;
}

async function callScraper(baseApiUrl, sourceUrl) {
  const endpoint = `${normalizeBaseUrl(baseApiUrl)}/api/scrape/product`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: sourceUrl }),
  });
  const text = await res.text();
  const json = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  })();
  if (!res.ok || !json?.ok || !json?.data) {
    const hint = json?.message || clipText(text) || `Fallback scraper failed (${res.status}).`;
    throw new Error(hint);
  }
  return json.data;
}

function mergePayload(basePayload, scraperData, sourceUrl, fallbackReason = "") {
  const base = basePayload && typeof basePayload === "object" ? basePayload : {};
  const scraper = scraperData && typeof scraperData === "object" ? scraperData : {};
  return {
    sourceUrl: normalizeUrl(base.sourceUrl || scraper.sourceUrl || sourceUrl) || sourceUrl,
    sourceDomain: normalizeDomain(base.sourceDomain || scraper.sourceDomain, sourceUrl),
    name: cleanText(base.name || scraper.name) || "New Item",
    price: normalizeNumber(base.price ?? scraper.price),
    currency: cleanText(base.currency || scraper.currency) || null,
    originalPrice: normalizeNumber(base.originalPrice ?? scraper.originalPrice),
    discountPercent: normalizeNumber(base.discountPercent ?? scraper.discountPercent),
    imageUrl: normalizeUrl(base.imageUrl || scraper.imageUrl),
    brand: cleanText(base.brand || scraper.brand) || null,
    description: cleanText(base.description || scraper.description) || null,
    dimensionsText: cleanText(base.dimensionsText || scraper.dimensionsText) || null,
    specs: Array.isArray(base.specs) ? base.specs : [],
    variantText: cleanText(base.variantText || scraper.variantText) || null,
    captureMethod: "fallback_scraper",
    raw: {
      browser: base.raw || null,
      fallbackScraper: scraper,
      fallbackReason,
    },
  };
}

async function postClip(baseApiUrl, token, payload) {
  const root = normalizeBaseUrl(baseApiUrl);
  const endpoint = `${root}/api/clip`;
  const requestBody = JSON.stringify({
    ...payload,
    clipperToken: token,
  });
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      // text/plain keeps this a simple cross-origin request and avoids preflight edge failures.
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: requestBody,
  });

  const text = await res.text();
  const json = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  })();

  if (!res.ok || !json?.ok || !json?.itemId) {
    const detail = json?.message || clipText(text) || `Clip API failed (${res.status}).`;
    const error = new Error(`Clip API failed (${res.status}) at ${endpoint}: ${detail}`);
    error.status = res.status;
    error.endpoint = endpoint;
    error.apiBaseUrl = root;
    throw error;
  }

  return {
    ...json,
    endpoint,
    apiBaseUrl: root,
  };
}

async function postClipWithRetry(baseApiUrls, token, payload) {
  const targets = uniqueNonEmpty(baseApiUrls);
  const retryableStatuses = new Set([401, 404, 405]);
  const attempts = [];

  for (let i = 0; i < targets.length; i += 1) {
    const baseApiUrl = targets[i];
    try {
      const result = await postClip(baseApiUrl, token, payload);
      result.attempts = attempts;
      return result;
    } catch (err) {
      const status = typeof err?.status === "number" ? err.status : null;
      attempts.push({
        baseApiUrl,
        endpoint: cleanText(err?.endpoint) || `${baseApiUrl}/api/clip`,
        status,
        message: clipText(err?.message, 400),
      });
      const isLast = i >= targets.length - 1;
      const retryable = status === null || retryableStatuses.has(status);
      if (isLast || !retryable) {
        err.attempts = attempts;
        throw err;
      }
    }
  }

  const error = new Error("Clip API failed: no endpoints available.");
  error.attempts = attempts;
  throw error;
}

async function openOrFocusEditTab(baseWebUrl, itemId) {
  const base = normalizeBaseUrl(baseWebUrl);
  if (!base) throw new Error("Missing baseWebUrl.");
  const editUrl = `${base}/clip/open/${encodeURIComponent(itemId)}?from=clipper`;
  let origin = "";
  try {
    origin = new URL(base).origin;
  } catch {
    throw new Error("Invalid baseWebUrl.");
  }

  const candidates = await chrome.tabs.query({ url: [`${origin}/clip/open/*`, `${origin}/items/*`] });
  const match = candidates.find((tab) => cleanText(tab.url).includes(`/clip/open/${itemId}`) || cleanText(tab.url).includes(`/items/${itemId}`));
  if (match?.id) {
    await chrome.tabs.update(match.id, { active: true, url: editUrl });
    if (typeof match.windowId === "number") {
      await chrome.windows.update(match.windowId, { focused: true });
    }
    return { opened: false, url: editUrl };
  }
  await chrome.tabs.create({ url: editUrl, active: true });
  return { opened: true, url: editUrl };
}

async function buildPayloadFromActiveTab(tab, baseApiUrl) {
  let browserPayload = null;
  let browserError = null;
  try {
    browserPayload = await extractFromBrowser(tab.id);
  } catch (err) {
    browserError = err;
    console.warn("[clipper] browser extraction failed, attempting fallback", err);
  }

  let payload = browserPayload;
  let usedFallback = false;
  let fallbackWarning = "";
  const needFallback = browserError || !browserPayload || shouldUseFallback(browserPayload);

  if (needFallback) {
    usedFallback = true;
    try {
      const scraperData = await callScraper(baseApiUrl, tab.url);
      const reason = browserError ? `browser_error:${browserError.message || browserError}` : "missing_critical_fields";
      payload = mergePayload(browserPayload, scraperData, tab.url, reason);
    } catch (fallbackErr) {
      console.warn("[clipper] fallback scraper failed", fallbackErr);
      fallbackWarning = fallbackErr?.message || String(fallbackErr);
      if (browserPayload && cleanText(browserPayload.name)) {
        payload = {
          ...browserPayload,
          sourceUrl: normalizeUrl(browserPayload.sourceUrl || tab.url) || tab.url,
          sourceDomain: normalizeDomain(browserPayload.sourceDomain, tab.url),
          captureMethod: "browser",
          raw: {
            ...(browserPayload.raw || {}),
            fallbackWarning,
          },
        };
        usedFallback = false;
      } else {
        throw new Error(`Browser extraction failed and fallback failed: ${fallbackWarning}`);
      }
    }
  }

  if (!payload || !cleanText(payload.name)) {
    throw new Error("Capture failed: no product title was found.");
  }

  return { payload, usedFallback, fallbackWarning };
}

async function buildPayloadFromManualUrl(sourceUrl, baseApiUrl) {
  const scraperData = await callScraper(baseApiUrl, sourceUrl);
  return {
    payload: mergePayload(null, scraperData, sourceUrl, "manual_url_from_app_tab"),
    usedFallback: true,
    fallbackWarning: "",
  };
}

async function performCapture(options = {}) {
  const trigger = cleanText(options.trigger) || "manual";
  const sourceUrlOverride = normalizeUrl(options.sourceUrlOverride);

  const settings = await getSettings();
  if (!settings.token) throw new Error("Missing clipper token. Open popup settings and set token first.");

  const tab = await getActiveTab();
  const targets = await resolveTargets(settings, tab.url);

  let payload = null;
  let usedFallback = false;
  let fallbackWarning = "";

  if (sourceUrlOverride) {
    const manual = await buildPayloadFromManualUrl(sourceUrlOverride, targets.baseApiUrl);
    payload = manual.payload;
    usedFallback = manual.usedFallback;
    fallbackWarning = manual.fallbackWarning;
  } else if (targets.activeTabIsApp) {
    throw new Error("You are on the app tab. Paste a product URL in the popup first.");
  } else {
    const extracted = await buildPayloadFromActiveTab(tab, targets.baseApiUrl);
    payload = extracted.payload;
    usedFallback = extracted.usedFallback;
    fallbackWarning = extracted.fallbackWarning;
  }

  const clipResponse = await postClipWithRetry(targets.candidateApiUrls, settings.token, payload);
  const baseWebUrl = targets.usedConfiguredWeb ? targets.baseWebUrl : clipResponse.apiBaseUrl;

  let opened = null;
  if (settings.openEditTab !== false) {
    opened = await openOrFocusEditTab(baseWebUrl, clipResponse.itemId);
  }

  const status = await setLastStatus({
    ok: true,
    trigger,
    itemId: clipResponse.itemId,
    usedFallback,
    message: usedFallback
      ? "Captured with fallback scraper. Opened item editor."
      : "Captured from browser page. Opened item editor.",
    details: {
      sourceUrl: payload.sourceUrl || tab.url,
      sourceDomain: payload.sourceDomain || "",
      fallbackWarning: fallbackWarning || null,
      openedUrl: opened?.url || null,
      clipApiBaseUrl: clipResponse.apiBaseUrl,
      clipEndpoint: clipResponse.endpoint,
      attempts: clipResponse.attempts || [],
    },
  });

  return status;
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = cleanText(message?.type);

  if (type === "ft.capture") {
    performCapture({
      trigger: message?.trigger || "popup",
      sourceUrlOverride: message?.sourceUrlOverride,
    })
      .then((status) => sendResponse({ ok: true, status }))
      .catch(async (err) => {
        const currentSettings = await getSettings().catch(() => ({ token: "" }));
        const status = await setLastStatus({
          ok: false,
          trigger: message?.trigger || "popup",
          message: err?.message || "Capture failed.",
          details: {
            tokenConfigured: Boolean(cleanText(currentSettings?.token)),
            endpoint: cleanText(err?.endpoint) || null,
            status: typeof err?.status === "number" ? err.status : null,
            attempts: Array.isArray(err?.attempts) ? err.attempts : null,
            stack: clipText(err?.stack, 2000) || null,
          },
        });
        sendResponse({ ok: false, status });
      });
    return true;
  }

  if (type === "ft.getState") {
    (async () => {
      const settings = await getSettings();
      const lastStatus = await getLastStatus();
      const activeTab = await getActiveTabSafe();
      const targets = await resolveTargets(settings, activeTab?.url || "");
      return {
        ok: true,
        settings,
        lastStatus,
        context: {
          activeTabUrl: activeTab?.url || "",
          activeTabIsApp: targets.activeTabIsApp,
          resolvedBaseApiUrl: targets.baseApiUrl,
          resolvedBaseWebUrl: targets.baseWebUrl,
          usingAutoApiUrl: !targets.usedConfiguredApi,
          usingAutoWebUrl: !targets.usedConfiguredWeb,
        },
      };
    })()
      .then((payload) => sendResponse(payload))
      .catch((err) => sendResponse({ ok: false, message: err?.message || "Failed to load state." }));
    return true;
  }

  if (type === "ft.saveSettings") {
    saveSettings(message?.settings || {})
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((err) => sendResponse({ ok: false, message: err?.message || "Failed to save settings." }));
    return true;
  }

  sendResponse({ ok: false, message: "Unknown message type." });
  return false;
});

chrome.action.onClicked.addListener(() => {
  void performCapture({ trigger: "action" }).catch(async (err) => {
    const currentSettings = await getSettings().catch(() => ({ token: "" }));
    await setLastStatus({
      ok: false,
      trigger: "action",
      message: err?.message || "Capture failed.",
      details: {
        tokenConfigured: Boolean(cleanText(currentSettings?.token)),
        endpoint: cleanText(err?.endpoint) || null,
        status: typeof err?.status === "number" ? err.status : null,
        attempts: Array.isArray(err?.attempts) ? err.attempts : null,
        stack: clipText(err?.stack, 2000) || null,
      },
    });
  });
});
