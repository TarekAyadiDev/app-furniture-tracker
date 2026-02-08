export type ShareResult = { method: "share" | "clipboard" | "none" };

export async function shareData({
  title,
  text,
  url,
}: {
  title: string;
  text: string;
  url?: string;
}): Promise<ShareResult> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    await navigator.share({ title, text, url });
    return { method: "share" };
  }

  const payload = [text, url].filter(Boolean).join("\n");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(payload);
    return { method: "clipboard" };
  }

  return { method: "none" };
}
