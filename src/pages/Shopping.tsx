import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/data/DataContext";
import { inferItemKind, type ItemStatus, type RoomId } from "@/lib/domain";
import { formatMoneyUSD, parseNumberOrNull } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { storeKey } from "@/lib/storePricing";

const RECENT_ROOMS_KEY = "ft_recentRooms";

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

type ExtractResponse = {
  ok: boolean;
  data?: {
    name?: string | null;
    price?: number | null;
    description?: string | null;
    imageUrl?: string | null;
    brand?: string | null;
    sourceUrl?: string | null;
  };
  message?: string;
};

type StandaloneDraft = {
  name: string;
  room: RoomId;
  status: ItemStatus;
  price: number | null;
  qty: number;
  store: string | null;
  description: string | null;
  link: string | null;
  brand: string | null;
  imageUrl: string | null;
};

export default function Shopping() {
  const nav = useNavigate();
  const { toast } = useToast();
  const { orderedRooms, roomNameById, items, orderedStores, createItem } = useData();

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);
  const validRoomIds = useMemo(() => new Set(orderedRoomIds), [orderedRoomIds]);
  const validStoreKeys = useMemo(() => new Set(orderedStores.map((s) => storeKey(s.name))), [orderedStores]);

  const captureNameRef = useRef<HTMLInputElement | null>(null);
  const quickNameRef = useRef<HTMLInputElement | null>(null);

  const [productUrl, setProductUrl] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);

  const [captureName, setCaptureName] = useState("");
  const [captureRoom, setCaptureRoom] = useState<RoomId>(() => loadRecents(RECENT_ROOMS_KEY)[0] || "Living");
  const [captureStatus, setCaptureStatus] = useState<ItemStatus>("Shortlist");
  const [capturePrice, setCapturePrice] = useState("");
  const [captureQty, setCaptureQty] = useState("1");
  const [captureStore, setCaptureStore] = useState("");
  const [captureBrand, setCaptureBrand] = useState("");
  const [captureDescription, setCaptureDescription] = useState("");
  const [captureImageUrl, setCaptureImageUrl] = useState("");

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

  useEffect(() => {
    if (!orderedStores.length) {
      setCaptureStore("");
      return;
    }
    setCaptureStore((cur) => (validStoreKeys.has(storeKey(cur)) ? cur : ""));
  }, [orderedStores, validStoreKeys]);

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
    const specs: Record<string, string | number | boolean | null> = {};
    if (draft.brand) specs.brand = draft.brand;
    if (draft.imageUrl) specs.imageUrl = draft.imageUrl;

    return await createItem({
      name: draft.name,
      room: draft.room,
      kind: "standalone",
      status: draft.status,
      price: draft.price,
      store: draft.store,
      notes: draft.description,
      qty: draft.qty,
      link: draft.link,
      specs: Object.keys(specs).length ? specs : null,
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

      const extractedName = String(json.data.name || "").trim() || "New Item";
      const extractedPrice = typeof json.data.price === "number" && Number.isFinite(json.data.price) ? json.data.price : null;
      const extractedBrand = String(json.data.brand || "").trim();
      const extractedDescription = String(json.data.description || "").trim();
      const extractedImage = String(json.data.imageUrl || "").trim();
      const extractedUrl = String(json.data.sourceUrl || target).trim();

      setCaptureName(extractedName);
      setCapturePrice(extractedPrice === null ? "" : String(extractedPrice));
      setCaptureBrand(extractedBrand);
      setCaptureDescription(extractedDescription);
      setCaptureImageUrl(extractedImage);
      setProductUrl(extractedUrl);

      toast({
        title: "Product extracted",
        description: "Review any field and add when ready.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Extraction failed",
        description: err?.message || "Could not extract product details from that URL.",
      });
    } finally {
      setIsExtracting(false);
    }
  }

  async function onAddCaptured(openAfter = false) {
    const trimmedName = captureName.trim();
    if (!trimmedName) {
      captureNameRef.current?.focus();
      return;
    }

    const parsedPrice = parseNumberOrNull(capturePrice);
    const parsedQty = Math.max(1, Math.round(parseNumberOrNull(captureQty) ?? 1));
    const trimmedStore = captureStore.trim() || null;
    const trimmedBrand = captureBrand.trim() || null;
    const trimmedImageUrl = captureImageUrl.trim() || null;
    const trimmedDescription = captureDescription.trim() || null;
    const trimmedUrl = productUrl.trim() || null;

    const id = await createStandaloneFromDraft({
      name: trimmedName,
      room: captureRoom,
      status: captureStatus,
      price: parsedPrice,
      qty: parsedQty,
      store: trimmedStore,
      description: trimmedDescription,
      link: trimmedUrl,
      brand: trimmedBrand,
      imageUrl: trimmedImageUrl,
    });

    rememberRoom(captureRoom);

    setProductUrl("");
    setCaptureName("");
    setCapturePrice("");
    setCaptureQty("1");
    setCaptureStore("");
    setCaptureBrand("");
    setCaptureDescription("");
    setCaptureImageUrl("");
    captureNameRef.current?.focus();

    toast({
      title: "Item added",
      description: `${trimmedName} \u00b7 ${roomNameById.get(captureRoom) || captureRoom} \u00b7 ${captureStatus}`,
    });

    if (openAfter) nav(`/items/${id}`);
  }

  async function onQuickAdd() {
    const trimmedName = quickName.trim();
    if (!trimmedName) {
      quickNameRef.current?.focus();
      return;
    }

    const trimmedDescription = quickDescription.trim() || null;
    await createStandaloneFromDraft({
      name: trimmedName,
      room: quickRoom,
      status: "Shortlist",
      price: null,
      qty: 1,
      store: null,
      description: trimmedDescription,
      link: null,
      brand: null,
      imageUrl: null,
    });

    rememberRoom(quickRoom);
    setQuickName("");
    setQuickDescription("");
    quickNameRef.current?.focus();

    toast({
      title: "Item added",
      description: `${trimmedName} \u00b7 ${roomNameById.get(quickRoom) || quickRoom}`,
    });
  }

  return (
    <div className="space-y-5">
      <Card className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <div className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-semibold text-foreground">Capture From URL</h2>
            <p className="text-xs text-muted-foreground">Extract first, edit fast, then add.</p>
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

          <div className="space-y-2">
            <label htmlFor="capture_name" className="text-xs font-semibold uppercase tracking-widest text-primary">
              Title
            </label>
            <Input
              id="capture_name"
              ref={captureNameRef}
              value={captureName}
              onChange={(e) => setCaptureName(e.target.value)}
              placeholder="e.g. Queen mattress protector"
              className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <div className="space-y-1.5">
              <label htmlFor="capture_price" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="capture_price"
                  inputMode="decimal"
                  value={capturePrice}
                  onChange={(e) => setCapturePrice(e.target.value)}
                  placeholder="0"
                  className="h-12 rounded-xl pl-7 text-base focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="capture_qty" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quantity</label>
              <Input
                id="capture_qty"
                inputMode="numeric"
                value={captureQty}
                onChange={(e) => setCaptureQty(e.target.value)}
                placeholder="1"
                className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["Idea", "Shortlist", "Selected"] as ItemStatus[]).map((s) => (
                <StatusBadge key={s} status={s} selected={captureStatus === s} onClick={() => setCaptureStatus(s)} />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="capture_store" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Store (optional)</label>
            <select
              id="capture_store"
              value={captureStore}
              onChange={(e) => setCaptureStore(e.target.value)}
              className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">(none)</option>
              {orderedStores.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="capture_brand" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Brand</label>
              <Input
                id="capture_brand"
                value={captureBrand}
                onChange={(e) => setCaptureBrand(e.target.value)}
                placeholder="e.g. Sealy"
                className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="capture_image_url" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Image URL</label>
              <Input
                id="capture_image_url"
                value={captureImageUrl}
                onChange={(e) => setCaptureImageUrl(e.target.value)}
                placeholder="https://..."
                className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="capture_description" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</label>
            <Textarea
              id="capture_description"
              value={captureDescription}
              onChange={(e) => setCaptureDescription(e.target.value)}
              placeholder="Material, size, color, delivery notes..."
              className="min-h-[88px] resize-none rounded-xl text-base focus:ring-2 focus:ring-ring"
            />
          </div>

          {recentRooms.length ? (
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent rooms</label>
              <div className="flex flex-wrap gap-2">
                {recentRooms.slice(0, 6).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setCaptureRoom(r as RoomId);
                      setQuickRoom(r as RoomId);
                    }}
                    className="rounded-full border border-border bg-background px-3 py-2 text-sm transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95"
                  >
                    {roomNameById.get(r as RoomId) || r}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button className="h-12 rounded-xl text-base shadow-sm transition-all duration-150 hover:opacity-90 active:scale-[0.98]" onClick={() => void onAddCaptured(false)}>
              Add Item
            </Button>
            <Button variant="secondary" className="h-12 rounded-xl text-base transition-all duration-150 active:scale-[0.98]" onClick={() => void onAddCaptured(true)}>
              Add & Edit
            </Button>
          </div>
        </div>
      </Card>

      <Card className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
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

      <Card className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
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
