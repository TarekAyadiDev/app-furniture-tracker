const EVENT_NAME = "furnishing-db-changed";
const CHANNEL_NAME = "furnishing-db";

const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;

export function notifyDbChanged() {
  try {
    bc?.postMessage({ t: Date.now() });
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function subscribeDbChanges(cb: () => void) {
  const onEvent = () => cb();
  window.addEventListener(EVENT_NAME, onEvent);

  const onMsg = () => cb();
  try {
    bc?.addEventListener("message", onMsg);
  } catch {
    // ignore
  }

  return () => {
    window.removeEventListener(EVENT_NAME, onEvent);
    try {
      bc?.removeEventListener("message", onMsg);
    } catch {
      // ignore
    }
  };
}

