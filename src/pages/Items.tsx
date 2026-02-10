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
import { ITEM_STATUSES, type Item, type ItemStatus, type Option, type RoomId, type Store } from "@/lib/domain";
import { formatMoneyUSD, parseNumberOrNull } from "@/lib/format";
import {
  buildStoreIndex,
  itemDiscountAmountWithStore,
  optionPreDiscountTotalWithStore,
  optionTotalWithStore,
  storeKey,
} from "@/lib/storePricing";
import { useToast } from "@/hooks/use-toast";
import { addAttachment, addAttachmentFromBlob, deleteAttachment, listAttachments, type AttachmentRecord } from "@/storage/attachments";
import { Badge } from "@/components/ui/badge";
import { ChevronDown } from "lucide-react";

type RoomFilter = RoomId | "All";
type StatusFilter = ItemStatus | "All";
const NO_STORE_FILTER = "__none__";

function includesText(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function resolveStoreForOption(item: Item, opt: Option, storeByName: Map<string, Store>): Store | null {
  const key = storeKey(opt.store || item.store);
  return key ? storeByName.get(key) || null : null;
}

function optionTotalOrNull(item: Item, opt: Option, storeByName: Map<string, Store>): number | null {
  return optionTotalWithStore(opt, resolveStoreForOption(item, opt, storeByName));
}

function optionDiscountLabel(opt: Option): string | null {
  const value = typeof opt.discountValue === "number" ? opt.discountValue : typeof opt.discount === "number" ? opt.discount : null;
  if (value === null || value <= 0) return null;
  if (opt.discountType === "percent") return `disc -${value}%`;
  return `disc -${formatMoneyUSD(value)}`;
}

function effectiveItemTotal(item: Item, selected: Option[] | null, storeByName: Map<string, Store>): number | null {
  if (selected && selected.length) {
    let total = 0;
    let hasAny = false;
    for (const opt of selected) {
      const t = optionTotalOrNull(item, opt, storeByName);
      if (t === null) continue;
      total += t;
      hasAny = true;
    }
    return hasAny ? total : null;
  }
  const price = typeof item.price === "number" ? item.price : null;
  if (price !== null) {
    const store = storeByName.get(storeKey(item.store)) || null;
    const discount = itemDiscountAmountWithStore(item, store) || 0;
    return Math.max(0, price - discount);
  }
  return null;
}

function pickSelectedOptions(item: Item, list: Option[]): Option[] {
  const marked = list.filter((o) => o.selected);
  if (marked.length) return marked;
  if (item.selectedOptionId) {
    const found = list.find((o) => o.id === item.selectedOptionId);
    if (found) return [found];
  }
  return [];
}

export default function Items() {
  const nav = useNavigate();
  const { toast } = useToast();
  const { orderedRooms, roomNameById, items, options, orderedStores, reorderRooms, reorderItems, reorderOptions, createItem, updateItem, createOption, updateOption } =
    useData();

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
  const [duplicateItemId, setDuplicateItemId] = useState<string | null>(null);
  const [openItemOptions, setOpenItemOptions] = useState<Record<string, boolean>>({});
  const [reorderOptionsForItem, setReorderOptionsForItem] = useState<Record<string, boolean>>({});

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);
  const storeByName = useMemo(() => buildStoreIndex(orderedStores), [orderedStores]);

  function buildCopyName(base: string) {
    const name = base.trim() || "New item";
    const existing = new Set(items.filter((i) => i.syncState !== "deleted").map((i) => i.name));
    if (!existing.has(`${name} (copy)`)) return `${name} (copy)`;
    let idx = 2;
    while (existing.has(`${name} (copy ${idx})`)) idx += 1;
    return `${name} (copy ${idx})`;
  }

  function buildCopyOptionTitle(base: string, list: Option[]) {
    const title = base.trim() || "Option";
    const existing = new Set(list.filter((o) => o.syncState !== "deleted").map((o) => o.title));
    if (!existing.has(`${title} (copy)`)) return `${title} (copy)`;
    let idx = 2;
    while (existing.has(`${title} (copy ${idx})`)) idx += 1;
    return `${title} (copy ${idx})`;
  }

  async function onDuplicateItem(it: Item) {
    if (duplicateItemId) return;
    setDuplicateItemId(it.id);
    const maxAttachments = 3;
    try {
      const copyName = buildCopyName(it.name);
      const newId = await createItem({
        name: copyName,
        room: it.room,
        category: it.category,
        status: it.status,
        price: it.price ?? null,
        discountType: it.discountType ?? null,
        discountValue: it.discountValue ?? null,
        qty: it.qty ?? 1,
        store: it.store ?? null,
        link: it.link ?? null,
        notes: it.notes ?? null,
        priority: it.priority ?? null,
        tags: it.tags ? [...it.tags] : null,
        dimensions: it.dimensions ? { ...it.dimensions } : undefined,
        specs: it.specs ? { ...it.specs } : null,
      });

      const itemAtts = await listAttachments("item", it.id);
      await Promise.all(
        itemAtts.slice(0, maxAttachments).map((att) =>
          addAttachmentFromBlob("item", newId, att.blob, { name: att.name ?? null, sourceUrl: att.sourceUrl ?? null }),
        ),
      );

      const itemOptions = options.filter((o) => o.syncState !== "deleted" && o.itemId === it.id);
      const sortedOptions = itemOptions
        .slice()
        .sort((a, b) => {
          const sa = typeof a.sort === "number" ? a.sort : 999999;
          const sb = typeof b.sort === "number" ? b.sort : 999999;
          if (sa !== sb) return sa - sb;
          return a.title.localeCompare(b.title);
        });
      const optionIdMap = new Map<string, string>();
      for (const opt of [...sortedOptions].reverse()) {
        const newOptId = await createOption({
          itemId: newId,
          title: opt.title,
          store: opt.store ?? null,
          link: opt.link ?? null,
          promoCode: opt.promoCode ?? null,
          price: opt.price ?? null,
          shipping: opt.shipping ?? null,
          taxEstimate: opt.taxEstimate ?? null,
          discount: opt.discount ?? null,
          discountType: opt.discountType ?? (typeof opt.discount === "number" ? "amount" : null),
          discountValue: typeof opt.discountValue === "number" ? opt.discountValue : typeof opt.discount === "number" ? opt.discount : null,
          dimensionsText: opt.dimensionsText ?? null,
          dimensions: opt.dimensions ? { ...opt.dimensions } : undefined,
          specs: opt.specs ? { ...opt.specs } : null,
          notes: opt.notes ?? null,
          priority: opt.priority ?? null,
          tags: opt.tags ? [...opt.tags] : null,
          selected: Boolean(opt.selected),
        });
        optionIdMap.set(opt.id, newOptId);
      }
      for (const [oldId, newOptId] of optionIdMap.entries()) {
        const optAtts = await listAttachments("option", oldId);
        await Promise.all(
          optAtts.slice(0, maxAttachments).map((att) =>
            addAttachmentFromBlob("option", newOptId, att.blob, { name: att.name ?? null, sourceUrl: att.sourceUrl ?? null }),
          ),
        );
      }

      toast({ title: "Item duplicated", description: copyName });
      nav(`/items/${newId}`);
    } catch (err: any) {
      toast({ title: "Duplicate failed", description: err?.message || "Could not duplicate item." });
    } finally {
      setDuplicateItemId(null);
    }
  }

  async function onDuplicateOptionForItem(item: Item, option: Option, list: Option[]) {
    const maxAttachments = 3;
    try {
      const titleCopy = buildCopyOptionTitle(option.title, list);
      const newOptId = await createOption({
        itemId: item.id,
        title: titleCopy,
        store: option.store ?? null,
        link: option.link ?? null,
        promoCode: option.promoCode ?? null,
        price: option.price ?? null,
        shipping: option.shipping ?? null,
        taxEstimate: option.taxEstimate ?? null,
        discount: option.discount ?? null,
        discountType: option.discountType ?? (typeof option.discount === "number" ? "amount" : null),
        discountValue: typeof option.discountValue === "number" ? option.discountValue : typeof option.discount === "number" ? option.discount : null,
        dimensionsText: option.dimensionsText ?? null,
        dimensions: option.dimensions ? { ...option.dimensions } : undefined,
        specs: option.specs ? { ...option.specs } : null,
        notes: option.notes ?? null,
        priority: option.priority ?? null,
        tags: option.tags ? [...option.tags] : null,
        selected: false,
      });
      const optAtts = await listAttachments("option", option.id);
      await Promise.all(
        optAtts.slice(0, maxAttachments).map((att) =>
          addAttachmentFromBlob("option", newOptId, att.blob, { name: att.name ?? null, sourceUrl: att.sourceUrl ?? null }),
        ),
      );
      toast({ title: "Option duplicated", description: titleCopy });
    } catch (err: any) {
      toast({ title: "Duplicate failed", description: err?.message || "Could not duplicate option." });
    }
  }

  async function onSelectOptionForItem(item: Item, option: Option, list: Option[]) {
    try {
      const others = list.filter((o) => o.id !== option.id);
      await Promise.all([
        updateOption(option.id, { selected: true }),
        ...others.map((o) => updateOption(o.id, { selected: false })),
      ]);
      const store = resolveStoreForOption(item, option, storeByName);
      const preDiscountTotal = optionPreDiscountTotalWithStore(option, store);
      const optDiscountType =
        option.discountType === "percent" || option.discountType === "amount"
          ? option.discountType
          : typeof option.discount === "number"
            ? "amount"
            : null;
      const optDiscountValue =
        typeof option.discountValue === "number" ? option.discountValue : typeof option.discount === "number" ? option.discount : null;
      await updateItem(item.id, {
        status: "Selected",
        selectedOptionId: option.id,
        name: option.title || item.name,
        store: option.store || item.store || null,
        link: option.link ?? null,
        price: preDiscountTotal ?? null,
        discountType: optDiscountType,
        discountValue: optDiscountValue,
        priority: typeof option.priority === "number" ? option.priority : null,
        tags: option.tags ? [...option.tags] : null,
        dimensions: option.dimensions ? { ...option.dimensions } : undefined,
        specs: option.specs ? { ...option.specs } : null,
        notes: typeof option.notes === "string" ? option.notes : null,
      });
    } catch (err: any) {
      toast({ title: "Selection failed", description: err?.message || "Could not select this option." });
    }
  }

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

  const optionsByItem = useMemo(() => {
    const map = new Map<string, Option[]>();
    for (const o of options) {
      if (o.syncState === "deleted") continue;
      if (!map.has(o.itemId)) map.set(o.itemId, []);
      map.get(o.itemId)!.push(o);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const sa = typeof a.sort === "number" ? a.sort : 999999;
        const sb = typeof b.sort === "number" ? b.sort : 999999;
        if (sa !== sb) return sa - sb;
        return b.updatedAt - a.updatedAt;
      });
    }
    return map;
  }, [options]);

  const selectedOptionByItem = useMemo(() => {
    const selected = new Map<string, Option[]>();
    for (const it of items) {
      if (it.syncState === "deleted") continue;
      const list = optionsByItem.get(it.id) || [];
      selected.set(it.id, pickSelectedOptions(it, list));
    }
    return selected;
  }, [items, optionsByItem]);

  const effectiveTotals = useMemo(() => {
    const totals = new Map<string, number | null>();
    for (const it of items) {
      if (it.syncState === "deleted") continue;
      const selected = selectedOptionByItem.get(it.id) || [];
      totals.set(it.id, effectiveItemTotal(it, selected, storeByName));
    }
    return totals;
  }, [items, selectedOptionByItem, storeByName]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const storeNeedle = storeKey(storeFilter);
    const min = parseNumberOrNull(minPrice);
    const max = parseNumberOrNull(maxPrice);
    return items
      .filter((i) => i.syncState !== "deleted")
      .filter((i) => (roomFilter === "All" ? true : i.room === roomFilter))
      .filter((i) => (statusFilter === "All" ? true : i.status === statusFilter))
      .filter((i) => {
        if (!storeNeedle) return true;
        if (storeFilter === NO_STORE_FILTER) return !storeKey(i.store);
        return storeKey(i.store) === storeNeedle;
      })
      .filter((i) => {
        if (min === null && max === null) return true;
        const effective = effectiveTotals.get(i.id) ?? null;
        if (effective === null) return false;
        if (min !== null && effective < min) return false;
        if (max !== null && effective > max) return false;
        return true;
      })
      .filter((i) => {
        if (!needle) return true;
        const blob = `${i.name} ${i.category} ${i.store || ""} ${i.notes || ""}`;
        return includesText(blob, needle);
      });
  }, [items, q, roomFilter, statusFilter, storeFilter, minPrice, maxPrice, effectiveTotals]);

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
              <select
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All</option>
                <option value={NO_STORE_FILTER}>No store</option>
                {orderedStores.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
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
                        const itemOpts = optionsByItem.get(it.id) || [];
                        const selectedOpts = selectedOptionByItem.get(it.id) || pickSelectedOptions(it, itemOpts);
                        const selectedOpt = selectedOpts.length === 1 ? selectedOpts[0] : null;
                        const displayPrice = effectiveTotals.get(it.id) ?? null;
                        const openOptions = Boolean(openItemOptions[it.id]);
                        const openOptReorder = Boolean(reorderOptionsForItem[it.id]);
                        const modifiedFields = Array.isArray(it.provenance?.modifiedFields) ? it.provenance.modifiedFields : [];
                        return (
                          <Card key={it.id} className="p-3">
                            <div className="flex items-start gap-3">
                              <ItemPhotoStrip itemId={it.id} fallbackOptionId={selectedOpt?.id || null} />
                              <div className="min-w-0 flex-1">
                                <div
                                  role="button"
                                  tabIndex={0}
                                  className="w-full min-w-0 text-left"
                                  onClick={(e) => {
                                    const target = e.target as HTMLElement | null;
                                    if (target?.closest("a,button")) return;
                                    nav(`/items/${it.id}`);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      nav(`/items/${it.id}`);
                                    }
                                  }}
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
                                    {displayPrice !== null ? <span>{formatMoneyUSD(displayPrice)}</span> : <span className="italic">no price</span>}
                                    {it.qty !== 1 ? <span>qty {it.qty}</span> : null}
                                    {it.priority ? <span>P{it.priority}</span> : null}
                                    {selectedOpt ? (
                                      <span className="font-medium text-foreground">Selected: {selectedOpt.title}</span>
                                    ) : selectedOpts.length > 1 ? (
                                      <span className="font-medium text-foreground">Selected: {selectedOpts.length} options</span>
                                    ) : itemOpts.length ? (
                                      <span>{itemOpts.length} option(s)</span>
                                    ) : null}
                                  </div>
                                </div>
                                {itemOpts.length ? (
                                  <button
                                    type="button"
                                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenItemOptions((cur) => ({ ...cur, [it.id]: !openOptions }));
                                    }}
                                  >
                                    <ChevronDown className={["h-4 w-4 transition-transform", openOptions ? "rotate-180" : ""].join(" ")} />
                                    {openOptions ? "Hide variations" : `Show variations (${itemOpts.length})`}
                                  </button>
                                ) : null}
                              </div>

                              <div className="flex shrink-0 flex-col gap-2">
                                {it.link && (
                                  <a
                                    href={it.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    View Offer
                                  </a>
                                )}
                                <Link
                                  to={`/items/${it.id}`}
                                  className="inline-flex h-8 items-center justify-center rounded-lg border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                  Edit
                                </Link>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="h-8 rounded-lg text-xs"
                                  disabled={duplicateItemId === it.id}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void onDuplicateItem(it);
                                  }}
                                >
                                  Duplicate
                                </Button>
                              </div>
                            </div>

                            {openOptions ? (
                              <div className="mt-3 border-t pt-3">
                                {openOptReorder ? (
                                  <DragReorderList
                                    ariaLabel={`Reorder options for ${it.name}`}
                                    items={itemOpts.map((opt) => {
                                      const total = optionTotalOrNull(it, opt, storeByName);
                                      const subtitleParts = [
                                        opt.store ? String(opt.store) : "",
                                        total ? formatMoneyUSD(total) : "",
                                        opt.selected ? "selected" : "",
                                      ].filter(Boolean);
                                      return {
                                        id: opt.id,
                                        title: opt.title,
                                        subtitle: subtitleParts.join(" · "),
                                      };
                                    })}
                                    onCommit={async (ids) => {
                                      await reorderOptions(it.id, ids);
                                    }}
                                  />
                                ) : (
                                  <div className="space-y-2">
                                    {itemOpts.map((opt) => {
                                      const total = optionTotalOrNull(it, opt, storeByName);
                                      const isSelected = selectedOpt?.id === opt.id || opt.selected;
                                      return (
                                        <div key={opt.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-background/70 p-3">
                                          <OptionPhotoStrip optionId={opt.id} />
                                          <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <div className="truncate text-sm font-semibold">{opt.title}</div>
                                              {isSelected ? <Badge>Selected</Badge> : <Badge variant="secondary">Option</Badge>}
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                              {opt.store ? <span>{opt.store}</span> : null}
                                              {typeof opt.priority === "number" ? <span>P{opt.priority}</span> : null}
                                              {total ? <span>{formatMoneyUSD(total)}</span> : <span className="italic">no total</span>}
                                              {optionDiscountLabel(opt) ? <span>{optionDiscountLabel(opt)}</span> : null}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <Button
                                              size="sm"
                                              variant={isSelected ? "default" : "secondary"}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void onSelectOptionForItem(it, opt, itemOpts);
                                              }}
                                            >
                                              {isSelected ? "Selected" : "Select"}
                                            </Button>
                                            {opt.link ? (
                                              <a
                                                href={opt.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex h-8 items-center justify-center rounded-lg border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                View
                                              </a>
                                            ) : null}
                                          <Link
                                            to={`/items/${it.id}?option=${encodeURIComponent(opt.id)}`}
                                            className="inline-flex h-8 items-center justify-center rounded-lg border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            Edit
                                          </Link>
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void onDuplicateOptionForItem(it, opt, itemOpts);
                                            }}
                                          >
                                            Duplicate
                                          </Button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  </div>
                                )}

                                <div className="mt-3">
                                  <Button
                                    variant={openOptReorder ? "default" : "secondary"}
                                    className="w-full"
                                    onClick={() =>
                                      setReorderOptionsForItem((cur) => ({
                                        ...cur,
                                        [it.id]: !openOptReorder,
                                      }))
                                    }
                                  >
                                    {openOptReorder ? "Done reordering variations" : "Reorder variations"}
                                  </Button>
                                </div>
                              </div>
                            ) : null}
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

function ItemPhotoStrip({ itemId, fallbackOptionId }: { itemId: string; fallbackOptionId?: string | null }) {
  const { toast } = useToast();
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [fallbackAttachments, setFallbackAttachments] = useState<AttachmentRecord[]>([]);
  const [fallbackUrls, setFallbackUrls] = useState<Record<string, string>>({});
  const max = 3;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    if (!fallbackOptionId) {
      setFallbackAttachments([]);
      return;
    }
    let active = true;
    listAttachments("option", fallbackOptionId)
      .then((rows) => {
        if (active) setFallbackAttachments(rows);
      })
      .catch(() => {
        if (active) setFallbackAttachments([]);
      });
    return () => {
      active = false;
    };
  }, [fallbackOptionId]);

  useEffect(() => {
    const next: Record<string, string> = {};
    const toRevoke: string[] = [];
    for (const att of attachments) {
      if (att.sourceUrl) {
        next[att.id] = att.sourceUrl;
        continue;
      }
      const url = URL.createObjectURL(att.blob);
      next[att.id] = url;
      toRevoke.push(url);
    }
    setUrls(next);
    return () => {
      toRevoke.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments]);

  useEffect(() => {
    const next: Record<string, string> = {};
    const toRevoke: string[] = [];
    for (const att of fallbackAttachments) {
      if (att.sourceUrl) {
        next[att.id] = att.sourceUrl;
        continue;
      }
      const url = URL.createObjectURL(att.blob);
      next[att.id] = url;
      toRevoke.push(url);
    }
    setFallbackUrls(next);
    return () => {
      toRevoke.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [fallbackAttachments]);

  async function onRemove(attId: string) {
    await deleteAttachment(attId);
    setAttachments((cur) => cur.filter((att) => att.id !== attId));
  }

  async function onAddFromFiles(files: FileList | null) {
    if (!files || !files.length) return;
    if (attachments.length >= max) {
      toast({ title: "Limit reached", description: "Up to 3 photos per item." });
      return;
    }
    const remaining = Math.max(0, max - attachments.length);
    const incoming = Array.from(files).slice(0, remaining);
    if (!incoming.length) return;
    if (incoming.length < files.length) {
      toast({ title: "Limit reached", description: `Only added ${incoming.length} photo(s).` });
    }
    try {
      await Promise.all(incoming.map((file) => addAttachment("item", itemId, file)));
      const rows = await listAttachments("item", itemId);
      setAttachments(rows);
    } catch (err: any) {
      toast({ title: "Photo upload failed", description: err?.message || "Could not upload photo." });
    }
  }

  const usingFallback = attachments.length === 0 && fallbackAttachments.length > 0;
  const displayAttachments = usingFallback ? fallbackAttachments : attachments;
  const displayUrls = usingFallback ? fallbackUrls : urls;

  return (
    <div className="w-[120px] shrink-0 space-y-2">
      {displayAttachments.length ? (
        <div className="flex flex-col gap-2">
          {/* Main large image */}
          {displayAttachments[0] && (
            <div className="relative aspect-square w-full overflow-hidden rounded-lg border bg-background shadow-sm transition-all hover:scale-[1.02]">
              {displayUrls[displayAttachments[0].id] ? (
                <img
                  src={displayUrls[displayAttachments[0].id]}
                  alt={displayAttachments[0].name || "Item photo"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">Loading...</div>
              )}
              {!usingFallback ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void onRemove(displayAttachments[0].id);
                  }}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-xs text-foreground backdrop-blur-sm transition-colors hover:bg-destructive hover:text-destructive-foreground"
                  aria-label="Remove photo"
                >
                  &times;
                </button>
              ) : null}
            </div>
          )}
          {/* Smaller thumbnails for others */}
          {displayAttachments.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {displayAttachments.slice(1, max).map((att) => (
                <div key={att.id} className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-background shadow-sm">
                  {displayUrls[att.id] ? (
                    <img src={displayUrls[att.id]} alt={att.name || "Item photo"} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[8px] text-muted-foreground">...</div>
                  )}
                  {!usingFallback ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void onRemove(att.id);
                      }}
                      className="absolute right-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-background/80 text-[8px] text-foreground hover:bg-destructive hover:text-destructive-foreground"
                      aria-label="Remove photo"
                    >
                      &times;
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {usingFallback ? <div className="text-[10px] text-muted-foreground">Using selected option photo</div> : null}
        </div>
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground">
          <span>No photo</span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void onAddFromFiles(e.target.files);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-7 px-2 text-[11px]"
        onClick={() => fileInputRef.current?.click()}
      >
        Add photo
      </Button>
    </div>
  );
}

function OptionPhotoStrip({ optionId }: { optionId: string }) {
  const { toast } = useToast();
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const max = 3;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    listAttachments("option", optionId)
      .then((rows) => {
        if (active) setAttachments(rows);
      })
      .catch(() => {
        if (active) setAttachments([]);
      });
    return () => {
      active = false;
    };
  }, [optionId]);

  useEffect(() => {
    const next: Record<string, string> = {};
    const toRevoke: string[] = [];
    for (const att of attachments) {
      if (att.sourceUrl) {
        next[att.id] = att.sourceUrl;
        continue;
      }
      const url = URL.createObjectURL(att.blob);
      next[att.id] = url;
      toRevoke.push(url);
    }
    setUrls(next);
    return () => {
      toRevoke.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments]);

  async function onRemove(attId: string) {
    await deleteAttachment(attId);
    setAttachments((cur) => cur.filter((att) => att.id !== attId));
  }

  async function onAddFromFiles(files: FileList | null) {
    if (!files || !files.length) return;
    if (attachments.length >= max) {
      toast({ title: "Limit reached", description: "Up to 3 photos per option." });
      return;
    }
    const remaining = Math.max(0, max - attachments.length);
    const incoming = Array.from(files).slice(0, remaining);
    if (!incoming.length) return;
    if (incoming.length < files.length) {
      toast({ title: "Limit reached", description: `Only added ${incoming.length} photo(s).` });
    }
    try {
      await Promise.all(incoming.map((file) => addAttachment("option", optionId, file)));
      const rows = await listAttachments("option", optionId);
      setAttachments(rows);
    } catch (err: any) {
      toast({ title: "Photo upload failed", description: err?.message || "Could not upload photo." });
    }
  }

  return (
    <div className="w-[88px] shrink-0 space-y-2">
      {attachments.length ? (
        <div className="flex flex-col gap-2">
          {attachments[0] && (
            <div className="relative aspect-square w-full overflow-hidden rounded-lg border bg-background shadow-sm">
              {urls[attachments[0].id] ? (
                <img src={urls[attachments[0].id]} alt={attachments[0].name || "Option photo"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">Loading...</div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onRemove(attachments[0].id);
                }}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-xs text-foreground backdrop-blur-sm transition-colors hover:bg-destructive hover:text-destructive-foreground"
                aria-label="Remove photo"
              >
                &times;
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[10px] text-muted-foreground">
          <span>No photo</span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void onAddFromFiles(e.target.files);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-7 px-2 text-[10px]"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          fileInputRef.current?.click();
        }}
      >
        Add photo
      </Button>
    </div>
  );
}
