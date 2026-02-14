const elements = {
  modeHint: document.getElementById("modeHint"),
  manualUrlSection: document.getElementById("manualUrlSection"),
  manualUrl: document.getElementById("manualUrl"),
  baseApiUrl: document.getElementById("baseApiUrl"),
  baseWebUrl: document.getElementById("baseWebUrl"),
  token: document.getElementById("token"),
  autoCaptureOnPopupOpen: document.getElementById("autoCaptureOnPopupOpen"),
  openEditTab: document.getElementById("openEditTab"),
  captureBtn: document.getElementById("captureBtn"),
  saveBtn: document.getElementById("saveBtn"),
  statusText: document.getElementById("statusText"),
  statusDetails: document.getElementById("statusDetails"),
  resolvedTargets: document.getElementById("resolvedTargets"),
};

let popupContext = {
  activeTabIsApp: false,
};

function cleanText(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function shortText(input, max = 120) {
  const text = cleanText(input);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false, message: "No response from background service worker." });
    });
  });
}

function renderStatus(status) {
  if (!status) {
    elements.statusText.textContent = "No captures yet.";
    elements.statusText.className = "statusText idle";
    elements.statusDetails.textContent = "";
    return;
  }

  elements.statusText.textContent = status.message || (status.ok ? "Capture completed." : "Capture failed.");
  elements.statusText.className = `statusText ${status.ok ? "ok" : "error"}`;
  const details = {
    at: status.at ? new Date(status.at).toLocaleString() : null,
    trigger: status.trigger || null,
    itemId: status.itemId || null,
    usedFallback: status.usedFallback || false,
    details: status.details || null,
  };
  elements.statusDetails.textContent = JSON.stringify(details, null, 2);
}

function renderContext(context) {
  popupContext = context && typeof context === "object" ? context : { activeTabIsApp: false };
  const activeTabIsApp = popupContext.activeTabIsApp === true;

  elements.manualUrlSection.classList.toggle("hidden", !activeTabIsApp);
  elements.captureBtn.textContent = activeTabIsApp ? "Capture URL" : "Capture Current Tab";

  if (activeTabIsApp) {
    elements.modeHint.textContent = "App tab detected. Paste a product URL, then capture via scraper fallback.";
  } else {
    elements.modeHint.textContent = "Product tab detected. Capture uses rendered DOM first, then scraper fallback if needed.";
  }

  const apiMode = popupContext.usingAutoApiUrl ? "auto" : "override";
  const webMode = popupContext.usingAutoWebUrl ? "auto" : "override";
  elements.resolvedTargets.textContent = `API target (${apiMode}): ${shortText(popupContext.resolvedBaseApiUrl || "-")} | Web target (${webMode}): ${shortText(popupContext.resolvedBaseWebUrl || "-")}`;
}

function collectSettings() {
  return {
    baseApiUrl: elements.baseApiUrl.value.trim(),
    baseWebUrl: elements.baseWebUrl.value.trim(),
    token: elements.token.value.trim(),
    autoCaptureOnPopupOpen: elements.autoCaptureOnPopupOpen.checked,
    openEditTab: elements.openEditTab.checked,
  };
}

function fillSettings(settings) {
  elements.baseApiUrl.value = settings.baseApiUrl || "";
  elements.baseWebUrl.value = settings.baseWebUrl || "";
  elements.token.value = settings.token || "";
  elements.autoCaptureOnPopupOpen.checked = settings.autoCaptureOnPopupOpen !== false;
  elements.openEditTab.checked = settings.openEditTab !== false;
}

async function loadState() {
  const state = await sendMessage({ type: "ft.getState" });
  if (!state?.ok) {
    renderStatus({ ok: false, message: state?.message || "Failed to load extension state." });
    return null;
  }
  fillSettings(state.settings || {});
  renderContext(state.context || {});
  renderStatus(state.lastStatus || null);
  return state;
}

async function saveSettings() {
  const response = await sendMessage({ type: "ft.saveSettings", settings: collectSettings() });
  if (!response?.ok) {
    renderStatus({ ok: false, message: response?.message || "Could not save settings." });
    return false;
  }
  fillSettings(response.settings || {});
  renderStatus({ ok: true, message: "Settings saved.", details: response.settings || {} });
  await loadState();
  return true;
}

async function captureNow(trigger = "popup") {
  const activeTabIsApp = popupContext.activeTabIsApp === true;
  const sourceUrlOverride = activeTabIsApp ? elements.manualUrl.value.trim() : "";

  if (activeTabIsApp && !sourceUrlOverride) {
    renderStatus({ ok: false, message: "Paste a product URL first." });
    elements.manualUrl.focus();
    return;
  }

  // Always persist latest settings (especially token) before capture.
  const saved = await saveSettings();
  if (!saved) return;

  elements.captureBtn.disabled = true;
  renderStatus({ ok: true, message: activeTabIsApp ? "Capturing URL via scraper..." : "Capturing current tab..." });
  const response = await sendMessage({
    type: "ft.capture",
    trigger,
    sourceUrlOverride: sourceUrlOverride || undefined,
  });
  elements.captureBtn.disabled = false;
  if (!response?.ok) {
    renderStatus(response?.status || { ok: false, message: response?.message || "Capture failed." });
    return;
  }
  if (activeTabIsApp) elements.manualUrl.value = "";
  renderStatus(response.status || null);
}

elements.saveBtn.addEventListener("click", () => {
  void saveSettings();
});

elements.captureBtn.addEventListener("click", () => {
  void captureNow("popup_button");
});

elements.manualUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void captureNow("popup_enter");
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const state = await loadState();
  if (!state?.ok) return;
  if (state.settings?.autoCaptureOnPopupOpen !== false && !(state.context?.activeTabIsApp === true)) {
    void captureNow("popup_auto");
  }
});
