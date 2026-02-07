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
import { ITEM_STATUSES, ROOMS, type ItemStatus, type RoomId } from "@/lib/domain";
import { formatMoneyUSD, parseNumberOrNull } from "@/lib/format";

type RoomFilter = RoomId | "All";
type StatusFilter = ItemStatus | "All";

function includesText(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export default function Items() {
  const nav = useNavigate();
  const { rooms, items, options, reorderRooms, reorderItems } = useData();

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

  const orderedRoomIds = useMemo(() => {
    const byId = new Map(rooms.filter((r) => r.syncState !== "deleted").map((r) => [r.id, r] as const));
    const base = ROOMS.map((rid, idx) => {
      const r = byId.get(rid);
      const sort = typeof r?.sort === "number" ? r.sort : idx;
      return { id: rid, sort, idx };
    });
    base.sort((a, b) => (a.sort !== b.sort ? a.sort - b.sort : a.idx - b.idx));
    return base.map((x) => x.id);
  }, [rooms]);

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
    for (const r of ROOMS) map.set(r, []);
    for (const it of filtered) map.get(it.room)?.push(it);
    for (const r of ROOMS) {
      const list = map.get(r) || [];
      list.sort((a, b) => {
        const sa = typeof a.sort === "number" ? a.sort : 999999;
        const sb = typeof b.sort === "number" ? b.sort : 999999;
        if (sa !== sb) return sa - sb;
        const pa = a.priority ?? 999;
        const pb = b.priority ?? 999;
        if (pa !== pb) return pa - pb;
        return b.updatedAt - a.updatedAt;
      });
      map.set(r, list);
    }
    return map;
  }, [filtered]);

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
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-12 flex-1 items-center rounded-md border bg-background px-3 text-left text-base text-muted-foreground"
            onClick={() => {
              setFiltersOpen(true);
              setTimeout(() => searchRef.current?.focus(), 0);
            }}
          >
            {q.trim() ? <span className="text-foreground">{q.trim()}</span> : <span>Search (press /)</span>}
          </button>
          <Button
            variant={filtersOpen ? "default" : "secondary"}
            className="h-12"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Filter{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </Button>
        </div>

        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <CollapsibleContent className="mt-3 space-y-3">
            <Input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search..."
              className="h-12 text-base"
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground">Room</div>
                <select
                  value={roomFilter}
                  onChange={(e) => setRoomFilter(e.target.value as RoomFilter)}
                  className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-base"
                >
                  <option value="All">All</option>
                  {orderedRoomIds.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Status</div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-base"
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
              <div className="text-xs font-medium text-muted-foreground">Store</div>
              <Input
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                placeholder="Filter by store"
                className="mt-1 h-11 text-base"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground">Min price</div>
                <Input
                  inputMode="decimal"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder="$"
                  className="mt-1 h-11 text-base"
                />
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Max price</div>
                <Input
                  inputMode="decimal"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="$"
                  className="mt-1 h-11 text-base"
                />
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              {filtered.length} item(s). Add items from the Shop tab.
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Accordion type="multiple" className="space-y-2">
        {orderedRoomIds.map((r) => {
          const group = byRoom.get(r) || [];
          if (!group.length) return null;
          const openReorder = reorderRoomId === r;
          return (
            <AccordionItem key={r} value={r} className="rounded-lg border bg-background px-4">
              <AccordionTrigger className="py-3 hover:no-underline">
                <div className="flex w-full items-baseline justify-between gap-3 pr-2 text-left">
                  <div className="text-sm font-semibold">{r}</div>
                  <div className="text-xs text-muted-foreground">{group.length}</div>
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
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
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
              items={orderedRoomIds.map((rid) => ({ id: rid, title: rid }))}
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
    </div>
  );
}
