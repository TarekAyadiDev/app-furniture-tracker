import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/data/DataContext";
import { inferItemKind, type ItemKind, type ItemStatus, type RoomId } from "@/lib/domain";
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

export default function Shopping() {
  const nav = useNavigate();
  const { toast } = useToast();
  const { orderedRooms, roomNameById, items, orderedStores, createItem } = useData();

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);
  const validRoomIds = useMemo(() => new Set(orderedRoomIds), [orderedRoomIds]);
  const validStoreKeys = useMemo(() => new Set(orderedStores.map((s) => storeKey(s.name))), [orderedStores]);

  const nameRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [room, setRoom] = useState<RoomId>(() => loadRecents(RECENT_ROOMS_KEY)[0] || "Living");
  const [kind, setKind] = useState<ItemKind>("placeholder");
  const [status, setStatus] = useState<ItemStatus>("Shortlist");
  const [price, setPrice] = useState<string>("");
  const [qty, setQty] = useState<string>("1");
  const [store, setStore] = useState<string>("");
  const [brand, setBrand] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [isExtracting, setIsExtracting] = useState(false);

  const [recentRooms, setRecentRooms] = useState<string[]>(() => loadRecents(RECENT_ROOMS_KEY));

  useEffect(() => {
    if (!orderedRoomIds.length) return;
    setRoom((cur) => (validRoomIds.has(cur) ? cur : orderedRoomIds[0]));
    setRecentRooms(loadRecents(RECENT_ROOMS_KEY).filter((r) => validRoomIds.has(r)));
  }, [orderedRoomIds, validRoomIds]);

  useEffect(() => {
    if (!orderedStores.length) {
      setStore("");
      return;
    }
    setStore((cur) => (validStoreKeys.has(storeKey(cur)) ? cur : ""));
  }, [orderedStores, validStoreKeys]);

  const recentItems = useMemo(() => {
    return [...items]
      .filter((i) => i.syncState !== "deleted")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
  }, [items]);

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

      setKind("standalone");
      setName(extractedName);
      setPrice(extractedPrice === null ? "" : String(extractedPrice));
      setBrand(extractedBrand);
      setDescription(extractedDescription);
      setImageUrl(extractedImage);
      setProductUrl(extractedUrl);

      toast({
        title: "Product extracted",
        description: "Fields were pre-filled. You can edit anything before saving.",
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

  async function onAdd(openAfter = false) {
    const trimmed = name.trim();
    if (!trimmed) {
      nameRef.current?.focus();
      return;
    }

    const isPlaceholder = kind === "placeholder";
    const parsedPrice = parseNumberOrNull(price);
    const parsedQty = Math.max(1, Math.round(parseNumberOrNull(qty) ?? 1));
    const trimmedBrand = brand.trim();
    const trimmedImageUrl = imageUrl.trim();
    const specs: Record<string, string | number | boolean | null> = {};
    if (trimmedBrand) specs.brand = trimmedBrand;
    if (trimmedImageUrl) specs.imageUrl = trimmedImageUrl;

    const id = await createItem({
      name: trimmed,
      room,
      kind,
      status,
      price: isPlaceholder ? null : parsedPrice,
      store: isPlaceholder ? null : store.trim() || null,
      notes: description.trim() || null,
      qty: parsedQty,
      link: productUrl.trim() || null,
      specs: Object.keys(specs).length ? specs : null,
      category: "Other",
    });

    pushRecent(RECENT_ROOMS_KEY, room);
    setRecentRooms(loadRecents(RECENT_ROOMS_KEY).filter((r) => validRoomIds.has(r)));

    setName("");
    setProductUrl("");
    setPrice("");
    setQty("1");
    setBrand("");
    setDescription("");
    setImageUrl("");
    nameRef.current?.focus();

    toast({
      title: kind === "placeholder" ? "Placeholder added" : "Item added",
      description: `${trimmed} \u00b7 ${roomNameById.get(room) || room} \u00b7 ${status}`,
    });

    if (openAfter) nav(`/items/${id}`);
  }

  return (
    <div className="space-y-5">
      <Card className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="shop_product_url" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Product URL
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="shop_product_url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://www.amazon.com/... or https://www.wayfair.com/..."
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
            <div className="text-xs text-muted-foreground">
              Extracts product details using ScrapingBee. If it fails, you can complete the fields manually.
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="shop_name" className="text-xs font-semibold uppercase tracking-widest text-primary">
              Add New Item
            </label>
            <Input
              id="shop_name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Queen mattress protector"
              className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Type</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setKind("placeholder")}
                className={[
                  "rounded-full border px-3 py-2 text-sm font-medium",
                  kind === "placeholder" ? "border-foreground bg-foreground text-background" : "bg-background text-foreground",
                ].join(" ")}
              >
                Placeholder item
              </button>
              <button
                type="button"
                onClick={() => setKind("standalone")}
                className={[
                  "rounded-full border px-3 py-2 text-sm font-medium",
                  kind === "standalone" ? "border-foreground bg-foreground text-background" : "bg-background text-foreground",
                ].join(" ")}
              >
                Standalone item
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              {kind === "placeholder"
                ? "Use this as a container for variations/options in the Items tab."
                : "Use this for a specific buyable variation."}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="shop_room" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Room</label>
              <select
                id="shop_room"
                value={room}
                onChange={(e) => setRoom(e.target.value as RoomId)}
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
              <label htmlFor="shop_price" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="shop_price"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                  className="h-12 rounded-xl pl-7 text-base focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="shop_qty" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quantity</label>
              <Input
                id="shop_qty"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="1"
                className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          {kind === "placeholder" ? (
            <div className="rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Placeholder items ignore price/store during save, but you can still edit all fields here.
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["Idea", "Shortlist", "Selected"] as ItemStatus[]).map((s) => (
                <StatusBadge key={s} status={s} selected={status === s} onClick={() => setStatus(s)} />
              ))}
            </div>
          </div>

          {kind === "standalone" ? (
            <div className="space-y-1.5">
              <label htmlFor="shop_store" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Store (optional)</label>
              <select
                id="shop_store"
                value={store}
                onChange={(e) => setStore(e.target.value)}
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
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="shop_brand" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Brand</label>
              <Input
                id="shop_brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Sealy"
                className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="shop_image_url" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Image URL</label>
              <Input
                id="shop_image_url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
                className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="shop_description" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</label>
            <Textarea
              id="shop_description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
                    onClick={() => setRoom(r as RoomId)}
                    className="rounded-full border border-border bg-background px-3 py-2 text-sm transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95"
                  >
                    {roomNameById.get(r as RoomId) || r}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button className="h-12 rounded-xl text-base shadow-sm transition-all duration-150 hover:opacity-90 active:scale-[0.98]" onClick={() => onAdd(false)}>
              {kind === "placeholder" ? "Add Placeholder" : "Add Item"}
            </Button>
            <Button variant="secondary" className="h-12 rounded-xl text-base transition-all duration-150 active:scale-[0.98]" onClick={() => onAdd(true)}>
              {kind === "placeholder" ? "Add Placeholder & Edit" : "Add & Edit"}
            </Button>
          </div>
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
