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
import { ITEM_STATUSES, inferItemKind, type Item, type ItemStatus, type Option, type RoomId } from "@/lib/domain";
import { formatMoneyUSD, parseNumberOrNull } from "@/lib/format";
import {
  buildStoreIndex,
  computeStoreAllocation,
  optionTotalWithoutStore,
  storeKey,
} from "@/lib/storePricing";
import { useToast } from "@/hooks/use-toast";
import { addAttachment, addAttachmentFromBlob, deleteAttachment, listAttachments, type AttachmentRecord } from "@/storage/attachments";
import { Badge } from "@/components/ui/badge";
import { ChevronDown } from "lucide-react";

type RoomFilter = RoomId | "All";
type StatusFilter = ItemStatus | "All";
const NO_STORE_FILTER = "__none__";
const ITEMS_UI_KEY = "ft_items_ui_state_v1";

type ItemsUiState = {
  openRooms: string[];
  openItemOptions: Record<string, boolean>;
};

function loadItemsUiState(): ItemsUiState {
  try {
    if (typeof window === "undefined") return { openRooms: [], openItemOptions: {} };
    const raw = localStorage.getItem(ITEMS_UI_KEY);
    if (!raw) return { openRooms: [], openItemOptions: {} };
    const parsed = JSON.parse(raw);
    return {
      openRooms: Array.isArray(parsed?.openRooms) ? parsed.openRooms.map(String) : [],
      openItemOptions: typeof parsed?.openItemOptions === "object" && parsed?.openItemOptions ? parsed.openItemOptions : {},
    };
  } catch {
    return { openRooms: [], openItemOptions: {} };
  }
}

