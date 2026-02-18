import { addAttachmentFromUrl, addAttachmentLink, listAttachments, type AttachmentParentType } from "@/storage/attachments";

export type CaptureImageImportResult = {
  attempted: number;
  added: number;
  linked: number;
  uploaded: number;
  skipped: number;
  failed: number;
};

function normalizeImageUrl(input: unknown): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function canonicalizeUrl(input: string): string {
  try {
    const parsed = new URL(input);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return input;
  }
}

function inferName(url: string, index: number): string {
  try {
    const parsed = new URL(url);
    const part = parsed.pathname.split("/").filter(Boolean).pop() || "";
    const decoded = decodeURIComponent(part).trim();
    if (decoded) return decoded;
  } catch {
    // fallback below
  }
  return `capture-photo-${index + 1}`;
}

export function collectCaptureImageUrls(
  input: {
    imageUrl?: unknown;
    imageUrls?: unknown;
  },
  limit = 6,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (value: unknown) => {
    const normalized = normalizeImageUrl(value);
    if (!normalized) return;
    const key = canonicalizeUrl(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };

  push(input.imageUrl);
  if (Array.isArray(input.imageUrls)) {
    for (const url of input.imageUrls) push(url);
  }

  return out.slice(0, Math.max(1, limit));
}

export async function importCaptureImages(params: {
  parentType: AttachmentParentType;
  parentId: string;
  imageUrls: string[];
  limit?: number;
}): Promise<CaptureImageImportResult> {
  const limit = Math.max(1, params.limit ?? 6);
  const targetUrls = collectCaptureImageUrls(
    {
      imageUrl: null,
      imageUrls: params.imageUrls,
    },
    limit,
  );

  const existing = await listAttachments(params.parentType, params.parentId);
  const existingUrlKeys = new Set(
    existing
      .map((att) => normalizeImageUrl(att.sourceUrl || ""))
      .filter((url): url is string => Boolean(url))
      .map((url) => canonicalizeUrl(url)),
  );

  const result: CaptureImageImportResult = {
    attempted: 0,
    added: 0,
    linked: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
  };

  for (let i = 0; i < targetUrls.length; i += 1) {
    const url = targetUrls[i];
    const key = canonicalizeUrl(url);
    if (existingUrlKeys.has(key)) {
      result.skipped += 1;
      continue;
    }

    result.attempted += 1;
    const name = inferName(url, i);

    try {
      await addAttachmentLink(params.parentType, params.parentId, url, { name });
      existingUrlKeys.add(key);
      result.added += 1;
      result.linked += 1;
      continue;
    } catch {
      // Fall through to S3 capture upload path.
    }

    try {
      await addAttachmentFromUrl(params.parentType, params.parentId, url);
      existingUrlKeys.add(key);
      result.added += 1;
      result.uploaded += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}

