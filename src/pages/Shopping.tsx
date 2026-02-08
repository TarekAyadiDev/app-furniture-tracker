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

const RECENT_ROOMS_KEY = "ft_recentRooms";
const RECENT_STORES_KEY = "ft_recentStores";

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
  const { orderedRooms, roomNameById, items, createItem } = useData();

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);
  const validRoomIds = useMemo(() => new Set(orderedRoomIds), [orderedRoomIds]);

  const nameRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [room, setRoom] = useState<RoomId>(() => loadRecents(RECENT_ROOMS_KEY)[0] || "Living");
  const [status, setStatus] = useState<ItemStatus>("Shortlist");
  const [price, setPrice] = useState<string>("");
  const [store, setStore] = useState<string>(() => loadRecents(RECENT_STORES_KEY)[0] || "");
  const [notes, setNotes] = useState<string>("");

  const [recentRooms, setRecentRooms] = useState<string[]>(() => loadRecents(RECENT_ROOMS_KEY));
  const [recentStores, setRecentStores] = useState<string[]>(() => loadRecents(RECENT_STORES_KEY));

  useEffect(() => {
    if (!orderedRoomIds.length) return;
    setRoom((cur) => (validRoomIds.has(cur) ? cur : orderedRoomIds[0]));
    setRecentRooms(loadRecents(RECENT_ROOMS_KEY).filter((r) => validRoomIds.has(r)));
  }, [orderedRoomIds, validRoomIds]);

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
    if (store.trim()) pushRecent(RECENT_STORES_KEY, store.trim());
    setRecentRooms(loadRecents(RECENT_ROOMS_KEY).filter((r) => validRoomIds.has(r)));
    setRecentStores(loadRecents(RECENT_STORES_KEY));

    setName("");
    setPrice("");
    setNotes("");
    nameRef.current?.focus();

    toast({ title: "Added", description: `${trimmed} \u00b7 ${roomNameById.get(room) || room} \u00b7 ${status}` });

    if (openAfter) nav(`/items/${id}`);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="shop_name" className="text-sm">
              Quick add
            </Label>
            <Input
              id="shop_name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Queen mattress protector"
              className="h-12 text-base"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="shop_room">Room</Label>
              <select
                id="shop_room"
                value={room}
                onChange={(e) => setRoom(e.target.value as RoomId)}
                className="h-12 w-full rounded-md border bg-background px-3 text-base"
              >
                {orderedRoomIds.map((r) => (
                  <option key={r} value={r}>
                    {roomNameById.get(r) || r}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shop_price">Price</Label>
              <Input
                id="shop_price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="$"
                className="h-12 text-base"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Status</div>
            <div className="flex flex-wrap gap-2">
              {(["Idea", "Shortlist", "Selected"] as ItemStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={[
                    "rounded-full border px-3 py-2 text-sm font-medium",
                    s === status ? "border-foreground bg-foreground text-background" : "bg-background",
                  ].join(" ")}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shop_store">Store (optional)</Label>
            <Input
              id="shop_store"
              value={store}
              onChange={(e) => setStore(e.target.value)}
              placeholder="IKEA, Target, Article..."
              className="h-12 text-base"
            />
            {recentStores.length ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {recentStores.slice(0, 6).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStore(s)}
                    className="rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shop_notes">Notes (voice-friendly)</Label>
            <Textarea
              id="shop_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Material, size, color, delivery notes..."
              className="min-h-[88px] text-base"
            />
          </div>

          {recentRooms.length ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Recent rooms</div>
              <div className="flex flex-wrap gap-2">
                {recentRooms.slice(0, 6).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRoom(r as RoomId)}
                    className="rounded-full border bg-background px-3 py-2 text-sm hover:text-foreground"
                  >
                    {roomNameById.get(r as RoomId) || r}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button className="h-12 text-base" onClick={() => onAdd(false)}>
              Add
            </Button>
            <Button variant="secondary" className="h-12 text-base" onClick={() => onAdd(true)}>
              Add & edit
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Recent</div>
            <div className="text-xs text-muted-foreground">Tap an item to edit. Long lists live in Items.</div>
          </div>
          <Button variant="ghost" onClick={() => nav("/items")}>
            View all
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {recentItems.length ? (
            recentItems.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => nav(`/items/${it.id}`)}
                className="w-full rounded-lg border bg-background px-3 py-3 text-left hover:bg-accent"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">{it.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {roomNameById.get(it.room) || it.room}
                      {it.store ? ` \u00b7 ${it.store}` : ""}
                      {it.price ? ` \u00b7 ${formatMoneyUSD(it.price)}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <StatusBadge status={it.status} />
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