function saveItemsUiState(state: ItemsUiState) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(ITEMS_UI_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

function includesText(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function optionDiscountLabel(opt: Option): string | null {
  const value = typeof opt.discountValue === "number" ? opt.discountValue : typeof opt.discount === "number" ? opt.discount : null;
  if (value === null || value <= 0) return null;
  if (opt.discountType === "percent") return `disc -${value}%`;
  return `disc -${formatMoneyUSD(value)}`;
}

function subItemDiscountAmount(sub: { discountType?: "amount" | "percent" | null; discountValue?: number | null }, base: number): number {
  const value = typeof sub.discountValue === "number" ? sub.discountValue : null;
  if (value === null || value <= 0) return 0;
  if (sub.discountType === "percent") {
    if (value >= 100) return base;
    return (base * value) / 100;
  }
  return Math.min(value, base);
}

function subItemQty(sub: { qty?: number }): number {
  const raw = typeof sub.qty === "number" ? sub.qty : null;
  return raw !== null && raw > 0 ? Math.round(raw) : 1;
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
  const {
    orderedRooms,
    roomNameById,
    items,
    options,
    subItems,
    orderedStores,
    reorderRooms,
    reorderItems,
    reorderOptions,
    createItem,
    updateItem,
    convertItemToOption,
    createOption,
    updateOption,
    createSubItem,
  } = useData();

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
  const initialUi = useMemo(() => loadItemsUiState(), []);
  const [openRooms, setOpenRooms] = useState<string[]>(() => initialUi.openRooms);
  const [openItemOptions, setOpenItemOptions] = useState<Record<string, boolean>>(() => initialUi.openItemOptions);
  const [reorderOptionsForItem, setReorderOptionsForItem] = useState<Record<string, boolean>>({});
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropTargetItemId, setDropTargetItemId] = useState<string | null>(null);
  const [dropBusyItemId, setDropBusyItemId] = useState<string | null>(null);

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);
  const storeByName = useMemo(() => buildStoreIndex(orderedStores), [orderedStores]);
  const itemById = useMemo(() => new Map(items.filter((i) => i.syncState !== "deleted").map((i) => [i.id, i])), [items]);
  const itemNameById = useMemo(() => new Map(items.filter((i) => i.syncState !== "deleted").map((i) => [i.id, i.name])), [items]);

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
        kind: inferItemKind(it, options.some((o) => o.syncState !== "deleted" && o.itemId === it.id)),
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

        const optSubItems = subItemsByOption.get(oldId) || [];
        for (const sub of optSubItems) {
          const newSubId = await createSubItem({
            optionId: newOptId,
            title: sub.title,
            qty: subItemQty(sub),
            price: sub.price ?? null,
            taxEstimate: sub.taxEstimate ?? null,
            discountType: sub.discountType ?? null,
            discountValue: sub.discountValue ?? null,
            extraWarrantyCost: sub.extraWarrantyCost ?? null,
            notes: sub.notes ?? null,
            provenance: sub.provenance,
          });
          const subAtts = await listAttachments("subItem", sub.id);
          await Promise.all(
            subAtts.slice(0, maxAttachments).map((att) =>
              addAttachmentFromBlob("subItem", newSubId, att.blob, { name: att.name ?? null, sourceUrl: att.sourceUrl ?? null }),
            ),
          );
        }
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
      const optionSubItems = subItemsByOption.get(option.id) || [];
      for (const sub of optionSubItems) {
        const newSubId = await createSubItem({
          optionId: newOptId,
          title: sub.title,
          qty: subItemQty(sub),
          price: sub.price ?? null,
          taxEstimate: sub.taxEstimate ?? null,
          discountType: sub.discountType ?? null,
          discountValue: sub.discountValue ?? null,
          extraWarrantyCost: sub.extraWarrantyCost ?? null,
          notes: sub.notes ?? null,
          provenance: sub.provenance,
        });
        const subAtts = await listAttachments("subItem", sub.id);
        await Promise.all(
          subAtts.slice(0, maxAttachments).map((att) =>
            addAttachmentFromBlob("subItem", newSubId, att.blob, { name: att.name ?? null, sourceUrl: att.sourceUrl ?? null }),
          ),
        );
      }
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
      await updateItem(item.id, {
        status: "Selected",
        selectedOptionId: option.id,
      });
    } catch (err: any) {
      toast({ title: "Selection failed", description: err?.message || "Could not select this option." });
    }
  }

  async function onDropItemIntoPlaceholder(placeholderItemId: string, sourceItemId: string) {
    if (!placeholderItemId || !sourceItemId || placeholderItemId === sourceItemId) return;
    if (dropBusyItemId) return;
    const target = itemById.get(placeholderItemId);
    const source = itemById.get(sourceItemId);
    if (!target || !source) return;

    const targetOptions = optionsByItem.get(target.id) || [];
    const sourceOptions = optionsByItem.get(source.id) || [];
    const targetIsPlaceholder = inferItemKind(target, targetOptions.length > 0) === "placeholder";
    const sourceIsPlaceholder = inferItemKind(source, sourceOptions.length > 0) === "placeholder";
    if (!targetIsPlaceholder) {
      toast({ title: "Drop failed", description: "Variations can only be dropped into placeholder items." });
      return;
    }
    if (sourceIsPlaceholder || sourceOptions.length > 0) {
      toast({ title: "Drop failed", description: "Only standalone items can be dropped as variations." });
      return;
    }

    setDropBusyItemId(placeholderItemId);
    try {
      await convertItemToOption(placeholderItemId, sourceItemId);
      setOpenItemOptions((cur) => ({ ...cur, [placeholderItemId]: true }));
      toast({ title: "Variation added", description: `${source.name} moved under ${target.name}.` });
    } catch (err: any) {
      toast({ title: "Drop failed", description: err?.message || "Could not add this variation." });
    } finally {
      setDropBusyItemId(null);
      setDropTargetItemId(null);
      setDraggingItemId(null);
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
  const hasOptionsByItem = useMemo(() => new Set(optionsByItem.keys()), [optionsByItem]);

  const subItemsByOption = useMemo(() => {
    const map = new Map<string, typeof subItems>();
    for (const s of subItems) {
      if (s.syncState === "deleted") continue;
      const key = s.optionId;
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
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
  }, [subItems]);

  const optionTotalOrNull = useMemo(() => {
    return (opt: Option): number | null => {
      const subs = subItemsByOption.get(opt.id) || [];
      if (subs.length) {
        let total = 0;
        let hasAny = false;
        for (const sub of subs) {
          const price = typeof sub.price === "number" ? sub.price : null;
          const tax = typeof sub.taxEstimate === "number" ? sub.taxEstimate : null;
          const warranty = typeof sub.extraWarrantyCost === "number" ? sub.extraWarrantyCost : null;
          const hasSub = price !== null || tax !== null || warranty !== null;
          if (!hasSub) continue;
          const base = (price || 0) + (tax || 0) + (warranty || 0);
          const discount = subItemDiscountAmount(sub, base);
          total += Math.max(0, base - discount) * subItemQty(sub);
          hasAny = true;
        }
        return hasAny ? total : null;
      }
      return optionTotalWithoutStore(opt);
    };
  }, [subItemsByOption]);

  const selectedOptionByItem = useMemo(() => {
    const selected = new Map<string, Option[]>();
    for (const it of items) {
      if (it.syncState === "deleted") continue;
      const list = optionsByItem.get(it.id) || [];
      selected.set(it.id, pickSelectedOptions(it, list));
    }
    return selected;
  }, [items, optionsByItem]);

  const storeAllocation = useMemo(
    () => computeStoreAllocation(items, selectedOptionByItem, storeByName, subItemsByOption, hasOptionsByItem),
    [items, selectedOptionByItem, storeByName, subItemsByOption, hasOptionsByItem],
  );

  const effectiveTotals = storeAllocation.itemTotals;

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
        const selected = selectedOptionByItem.get(i.id) || [];
        const hasOptions = hasOptionsByItem.has(i.id);
        const selectedKeys = selected.map((o) => storeKey(o.store)).filter(Boolean);
        const fallbackKey = !hasOptions ? storeKey(i.store) : "";
        const keys = selectedKeys.length ? selectedKeys : fallbackKey ? [fallbackKey] : [];
        if (storeFilter === NO_STORE_FILTER) return keys.length === 0;
        return keys.some((k) => k === storeNeedle);
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
  }, [items, q, roomFilter, statusFilter, storeFilter, minPrice, maxPrice, effectiveTotals, selectedOptionByItem, hasOptionsByItem]);

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

  useEffect(() => {
    saveItemsUiState({ openRooms, openItemOptions });
  }, [openRooms, openItemOptions]);

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

      <Accordion type="multiple" className="space-y-3" value={openRooms} onValueChange={(v) => setOpenRooms(v as string[])}>
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
                        const selectedSubItems = selectedOpts.flatMap((opt) => subItemsByOption.get(opt.id) || []);
                        const selectionLabel = selectedOpt
                          ? selectedOpt.title || "Selected option"
                          : selectedOpts.length > 1
                            ? `${selectedOpts.length} selected`
                            : null;
                        const displayPrice = effectiveTotals.get(it.id) ?? null;
                        const storeKeyForItem = storeAllocation.itemStoreKey.get(it.id) || null;
                        const storeSummary = storeKeyForItem ? storeAllocation.storeTotals.get(storeKeyForItem) || null : null;
                        const hasStoreAdjustments = Boolean(
                          storeSummary && (storeSummary.storeDiscount || storeSummary.storeShipping || storeSummary.storeWarranty || storeSummary.storeTax),
                        );
                        const appliedItemId = storeSummary?.appliedItemId || null;
                        const appliedName = appliedItemId ? itemNameById.get(appliedItemId) || null : null;
                        const isPlaceholder = inferItemKind(it, itemOpts.length > 0) === "placeholder";
                        const displayStore = selectedOpt?.store || (!isPlaceholder ? it.store : null);
                        const openOptions = Boolean(openItemOptions[it.id]);
                        const openOptReorder = Boolean(reorderOptionsForItem[it.id]);
                        const modifiedFields = Array.isArray(it.provenance?.modifiedFields) ? it.provenance.modifiedFields : [];
                        const canDragToPlaceholder = !isPlaceholder && !itemOpts.length;
                        const isDropTarget = dropTargetItemId === it.id;
                        const dropBusy = dropBusyItemId === it.id;
                        return (
                          <Card
                            key={it.id}
                            className={[
                              "p-3 transition-colors",
                              isDropTarget ? "border-primary/70 bg-primary/5" : "",
                              isPlaceholder
                                ? "border-emerald-300/60 bg-emerald-50/50"
                                : selectionLabel ? "border-primary/20 bg-secondary/30" : "",
                            ].join(" ")}
                          >
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

                                    // If placeholder, toggle open/close
                                    if (isPlaceholder) {
                                      setOpenItemOptions((cur) => ({ ...cur, [it.id]: !openOptions }));
                                      return;
                                    }

                                    nav(`/items/${it.id}`);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      if (isPlaceholder) {
                                        setOpenItemOptions((cur) => ({ ...cur, [it.id]: !openOptions }));
                                      } else {
                                        nav(`/items/${it.id}`);
                                      }
                                    }
                                  }}
                                >
                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1 font-semibold leading-tight text-base">
                                        {it.name}
                                        {selectionLabel ? (
                                          <span className="font-normal text-muted-foreground"> · {selectionLabel}</span>
                                        ) : null}
                                      </div>
                                      <StatusBadge status={it.status} size="sm" className="shrink-0" />
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge
                                        variant="outline"
                                        className={
                                          isPlaceholder
                                            ? "border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-900 shadow-sm hover:bg-emerald-100"
                                            : "border border-slate-300/90 bg-gradient-to-r from-slate-100 to-zinc-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-700 shadow-sm hover:from-slate-100 hover:to-zinc-100"
                                        }
                                      >
                                        {isPlaceholder ? "Placeholder" : "Item"}
                                      </Badge>

                                      <ReviewStatusBadge status={it.provenance?.reviewStatus} />
                                      <DataSourceBadge dataSource={it.provenance?.dataSource} />

                                      {modifiedFields.length ? (
                                        <span className="text-[10px] text-muted-foreground">
                                          Mod: {modifiedFields.slice(0, 2).join(", ")}
                                          {modifiedFields.length > 2 ? ` +${modifiedFields.length - 2}` : ""}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                    <span className="truncate">{it.category || "Other"}</span>
                                    {displayStore ? <span className="truncate">{displayStore}</span> : null}
                                    {displayPrice !== null ? <span>{formatMoneyUSD(displayPrice)}</span> : <span className="italic">no price</span>}
                                    {it.qty !== 1 && !itemOpts.length ? <span>qty {it.qty}</span> : null}
                                    {it.priority ? <span>P{it.priority}</span> : null}
                                    {selectedSubItems.length ? <span>{selectedSubItems.length} sub-item(s)</span> : null}
                                    {selectedOpt ? (
                                      <span className="text-muted-foreground">
                                        Selected option{it.qty !== 1 ? ` · qty ${it.qty}` : ""}
                                      </span>
                                    ) : selectedOpts.length > 1 ? (
                                      <span className="text-muted-foreground">Selected: {selectedOpts.length} options</span>
                                    ) : itemOpts.length ? (
                                      <span>{itemOpts.length} option(s)</span>
                                    ) : null}
                                    {storeSummary ? (
                                      <span className="text-muted-foreground">
                                        Store total {formatMoneyUSD(storeSummary.total)}
                                        {storeSummary.storeDiscount ? ` · discount -${formatMoneyUSD(storeSummary.storeDiscount)}` : ""}
                                        {storeSummary.storeShipping ? ` · shipping ${formatMoneyUSD(storeSummary.storeShipping)}` : ""}
                                        {storeSummary.storeWarranty ? ` · warranty ${formatMoneyUSD(storeSummary.storeWarranty)}` : ""}
                                        {storeSummary.storeTax ? ` · tax ${formatMoneyUSD(storeSummary.storeTax)}` : ""}
                                        {hasStoreAdjustments
                                          ? appliedItemId === it.id
                                            ? " · store adjustments applied here"
                                            : appliedName
                                              ? ` · store adjustments on ${appliedName}`
                                              : " · store adjustments on another item"
                                          : ""}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                {itemOpts.length ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="mt-3 h-8 w-full justify-between px-3 text-xs font-medium text-foreground hover:bg-secondary/80 sm:w-auto sm:justify-center"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenItemOptions((cur) => ({ ...cur, [it.id]: !openOptions }));
                                    }}
                                  >
                                    <span>{openOptions ? "Hide variations" : `Show variations (${itemOpts.length})`}</span>
                                    <ChevronDown className={["h-4 w-4 transition-transform", openOptions ? "rotate-180" : ""].join(" ")} />
                                  </Button>
                                ) : null}
                                {canDragToPlaceholder ? (
                                  <button
                                    type="button"
                                    draggable
                                    onDragStart={(e) => {
                                      setDraggingItemId(it.id);
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData("text/plain", it.id);
                                    }}
                                    onDragEnd={() => {
                                      setDraggingItemId(null);
                                      setDropTargetItemId(null);
                                    }}
                                    className="mt-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                                  >
                                    Drag to placeholder
                                  </button>
                                ) : null}
                                {isPlaceholder ? (
                                  <div
                                    className={[
                                      "mt-2 rounded-lg border border-dashed px-3 py-2 text-xs",
                                      isDropTarget ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground",
                                    ].join(" ")}
                                    onDragOver={(e) => {
                                      const sourceId = e.dataTransfer.getData("text/plain") || draggingItemId || "";
                                      if (!sourceId || sourceId === it.id) return;
                                      e.preventDefault();
                                      if (dropTargetItemId !== it.id) setDropTargetItemId(it.id);
                                    }}
                                    onDragLeave={() => {
                                      if (dropTargetItemId === it.id) setDropTargetItemId(null);
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      const sourceId = e.dataTransfer.getData("text/plain") || draggingItemId || "";
                                      if (!sourceId) return;
                                      void onDropItemIntoPlaceholder(it.id, sourceId);
                                    }}
                                  >
                                    {dropBusy
                                      ? "Adding variation..."
                                      : isDropTarget
                                        ? "Release to add as variation"
                                        : "Drop standalone items here to add variations"}
                                  </div>
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
                                      const total = optionTotalOrNull(opt);
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
                                      const total = optionTotalOrNull(opt);
                                      const isSelected = selectedOpt?.id === opt.id || opt.selected;
                                      return (
                                        <div
                                          key={opt.id}
                                          className={[
                                            "flex flex-wrap items-center gap-3 rounded-xl border p-2.5 sm:p-3",
                                            isSelected
                                              ? "border-sky-300/90 bg-gradient-to-r from-sky-50/95 to-cyan-50/70 ring-1 ring-sky-200/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
                                              : "border-slate-300 bg-slate-100/80",
                                          ].join(" ")}
                                        >
                                          <OptionPhotoStrip optionId={opt.id} />
                                          <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <div className="truncate text-sm font-semibold">{opt.title}</div>
                                              {isSelected ? (
                                                <Badge className="border border-sky-300/90 bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.01em] text-sky-900 shadow-sm hover:bg-sky-100">Selected</Badge>
                                              ) : (
                                                <Badge variant="secondary">Option</Badge>
                                              )}
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                              {opt.store ? <span>{opt.store}</span> : null}
                                              {typeof opt.priority === "number" ? <span>P{opt.priority}</span> : null}
                                              {total ? <span>{formatMoneyUSD(total)}</span> : <span className="italic">no total</span>}
                                              {optionDiscountLabel(opt) ? <span>{optionDiscountLabel(opt)}</span> : null}
                                              {isSelected && it.qty !== 1 ? <span>qty {it.qty}</span> : null}
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
    <div className="w-[80px] shrink-0 space-y-2 sm:w-[120px]">
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
