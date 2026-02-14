import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/data/DataContext";
import { inferItemKind, type RoomId } from "@/lib/domain";
import { formatMoneyUSD, parseNumberOrNull } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

const RECENT_ROOMS_KEY = "ft_recentRooms";

type CaptureSpec = { key: string; value: string };

type ExtractResponse = {
  ok: boolean;
  data?: {
    name?: string | null;
    price?: number | null;
    description?: string | null;
    imageUrl?: string | null;
    brand?: string | null;
    sourceUrl?: string | null;
    sourceDomain?: string | null;
    currency?: string | null;
    originalPrice?: number | null;
    discountPercent?: number | null;
    dimensionsText?: string | null;
    variantText?: string | null;
    specs?: CaptureSpec[] | null;
    raw?: unknown;
    captureMethod?: "fallback_scraper" | "browser";
  };
  message?: string;
};

type StandaloneDraft = {
  name: string;
  room: RoomId;
  price: number | null;
  description: string | null;
  link: string | null;
  brand: string | null;
  imageUrl: string | null;
  currency: string | null;
  sourceDomain: string | null;
  originalPrice: number | null;
  discountPercent: number | null;
  dimensionsText: string | null;
  variantText: string | null;
  specs: CaptureSpec[];
  captureMethod: "fallback_scraper" | "browser" | "manual";
};

function loadRecents(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).filter(Boolean);
  } catch {
    return [];
  }
}

