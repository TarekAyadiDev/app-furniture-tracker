export function newId(prefix = "") {
  try {
    // Modern browsers.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const id = crypto.randomUUID();
    return prefix ? `${prefix}_${id}` : id;
  } catch {
    // Fallback: not cryptographically strong, but good enough for local ids.
    const rnd = Math.random().toString(16).slice(2);
    const t = Date.now().toString(16);
    const id = `${t}-${rnd}`;
    return prefix ? `${prefix}_${id}` : id;
  }
}

