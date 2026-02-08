import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { ReviewStatusBadge } from "@/components/ReviewStatusBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { DragReorderList } from "@/components/reorder/DragReorderList";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { useData } from "@/data/DataContext";
import { ITEM_STATUSES, type ItemStatus, type RoomId } from "@/lib/domain";
import { formatMoneyUSD, parseNumberOrNull } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { addAttachmentFromUrl, deleteAttachment, listAttachments, type AttachmentRecord } from "@/storage/attachments";

type RoomFilter = RoomId | "All";
type StatusFilter = ItemStatus | "All";

function includesText(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export default function Items() {
  const nav = useNavigate();
  const { orderedRooms, roomNameById, items, options, reorderRooms, reorderItems } = useData();

  const searchRef = useRef<HTMLInputElement | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [roomFilter, setRoomFilter] = useState<RoomFilter>("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [storeFilter, setStoreFilter] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const [reorderRoomsMode, setReorderRoomsMode] = useState(false);
  const [reorderRoomId, setReorderRoomId] = useState<RoomId | null>(null);

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || (target as any)?.isContentEditable;
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        setFiltersOpen(true);
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const storeNeedle = storeFilter.trim().toLowerCase();
    const min = parseNumberOrNull(minPrice);
    const max = parseNumberOrNull(maxPrice);
    return items
      .filter((i) => i.syncState !== "deleted")
      .filter((i) => (roomFilter === "All" ? true : i.room === roomFilter))
      .filter((i) => (statusFilter === "All" ? true : i.status === statusFilter))
      .filter((i) => (storeNeedle ? includesText(i.store || "", storeNeedle) : true))
      .filter((i) => {
        if (min === null && max === null) return true;
        if (i.price === null || i.price === undefined) return false;
        if (min !== null && i.price < min) return false;
        if (max !== null && i.price > max) return false;
        return true;
      })
      .filter((i) => {
        if (!needle) return true;
        const blob = `${i.name} ${i.category} ${i.store || ""} ${i.notes || ""}`;
        return includesText(blob, needle);
      });
  }, [items, q, roomFilter, statusFilter, storeFilter, minPrice, maxPrice]);

  const byRoom = useMemo(() => {
    const map = new Map<RoomId, typeof filtered>();
    for (const r of orderedRooms) map.set(r.id, []);
    for (const it of filtered) {
      if (!map.has(it.room)) map.set(it.room, []);
      map.get(it.room)?.push(it);
    }
    for (const r of orderedRooms) {
      const list = map.get(r.id) || [];
      list.sort((a, b) => {
        const sa = typeof a.sort === "number" ? a.sort : 999999;
        const sb = typeof b.sort === "number" ? b.sort : 999999;
        if (sa !== sb) return sa - sb;
        const pa = a.priority ?? 999;
        const pb = b.priority ?? 999;
        if (pa !== pb) return pa - pb;
        return b.updatedAt - a.updatedAt;
      });
      map.set(r.id, list);
    }
    return map;
  }, [filtered, orderedRooms]);

  const optionSummaryByItem = useMemo(() => {
    const m = new Map<
      string,
      {
        count: number;
        selectedTitle?: string;
      }
    >();
    for (const o of options) {
      if (o.syncState === "deleted") continue;
      const entry = m.get(o.itemId) || { count: 0 };
      entry.count += 1;
      if (o.selected) entry.selectedTitle = o.title;
      m.set(o.itemId, entry);
    }
    return m;
  }, [options]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (roomFilter !== "All") n += 1;
    if (statusFilter !== "All") n += 1;
    if (storeFilter.trim()) n += 1;
    if (minPrice.trim()) n += 1;
    if (maxPrice.trim()) n += 1;
    return n;
  }, [roomFilter, statusFilter, storeFilter, minPrice, maxPrice]);

  return (
    <div className="space-y-5">
      <Card className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex h-12 flex-1 items-center gap-2 rounded-xl border border-border/50 bg-background/50 px-4 text-left text-base text-muted-foreground transition-all duration-200 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
            onClick={() => {
              setFiltersOpen(true);
              setTimeout(() => searchRef.current?.focus(), 0);
            }}
          >
            {q.trim() ? <span className="text-foreground">{q.trim()}</span> : <span>Search items...</span>}
          </button>
          <Button
            variant={filtersOpen ? "default" : "secondary"}
            className="h-12 rounded-xl px-5 transition-all duration-200 active:scale-[0.98]"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Filter{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </Button>
        </div>

        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <CollapsibleContent className="mt-5 space-y-4">
            <Input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search items..."
              className="h-12 rounded-xl text-base focus:ring-2 focus:ring-ring"
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Room</label>
                <select
                  value={roomFilter}
                  onChange={(e) => setRoomFilter(e.target.value as RoomFilter)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="All">All</option>
                  {orderedRoomIds.map((r) => (
                    <option key={r} value={r}>
                      {roomNameById.get(r) || r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="All">All</option>
                  {ITEM_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Store</label>
              <Input
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                placeholder="Filter by store"
                className="mt-1.5 h-11 rounded-xl text-base focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Min price</label>
                <Input
                  inputMode="decimal"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder="$"
                  className="mt-1.5 h-11 rounded-xl text-base focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Max price</label>
                <Input
                  inputMode="decimal"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="$"
                  className="mt-1.5 h-11 rounded-xl text-base focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              {filtered.length} item(s). Add items from the Shop tab.
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Accordion type="multiple" className="space-y-3">
        {orderedRoomIds.map((r) => {
          const group = byRoom.get(r) || [];
          if (!group.length) return null;
          const openReorder = reorderRoomId === r;
          return (
            <AccordionItem key={r} value={r} className="rounded-2xl border border-border bg-card px-4 shadow-sm">
              <AccordionTrigger className="py-3 hover:no-underline">
                <div className="flex w-full items-center justify-between gap-3 pr-2 text-left">
                  <h3 className="font-heading text-base text-card-foreground">{roomNameById.get(r) || r}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{group.length}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  {openReorder ? (
                    <DragReorderList
                      ariaLabel={`Reorder items in ${r}`}
                      items={group.map((it) => ({
                        id: it.id,
                        title: it.name,
                        subtitle: it.category || "Other",
                        right: it.priority ? <span className="text-xs text-muted-foreground">P{it.priority}</span> : null,
                      }))}
                      onCommit={async (ids) => {
                        await reorderItems(r, ids);
                      }}
                    />
                  ) : (
                    <div className="space-y-2">
                      {group.map((it) => {
                        const opt = optionSummaryByItem.get(it.id);
                        const modifiedFields = Array.isArray(it.provenance?.modifiedFields) ? it.provenance.modifiedFields : [];
                        return (
                          <Card key={it.id} className="p-3">
                            <div className="flex items-start gap-3">
                              <ItemPhotoStrip itemId={it.id} />
                              <div className="min-w-0 flex-1">
                                <button
                                  type="button"
                                  className="w-full min-w-0 text-left"
                                  onClick={() => nav(`/items/${it.id}`)}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="truncate text-base font-semibold">{it.name}</div>
                                    <StatusBadge status={it.status} />
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <ReviewStatusBadge status={it.provenance?.reviewStatus} />
                                    <DataSourceBadge dataSource={it.provenance?.dataSource} />
                                    {modifiedFields.length ? (
                                      <span className="text-xs text-muted-foreground">
                                        Changed: {modifiedFields.slice(0, 4).join(", ")}
                                        {modifiedFields.length > 4 ? ` +${modifiedFields.length - 4}` : ""}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                    <span className="truncate">{it.category || "Other"}</span>
                                    {it.store ? <span className="truncate">{it.store}</span> : null}
                                    {it.price ? (
                                      <span>{formatMoneyUSD(it.price)}</span>
                                    ) : (
                                      <span className="italic">no price</span>
                                    )}
                                    {it.qty !== 1 ? <span>qty {it.qty}</span> : null}
                                    {it.priority ? <span>P{it.priority}</span> : null}
                                    {opt?.selectedTitle ? (
                                      <span className="font-medium text-foreground">Selected: {opt.selectedTitle}</span>
                                    ) : opt?.count ? (
                                      <span>{opt.count} option(s)</span>
                                    ) : null}
                                  </div>
                                </button>
                              </div>

                              <Link
                                to={`/items/${it.id}`}
                                className="shrink-0 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                              >
                                Edit
                              </Link>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-1">
                    <Button
                      variant={openReorder ? "default" : "secondary"}
                      className="w-full"
                      onClick={(e) => {
                        e.preventDefault();
                        setReorderRoomId((cur) => (cur === r ? null : r));
                      }}
                    >
                      {openReorder ? "Done reordering" : "Reorder items"}
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <Card className="p-4">
        <div className="text-sm font-semibold">Reorder rooms</div>
        <div className="mt-1 text-xs text-muted-foreground">Drag the handle to change room order (used everywhere).</div>
        {reorderRoomsMode ? (
          <div className="mt-3">
            <DragReorderList
              ariaLabel="Reorder rooms"
              items={orderedRooms.map((room) => ({ id: room.id, title: roomNameById.get(room.id) || room.name || room.id }))}
              onCommit={async (ids) => {
                await reorderRooms(ids as RoomId[]);
              }}
            />
          </div>
        ) : null}
        <div className="mt-3">
          <Button
            variant={reorderRoomsMode ? "default" : "secondary"}
            className="w-full"
            onClick={() => setReorderRoomsMode((v) => !v)}
          >
            {reorderRoomsMode ? "Done" : "Reorder"}
          </Button>
        </div>
      </Card>
    </div >
  );
}

function ItemPhotoStrip({ itemId }: { itemId: string }) {
  const { toast } = useToast();
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const max = 3;

  useEffect(() => {
    let active = true;
    listAttachments("item", itemId)
      .then((rows) => {
        if (active) setAttachments(rows);
      })
      .catch(() => {
        if (active) setAttachments([]);
      });
    return () => {
      active = false;
    };
  }, [itemId]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const att of attachments) next[att.id] = URL.createObjectURL(att.blob);
    setUrls(next);
    return () => {
      Object.values(next).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments]);

  async function onRemove(attId: string) {
    await deleteAttachment(attId);
    setAttachments((cur) => cur.filter((att) => att.id !== attId));
  }

  async function onAddFromUrl() {
    if (attachments.length >= max) {
      toast({ title: "Limit reached", description: "Up to 3 photos per item." });
      return;
    }
    const raw = prompt("Photo URL (image link):")?.trim();
    if (!raw) return;
    try {
      await addAttachmentFromUrl("item", itemId, raw);
      const rows = await listAttachments("item", itemId);
      setAttachments(rows);
    } catch (err: any) {
      toast({ title: "Photo failed", description: err?.message || "Could not fetch that image." });
    }
  }

  return (
    <div className="w-[120px] shrink-0 space-y-2">
      {attachments.length ? (
        <div className="flex flex-wrap gap-2">
          {attachments.slice(0, max).map((att) => (
            <div key={att.id} className="relative h-12 w-12 overflow-hidden rounded-md border bg-background">
              {urls[att.id] ? (
                <img src={urls[att.id]} alt={att.name || "Item photo"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">...</div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onRemove(att.id);
                }}
                className="absolute right-0.5 top-0.5 rounded-full border bg-background px-1 text-[10px] text-muted-foreground hover:text-foreground"
                aria-label="Remove photo"
              >
                \u00d7
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">No photos</div>
      )}
      <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-[11px]" onClick={() => void onAddFromUrl()}>
        Add photo
      </Button>
    </div>
  );
}