function pushRecent(key: string, value: string, max = 6) {
  const v = value.trim();
  if (!v) return;
  const next = [v, ...loadRecents(key).filter((x) => x !== v)].slice(0, max);
  localStorage.setItem(key, JSON.stringify(next));
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceDomainFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export default function Shopping() {
  const nav = useNavigate();
  const { toast } = useToast();
  const { orderedRooms, roomNameById, items, createItem, reorderItems } = useData();

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);
  const validRoomIds = useMemo(() => new Set(orderedRoomIds), [orderedRoomIds]);

  const quickNameRef = useRef<HTMLInputElement | null>(null);

  const [productUrl, setProductUrl] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);

  const [captureName, setCaptureName] = useState("");
  const [captureRoom, setCaptureRoom] = useState<RoomId>(() => loadRecents(RECENT_ROOMS_KEY)[0] || "Living");
  const [capturePrice, setCapturePrice] = useState("");
  const [captureBrand, setCaptureBrand] = useState("");
  const [captureDescription, setCaptureDescription] = useState("");
  const [captureImageUrl, setCaptureImageUrl] = useState("");
  const [captureCurrency, setCaptureCurrency] = useState("");
  const [captureOriginalPrice, setCaptureOriginalPrice] = useState("");
  const [captureDiscountPercent, setCaptureDiscountPercent] = useState("");
  const [captureDimensionsText, setCaptureDimensionsText] = useState("");
  const [captureVariantText, setCaptureVariantText] = useState("");
  const [captureSourceDomain, setCaptureSourceDomain] = useState("");
  const [captureSpecs, setCaptureSpecs] = useState<CaptureSpec[]>([]);
  const [captureMethod, setCaptureMethod] = useState<"fallback_scraper" | "browser" | "manual">("manual");

  const [quickName, setQuickName] = useState("");
  const [quickRoom, setQuickRoom] = useState<RoomId>(() => loadRecents(RECENT_ROOMS_KEY)[0] || "Living");
  const [quickDescription, setQuickDescription] = useState("");

  const [recentRooms, setRecentRooms] = useState<string[]>(() => loadRecents(RECENT_ROOMS_KEY));

  useEffect(() => {
    if (!orderedRoomIds.length) return;
    setCaptureRoom((cur) => (validRoomIds.has(cur) ? cur : orderedRoomIds[0]));
    setQuickRoom((cur) => (validRoomIds.has(cur) ? cur : orderedRoomIds[0]));
    setRecentRooms(loadRecents(RECENT_ROOMS_KEY).filter((r) => validRoomIds.has(r)));
  }, [orderedRoomIds, validRoomIds]);

  const recentItems = useMemo(() => {
    return [...items]
      .filter((i) => i.syncState !== "deleted")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
  }, [items]);

  function rememberRoom(room: RoomId) {
    pushRecent(RECENT_ROOMS_KEY, room);
    setRecentRooms(loadRecents(RECENT_ROOMS_KEY).filter((r) => validRoomIds.has(r)));
  }

  async function createStandaloneFromDraft(draft: StandaloneDraft) {
    const specsMap: Record<string, string | number | boolean | null> = {};

    for (const entry of draft.specs) {
      const key = normalizeText(entry.key);
      const value = normalizeText(entry.value);
      if (!key || !value) continue;
      if (specsMap[key] == null) specsMap[key] = value;
    }

    if (draft.brand) specsMap.brand = draft.brand;
    if (draft.imageUrl) specsMap.imageUrl = draft.imageUrl;
    if (draft.currency) specsMap.currency = draft.currency;
    if (draft.sourceDomain) specsMap.sourceDomain = draft.sourceDomain;
    if (draft.originalPrice !== null) specsMap.originalPrice = draft.originalPrice;
    if (draft.discountPercent !== null) specsMap.discountPercent = draft.discountPercent;
    if (draft.dimensionsText) specsMap.dimensionsText = draft.dimensionsText;
    if (draft.variantText) specsMap.variantText = draft.variantText;
    specsMap.captureMethod = draft.captureMethod;

    return await createItem({
      name: draft.name,
      room: draft.room,
      kind: "standalone",
      status: "Shortlist",
      price: draft.price,
      store: null,
      notes: draft.description,
      qty: 1,
      link: draft.link,
      specs: Object.keys(specsMap).length ? specsMap : null,
      category: "Other",
    });
  }

  async function onExtract() {
    const target = productUrl.trim();
    if (!target) {
      toast({
        variant: "destructive",
        title: "Missing URL",
        description: "Paste a product URL first, then click Extract.",
      });
      return;
    }

    setIsExtracting(true);
    try {
      const res = await fetch("/api/scrape/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const json = (await res.json().catch(() => null)) as ExtractResponse | null;
      if (!res.ok || !json?.ok || !json?.data) {
        throw new Error(json?.message || `Extraction failed (${res.status})`);
      }

      const extractedUrl = normalizeText(json.data.sourceUrl || target);
      const extractedName = normalizeText(json.data.name) || "New Item";
      const extractedPrice = typeof json.data.price === "number" && Number.isFinite(json.data.price) ? json.data.price : null;
      const extractedBrand = normalizeText(json.data.brand);
      const extractedDescription = normalizeText(json.data.description);
      const extractedImage = normalizeText(json.data.imageUrl);
      const extractedCurrency = normalizeText(json.data.currency);
      const extractedOriginalPrice =
        typeof json.data.originalPrice === "number" && Number.isFinite(json.data.originalPrice) ? json.data.originalPrice : null;
      const extractedDiscount =
        typeof json.data.discountPercent === "number" && Number.isFinite(json.data.discountPercent)
          ? json.data.discountPercent
          : null;

      setCaptureName(extractedName);
      setCapturePrice(extractedPrice === null ? "" : String(extractedPrice));
      setCaptureBrand(extractedBrand);
      setCaptureDescription(extractedDescription);
      setCaptureImageUrl(extractedImage);
      setCaptureCurrency(extractedCurrency);
      setCaptureOriginalPrice(extractedOriginalPrice === null ? "" : String(extractedOriginalPrice));
      setCaptureDiscountPercent(extractedDiscount === null ? "" : String(extractedDiscount));
      setCaptureDimensionsText(normalizeText(json.data.dimensionsText));
      setCaptureVariantText(normalizeText(json.data.variantText));
      setCaptureSourceDomain(normalizeText(json.data.sourceDomain) || sourceDomainFromUrl(extractedUrl));
      setCaptureSpecs(Array.isArray(json.data.specs) ? json.data.specs.filter((s) => normalizeText(s?.key) && normalizeText(s?.value)) : []);
      setCaptureMethod(json.data.captureMethod === "browser" ? "browser" : "fallback_scraper");
      setProductUrl(extractedUrl || target);

      toast({
        title: "Product extracted",
        description: "Extraction complete. Select room and add item.",
      });
    } catch (err: any) {
      if (!captureName.trim()) setCaptureName("New Item");
      setProductUrl(target);
      toast({
        variant: "destructive",
        title: "Extraction failed",
        description: err?.message || "Could not extract product details from that URL. You can continue manually.",
      });
    } finally {
      setIsExtracting(false);
    }
  }

  async function onAddCaptured(openAfter = false) {
    const trimmedName = captureName.trim() || "New Item";

    const trimmedUrl = productUrl.trim() || null;
    const sourceDomain = normalizeText(captureSourceDomain) || sourceDomainFromUrl(trimmedUrl || "");

    const id = await createStandaloneFromDraft({
      name: trimmedName,
      room: captureRoom,
      price: parseNumberOrNull(capturePrice),
      description: captureDescription.trim() || null,
      link: trimmedUrl,
      brand: captureBrand.trim() || null,
      imageUrl: captureImageUrl.trim() || null,
      currency: captureCurrency.trim() || null,
      sourceDomain: sourceDomain || null,
      originalPrice: parseNumberOrNull(captureOriginalPrice),
      discountPercent: parseNumberOrNull(captureDiscountPercent),
      dimensionsText: captureDimensionsText.trim() || null,
      variantText: captureVariantText.trim() || null,
      specs: captureSpecs,
      captureMethod: captureMethod,
    });

    // Keep URL captures at the top of the room list for quick drag/reorder to placeholders.
    const roomItemIds = items
      .filter((it) => it.syncState !== "deleted" && it.room === captureRoom)
      .map((it) => it.id);
    await reorderItems(captureRoom, [id, ...roomItemIds]);

    rememberRoom(captureRoom);

    setProductUrl("");
    setCaptureName("");
    setCapturePrice("");
    setCaptureBrand("");
    setCaptureDescription("");
    setCaptureImageUrl("");
    setCaptureCurrency("");
    setCaptureOriginalPrice("");
    setCaptureDiscountPercent("");
    setCaptureDimensionsText("");
    setCaptureVariantText("");
    setCaptureSourceDomain("");
    setCaptureSpecs([]);
    setCaptureMethod("manual");
    toast({
      title: "Item added",
      description: `${trimmedName} · ${roomNameById.get(captureRoom) || captureRoom}`,
    });

    if (openAfter) nav(`/items/${id}`);
  }

  async function onQuickAdd() {
    const trimmedName = quickName.trim();
    if (!trimmedName) {
      quickNameRef.current?.focus();
      return;
    }

    await createStandaloneFromDraft({
      name: trimmedName,
      room: quickRoom,
      price: null,
      description: quickDescription.trim() || null,
      link: null,
      brand: null,
      imageUrl: null,
      currency: null,
      sourceDomain: null,
      originalPrice: null,
      discountPercent: null,
      dimensionsText: null,
      variantText: null,
      specs: [],
      captureMethod: "manual",
    });

    rememberRoom(quickRoom);
    setQuickName("");
    setQuickDescription("");
    quickNameRef.current?.focus();

    toast({
      title: "Item added",
      description: `${trimmedName} · ${roomNameById.get(quickRoom) || quickRoom}`,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="order-2 glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <div className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-semibold text-foreground">Quick Add</h2>
            <p className="text-xs text-muted-foreground">Manual shortcut: title + room (+ optional description).</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="quick_name" className="text-xs font-semibold uppercase tracking-widest text-primary">
              Title
            </label>
            <Input
              id="quick_name"
              ref={quickNameRef}
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
              placeholder="e.g. TV stand placeholder buy option"
              className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="quick_room" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Room</label>
            <select
              id="quick_room"
              value={quickRoom}
              onChange={(e) => setQuickRoom(e.target.value as RoomId)}
              className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {orderedRoomIds.map((r) => (
                <option key={r} value={r}>
                  {roomNameById.get(r) || r}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="quick_description" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Description (optional)
            </label>
            <Textarea
              id="quick_description"
              value={quickDescription}
              onChange={(e) => setQuickDescription(e.target.value)}
              placeholder="Optional notes..."
              className="min-h-[88px] resize-none rounded-xl text-base focus:ring-2 focus:ring-ring"
            />
          </div>

          <Button className="h-12 w-full rounded-xl text-base shadow-sm transition-all duration-150 hover:opacity-90 active:scale-[0.98]" onClick={() => void onQuickAdd()}>
            Add Item
          </Button>
        </div>
      </Card>

      <Card className="order-1 glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <div className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-semibold text-foreground">Capture From URL</h2>
            <p className="text-xs text-muted-foreground">Paste URL, choose room, then add.</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="shop_product_url" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Product URL
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="shop_product_url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://www.amazon.com/... or any product page"
                className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="secondary"
                className="h-12 rounded-xl px-5"
                onClick={() => void onExtract()}
                disabled={isExtracting}
              >
                {isExtracting ? "Extracting..." : "Extract"}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="capture_room" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Room</label>
            <select
              id="capture_room"
              value={captureRoom}
              onChange={(e) => setCaptureRoom(e.target.value as RoomId)}
              className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {orderedRoomIds.map((r) => (
                <option key={r} value={r}>
                  {roomNameById.get(r) || r}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2">
            <Button className="h-12 w-full rounded-xl text-base shadow-sm transition-all duration-150 hover:opacity-90 active:scale-[0.98]" onClick={() => void onAddCaptured(false)}>
              Add Item
            </Button>
          </div>
        </div>
      </Card>

      <Card className="order-3 glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold text-foreground">Recently Added</h2>
            <p className="text-xs text-muted-foreground">Tap to view details</p>
          </div>
          <Button variant="ghost" className="rounded-xl text-primary hover:bg-primary/10" onClick={() => nav("/items")}>
            View All
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {recentItems.length ? (
            recentItems.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => nav(`/items/${it.id}`)}
                className="group w-full rounded-2xl border border-border bg-card p-4 text-left transition-all duration-200 hover:shadow-md active:scale-[0.98]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-body text-base font-semibold text-card-foreground">{it.name}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {roomNameById.get(it.room) || it.room}
                      {inferItemKind(it) === "placeholder" ? " · placeholder" : ""}
                      {it.store ? ` · ${it.store}` : ""}
                      {it.price ? ` · ${formatMoneyUSD(it.price)}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <StatusBadge status={it.status} size="sm" />
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="text-sm text-muted-foreground">No items yet. Add your first one above.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
