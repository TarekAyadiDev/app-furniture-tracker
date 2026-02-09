import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/data/DataContext";
import { type ItemStatus, type RoomId } from "@/lib/domain";
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

export default function Shopping() {
  const nav = useNavigate();
  const { toast } = useToast();
  const { orderedRooms, roomNameById, items, orderedStores, createItem } = useData();

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);
  const validRoomIds = useMemo(() => new Set(orderedRoomIds), [orderedRoomIds]);
  const validStoreKeys = useMemo(() => new Set(orderedStores.map((s) => storeKey(s.name))), [orderedStores]);

  const nameRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [room, setRoom] = useState<RoomId>(() => loadRecents(RECENT_ROOMS_KEY)[0] || "Living");
  const [status, setStatus] = useState<ItemStatus>("Shortlist");
  const [price, setPrice] = useState<string>("");
  const [store, setStore] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

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

  async function onAdd(openAfter = false) {
    const trimmed = name.trim();
    if (!trimmed) {
      nameRef.current?.focus();
      return;
    }

    const parsedPrice = parseNumberOrNull(price);

    const id = await createItem({
      name: trimmed,
      room,
      status,
      price: parsedPrice,
      store: store.trim() || null,
      notes: notes.trim() || null,
      qty: 1,
      category: "Other",
    });

    pushRecent(RECENT_ROOMS_KEY, room);
    setRecentRooms(loadRecents(RECENT_ROOMS_KEY).filter((r) => validRoomIds.has(r)));

    setName("");
    setPrice("");
    setNotes("");
    nameRef.current?.focus();

    toast({ title: "Added", description: `${trimmed} \u00b7 ${roomNameById.get(room) || room} \u00b7 ${status}` });

    if (openAfter) nav(`/items/${id}`);
  }

  return (
    <div className="space-y-5">
      <Card className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <div className="space-y-4">
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

          <div className="grid grid-cols-2 gap-3">
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
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["Idea", "Shortlist", "Selected"] as ItemStatus[]).map((s) => (
                <StatusBadge key={s} status={s} selected={status === s} onClick={() => setStatus(s)} />
              ))}
            </div>
          </div>

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

          <div className="space-y-1.5">
            <label htmlFor="shop_notes" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
            <Textarea
              id="shop_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
              Add Item
            </Button>
            <Button variant="secondary" className="h-12 rounded-xl text-base transition-all duration-150 active:scale-[0.98]" onClick={() => onAdd(true)}>
              Add & Edit
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
