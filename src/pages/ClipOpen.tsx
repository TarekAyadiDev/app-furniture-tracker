import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useData } from "@/data/DataContext";
import { collectCaptureImageUrls, importCaptureImages } from "@/lib/captureImages";
import type { RoomId } from "@/lib/domain";
import { parseNumberOrNull } from "@/lib/format";

type ClipSpec = { key: string; value: string };

type IncomingClipPayload = {
  sourceUrl?: string | null;
  sourceDomain?: string | null;
  name?: string | null;
  price?: number | string | null;
  currency?: string | null;
  originalPrice?: number | string | null;
  discountPercent?: number | string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  brand?: string | null;
  description?: string | null;
  dimensionsText?: string | null;
  variantText?: string | null;
  specs?: ClipSpec[] | null;
  captureMethod?: "browser" | "fallback_scraper";
  room?: string | null;
};

function normalizeText(input: unknown): string {
  return String(input ?? "").replace(/\s+/g, " ").trim();
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

function normalizeDomain(input: unknown, sourceUrl: string | null): string | null {
  const raw = normalizeText(input).replace(/^www\./i, "");
  if (raw) return raw;
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function decodePayloadParam(encoded: string): IncomingClipPayload | null {
  const raw = normalizeText(encoded);
  if (!raw) return null;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "===".slice((normalized.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as IncomingClipPayload) : null;
  } catch {
    return null;
  }
}

export default function ClipOpen() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const didRunRef = useRef(false);
  const [state, setState] = useState<"loading" | "error">("loading");
  const [error, setError] = useState("");

  const { ready, items, orderedRooms, createItem, reorderItems } = useData();
  const roomById = useMemo(() => new Set(orderedRooms.map((r) => r.id)), [orderedRooms]);

  useEffect(() => {
    if (!id || !ready || didRunRef.current) return;
    didRunRef.current = true;

    if (id !== "new") {
      const exists = items.some((it) => it.syncState !== "deleted" && it.id === id);
      if (exists) {
        nav(`/items/${id}`, { replace: true });
      } else {
        setState("error");
        setError("Item not found locally. Airtable auto-pull is disabled to protect local ordering.");
      }
      return;
    }

    const encodedPayload = searchParams.get("payload");
    const payload = encodedPayload ? decodePayloadParam(encodedPayload) : null;
    if (!payload) {
      setState("error");
      setError("Missing or invalid clip payload.");
      return;
    }

    const sourceUrl = normalizeUrl(payload.sourceUrl);
    const name = normalizeText(payload.name) || "New Item";
    const roomCandidate = normalizeText(payload.room);
    const room = (roomCandidate && roomById.has(roomCandidate as RoomId) ? roomCandidate : orderedRooms[0]?.id || "Living") as RoomId;

    const sourceDomain = normalizeDomain(payload.sourceDomain, sourceUrl);
    const brand = normalizeText(payload.brand) || null;
    const imageUrl = normalizeUrl(payload.imageUrl);
    const imageUrls = collectCaptureImageUrls({
      imageUrl,
      imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : [],
    });
    const currency = normalizeText(payload.currency) || null;
    const dimensionsText = normalizeText(payload.dimensionsText) || null;
    const variantText = normalizeText(payload.variantText) || null;
    const captureMethod = payload.captureMethod === "fallback_scraper" ? "fallback_scraper" : "browser";
    const specsMap: Record<string, string | number | boolean | null> = {};

    if (Array.isArray(payload.specs)) {
      for (const entry of payload.specs) {
        const key = normalizeText(entry?.key).slice(0, 80);
        const value = normalizeText(entry?.value).slice(0, 500);
        if (!key || !value) continue;
        if (specsMap[key] == null) specsMap[key] = value;
      }
    }

    if (brand) specsMap.brand = brand;
    if (imageUrl) specsMap.imageUrl = imageUrl;
    if (currency) specsMap.currency = currency;
    if (sourceDomain) specsMap.sourceDomain = sourceDomain;

    const originalPrice = parseNumberOrNull(String(payload.originalPrice ?? ""));
    const discountPercent = parseNumberOrNull(String(payload.discountPercent ?? ""));
    if (originalPrice !== null) specsMap.originalPrice = originalPrice;
    if (discountPercent !== null) specsMap.discountPercent = discountPercent;
    if (dimensionsText) specsMap.dimensionsText = dimensionsText;
    if (variantText) specsMap.variantText = variantText;
    specsMap.captureMethod = captureMethod;
    specsMap.captureSource = "extension";

    const existingRoomItemIds = items
      .filter((it) => it.syncState !== "deleted" && it.room === room)
      .map((it) => it.id);

    void createItem({
      name,
      room,
      kind: "standalone",
      status: "Shortlist",
      price: parseNumberOrNull(String(payload.price ?? "")),
      store: null,
      notes: normalizeText(payload.description) || null,
      qty: 1,
      link: sourceUrl,
      specs: Object.keys(specsMap).length ? specsMap : null,
      category: "Other",
    })
      .then(async (newId) => {
        await importCaptureImages({
          parentType: "item",
          parentId: newId,
          imageUrls,
          limit: 6,
        }).catch(() => null);
        await reorderItems(room, [newId, ...existingRoomItemIds]);
        nav(`/items/${newId}`, { replace: true });
      })
      .catch((err: any) => {
        setState("error");
        setError(err?.message || "Could not create clipped item locally.");
      });
  }, [id, ready, items, orderedRooms, roomById, searchParams, createItem, reorderItems, nav]);

  if (state === "loading") {
    return (
      <Card className="p-4">
        <div className="space-y-2">
          <div className="text-base font-semibold">Opening clipped item...</div>
          <div className="text-sm text-muted-foreground">Applying capture to your local workspace.</div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="space-y-2">
        <div className="text-base font-semibold">Could not open clipped item</div>
        <div className="text-sm text-muted-foreground">{error || "Please try clipping again."}</div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => nav("/items")}>
            Go to Items
          </Button>
          <Button variant="ghost" onClick={() => nav("/settings")}>
            Open Settings
          </Button>
        </div>
      </div>
    </Card>
  );
}
