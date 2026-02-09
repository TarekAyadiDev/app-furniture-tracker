import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { ReviewStatusBadge } from "@/components/ReviewStatusBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { DragReorderList } from "@/components/reorder/DragReorderList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/data/DataContext";
import { ITEM_STATUSES, type DataSource, type Item, type ItemStatus, type Option, type ReviewStatus, type RoomId } from "@/lib/domain";
import { formatMoneyUSD, nowMs, parseNumberOrNull } from "@/lib/format";
import { computeItemFitWarnings } from "@/lib/fit";
import { markProvenanceNeedsReview, markProvenanceVerified } from "@/lib/provenance";
import { useToast } from "@/hooks/use-toast";
import { shareData } from "@/lib/share";
import { addAttachment, addAttachmentFromBlob, deleteAttachment, listAttachments, type AttachmentRecord } from "@/storage/attachments";
import { buildStoreIndex, optionTotalWithStore, storeKey } from "@/lib/storePricing";

function optionPreDiscountTotalOrNull(o: Option): number | null {
  const hasAny =
    typeof o.price === "number" ||
    typeof o.shipping === "number" ||
    typeof o.taxEstimate === "number";
  if (!hasAny) return null;
  return (o.price || 0) + (o.shipping || 0) + (o.taxEstimate || 0);
}

function optionDiscountAmount(o: Option): number {
  const value = typeof o.discountValue === "number" ? o.discountValue : null;
  const type = o.discountType === "percent" || o.discountType === "amount" ? o.discountType : null;
  if (value !== null && value > 0) {
    if (type === "amount") return value;
    if (type === "percent") {
      const base = optionPreDiscountTotalOrNull(o);
      if (base === null) return 0;
      if (value >= 100) return base;
      return (base * value) / 100;
    }
  }
  return typeof o.discount === "number" ? o.discount : 0;
}

function optionDiscountLabel(o: Option) {
  const value = typeof o.discountValue === "number" ? o.discountValue : typeof o.discount === "number" ? o.discount : null;
  if (value === null || value <= 0) return null;
  if (o.discountType === "percent") return `disc -${value}%`;
  return `disc -${formatMoneyUSD(value)}`;
}

const CATEGORY_PRESETS: Record<string, string[]> = {
  Bed: ["size", "type", "headboard", "finish"],
  Mattress: ["size", "firmness", "material", "thickness_in"],
  Sofa: ["type", "length_in", "depth_in", "fabric", "color"],
  "TV Console": ["width_in", "depth_in", "storage", "finish"],
  TV: ["size_in", "resolution", "mount", "inputs"],
  "Dining Table": ["shape", "length_in", "width_in", "seats"],
  "Coffee Table": ["shape", "length_in", "width_in", "height_in", "material"],
  Dresser: ["width_in", "depth_in", "drawers", "finish"],
  Desk: ["width_in", "depth_in", "cable", "storage"],
  Rug: ["size", "material", "pile"],
  Curtains: ["window_width_in", "rod_length_in", "length_in", "color"],
  Outdoor: ["type", "seats", "material", "weather_rating"],
};

function findPreset(category: string) {
  const c = (category || "").trim().toLowerCase();
  if (!c) return null;
  for (const [name, keys] of Object.entries(CATEGORY_PRESETS)) {
    if (c.includes(name.toLowerCase())) return { name, keys };
  }
  return null;
}

function parseSpecValue(raw: string): string | number | boolean | null {
  const t = raw.trim();
  if (!t) return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? n : t;
  }
  return t;
}

function includesText(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function normalizeLink(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function formatDimensions(opt: Option) {
  if (opt.dimensionsText && opt.dimensionsText.trim()) return opt.dimensionsText.trim();
  const w = opt.dimensions?.wIn;
  const d = opt.dimensions?.dIn;
  const h = opt.dimensions?.hIn;
  if (w === null && d === null && h === null) return "-";
  if (typeof w === "undefined" && typeof d === "undefined" && typeof h === "undefined") return "-";
  const parts = [w ? `${w}w` : null, d ? `${d}d` : null, h ? `${h}h` : null].filter(Boolean);
  return parts.length ? `${parts.join(" x ")} in` : "-";
}

function formatSpecs(specs: Option["specs"]) {
  if (!specs || typeof specs !== "object") return "-";
  const entries = Object.entries(specs);
  if (!entries.length) return "-";
  return entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}: ${v === null || typeof v === "undefined" ? "" : String(v)}`)
    .join(", ");
}

function pickBestOptionId(options: Option[], getTotal: (opt: Option) => number | null): string | null {
  if (!options.length) return null;
  const hasPriority = options.some((o) => typeof o.priority === "number");
  const sorted = options.slice().sort((a, b) => {
    if (hasPriority) {
      const pa = typeof a.priority === "number" ? a.priority : 999999;
      const pb = typeof b.priority === "number" ? b.priority : 999999;
      if (pa !== pb) return pa - pb;
    }
    const ta = getTotal(a);
    const tb = getTotal(b);
    if (ta === null && tb !== null) return 1;
    if (tb === null && ta !== null) return -1;
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });
  return sorted[0]?.id ?? null;
}

function normalizeDimensionsInput(input: { wIn?: number | null; dIn?: number | null; hIn?: number | null }) {
  const next: { wIn?: number | null; dIn?: number | null; hIn?: number | null } = {};
  if (typeof input.wIn === "number" || input.wIn === null) next.wIn = input.wIn;
  if (typeof input.dIn === "number" || input.dIn === null) next.dIn = input.dIn;
  if (typeof input.hIn === "number" || input.hIn === null) next.hIn = input.hIn;
  const hasValue = [next.wIn, next.dIn, next.hIn].some((v) => typeof v === "number");
  return hasValue ? next : undefined;
}

export default function ItemDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { toast } = useToast();
  const {
    orderedRooms,
    roomNameById,
    measurements,
    items,
    options,
    stores,
    reorderOptions,
    renameCategory,
    createItem,
    updateItem,
    deleteItem,
    convertItemToOption,
    createOption,
    updateOption,
    deleteOption,
    sortAndFilterOptions,
  } = useData();

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);
  const storeByName = useMemo(() => buildStoreIndex(stores), [stores]);
  const orderedStores = useMemo(
    () =>
      stores
        .filter((s) => s.syncState !== "deleted")
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stores],
  );

  const item = useMemo(() => items.find((x) => x.id === id), [items, id]);
  const storeForItem = useMemo(() => (item ? storeByName.get(storeKey(item.store)) || null : null), [item, storeByName]);
  const itemOptions = useMemo(
    () =>
      options
        .filter((o) => o.syncState !== "deleted" && o.itemId === id)
        .sort((a, b) => {
          const sa = typeof a.sort === "number" ? a.sort : 999999;
          const sb = typeof b.sort === "number" ? b.sort : 999999;
          if (sa !== sb) return sa - sb;
          return b.updatedAt - a.updatedAt;
        }),
    [options, id],
  );

  const optionTotalOrNull = useMemo(
    () => (opt: Option) => optionTotalWithStore(opt, storeByName.get(storeKey(opt.store)) || null),
    [storeByName],
  );

  const optionFinalTotal = useMemo(() => (opt: Option) => optionTotalOrNull(opt) ?? 0, [optionTotalOrNull]);

  const [itemAttachments, setItemAttachments] = useState<AttachmentRecord[]>([]);
  const [optionAttachments, setOptionAttachments] = useState<Record<string, AttachmentRecord[]>>({});

  const [name, setName] = useState("");
  const [room, setRoom] = useState<RoomId>("Living");
  const [category, setCategory] = useState("Other");
  const [status, setStatus] = useState<ItemStatus>("Idea");
  const [price, setPrice] = useState("");
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [discountValue, setDiscountValue] = useState("");
  const [qty, setQty] = useState("1");
  const [store, setStore] = useState("");
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState("");
  const [dimW, setDimW] = useState("");
  const [dimD, setDimD] = useState("");
  const [dimH, setDimH] = useState("");
  const [dataSource, setDataSource] = useState<DataSource>(null);
  const [sourceRef, setSourceRef] = useState("");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(null);
  const [openOpt, setOpenOpt] = useState<Record<string, boolean>>({});
  const [optionOnlyId, setOptionOnlyId] = useState<string | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [newSpecKey, setNewSpecKey] = useState("");
  const [newSpecVal, setNewSpecVal] = useState("");
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [optSortKey, setOptSortKey] = useState<"price" | "priority" | "name">("price");
  const [optSortDir, setOptSortDir] = useState<"asc" | "desc">("asc");
  const [optMinPrice, setOptMinPrice] = useState("");
  const [optMaxPrice, setOptMaxPrice] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
  const [optionPage, setOptionPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [importQuery, setImportQuery] = useState("");
  const [importSelectedId, setImportSelectedId] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [optionSpecDrafts, setOptionSpecDrafts] = useState<Record<string, { key: string; value: string }>>({});

  const filteredOptions = useMemo(() => {
    if (!item) return [];
    return sortAndFilterOptions(item.id, {
      sortKey: optSortKey,
      sortDir: optSortDir,
      minPrice: parseNumberOrNull(optMinPrice),
      maxPrice: parseNumberOrNull(optMaxPrice),
    });
  }, [item, optSortKey, optSortDir, optMinPrice, optMaxPrice, sortAndFilterOptions]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredOptions.length / pageSize));
  const pagedOptions = useMemo(() => {
    const start = (optionPage - 1) * pageSize;
    return filteredOptions.slice(start, start + pageSize);
  }, [filteredOptions, optionPage]);

  const selectedOptionId = useMemo(() => {
    if (!item) return null;
    return item.selectedOptionId || itemOptions.find((o) => o.selected)?.id || null;
  }, [item, itemOptions]);

  const selectedOption = useMemo(() => {
    if (!selectedOptionId) return null;
    return itemOptions.find((o) => o.id === selectedOptionId) || null;
  }, [itemOptions, selectedOptionId]);

  const optionOnlyOption = useMemo(() => {
    if (!optionOnlyId) return null;
    return itemOptions.find((o) => o.id === optionOnlyId) || null;
  }, [itemOptions, optionOnlyId]);

  const optionOnly = Boolean(optionOnlyOption);

  const bestOptionId = useMemo(() => pickBestOptionId(filteredOptions, optionTotalOrNull), [filteredOptions, optionTotalOrNull]);

  const optionsToRender = useMemo(() => {
    if (optionOnlyOption) return [optionOnlyOption];
    return reorderMode ? itemOptions : pagedOptions;
  }, [itemOptions, optionOnlyOption, pagedOptions, reorderMode]);

  const optionsCount = optionOnly ? 1 : reorderMode ? itemOptions.length : filteredOptions.length;

  const childOptionsLabel = useMemo(() => {
    if (!itemOptions.length) return "None";
    const names = itemOptions.slice(0, 3).map((o) => o.title).join(", ");
    if (!names) return `${itemOptions.length} option(s)`;
    return `${itemOptions.length} option(s) — ${names}${itemOptions.length > 3 ? " +" + (itemOptions.length - 3) : ""}`;
  }, [itemOptions]);

  const importedSourceItemIds = useMemo(() => {
    const set = new Set<string>();
    for (const opt of options) {
      if (opt.syncState === "deleted") continue;
      if (opt.sourceItemId) set.add(opt.sourceItemId);
    }
    return set;
  }, [options]);

  const existingParentLinks = useMemo(() => {
    const set = new Set<string>();
    for (const opt of itemOptions) {
      const link = normalizeLink(opt.link || "");
      if (link) set.add(link);
    }
    return set;
  }, [itemOptions]);

  const importCandidates = useMemo(() => {
    if (!item) return [];
    const needle = importQuery.trim().toLowerCase();
    return items
      .filter((i) => i.syncState !== "deleted")
      .filter((i) => i.id !== item.id)
      .filter((i) => !importedSourceItemIds.has(i.id))
      .filter((i) => {
        const link = normalizeLink(i.link || "");
        if (link && existingParentLinks.has(link)) return false;
        return true;
      })
      .filter((i) => {
        if (!needle) return true;
        const tagBlob = Array.isArray(i.tags) ? i.tags.join(" ") : "";
        const blob = `${i.name} ${i.store || ""} ${i.category || ""} ${i.notes || ""} ${tagBlob}`;
        return includesText(blob, needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [existingParentLinks, importQuery, importedSourceItemIds, item, items]);

  const roomMeasurements = useMemo(() => {
    return measurements.filter((m) => m.syncState !== "deleted" && m.room === item?.room);
  }, [measurements, item?.room]);

  const fitWarnings = useMemo(() => {
    if (!item) return [];
    return computeItemFitWarnings(item, roomMeasurements);
  }, [item, roomMeasurements]);

  useEffect(() => {
    if (!item) return;
    setName(item.name);
    setRoom(item.room);
    setCategory(item.category || "Other");
    setStatus(item.status);
    setPrice(item.price === null || item.price === undefined ? "" : String(item.price));
    setDiscountType(item.discountType === "percent" ? "percent" : "amount");
    setDiscountValue(item.discountValue === null || item.discountValue === undefined ? "" : String(item.discountValue));
    setQty(String(item.qty || 1));
    setStore(item.store || "");
    setLink(item.link || "");
    setNotes(item.notes || "");
    setPriority(item.priority === null || item.priority === undefined ? "" : String(item.priority));
    setDimW(item.dimensions?.wIn ? String(item.dimensions.wIn) : "");
    setDimD(item.dimensions?.dIn ? String(item.dimensions.dIn) : "");
    setDimH(item.dimensions?.hIn ? String(item.dimensions.hIn) : "");
    setDataSource(item.provenance?.dataSource ?? null);
    setSourceRef(item.provenance?.sourceRef || "");
    setReviewStatus(item.provenance?.reviewStatus ?? null);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    let active = true;
    listAttachments("item", item.id)
      .then((rows) => {
        if (active) setItemAttachments(rows);
      })
      .catch(() => {
        if (active) setItemAttachments([]);
      });
    return () => {
      active = false;
    };
  }, [item?.id]);

  useEffect(() => {
    let active = true;
    async function loadOptionAttachments() {
      if (!itemOptions.length) {
        if (active) setOptionAttachments({});
        return;
      }
      const entries = await Promise.all(
        itemOptions.map(async (opt) => {
          const rows = await listAttachments("option", opt.id);
          return [opt.id, rows] as const;
        }),
      );
      if (!active) return;
      const next: Record<string, AttachmentRecord[]> = {};
      for (const [optId, rows] of entries) next[optId] = rows;
      setOptionAttachments(next);
    }
    void loadOptionAttachments();
    return () => {
      active = false;
    };
  }, [itemOptions]);

  useEffect(() => {
    setOptionPage(1);
  }, [item?.id, optSortKey, optSortDir, optMinPrice, optMaxPrice]);

  useEffect(() => {
    if (optionPage > totalPages) setOptionPage(totalPages);
  }, [optionPage, totalPages]);

  async function commit(patch: Partial<Item>) {
    await updateItem(item.id, patch);
  }

  function computeDiscountAmount(priceValue: number | null, type: "amount" | "percent", value: number | null): number | null {
    if (value === null || value <= 0) return null;
    if (type === "amount") return value;
    if (priceValue === null) return null;
    if (value >= 100) return null;
    return (priceValue * value) / 100;
  }

  const priceValue = parseNumberOrNull(price);
  const discountValueNum = parseNumberOrNull(discountValue);
  const itemDiscountAmount = computeDiscountAmount(priceValue, discountType, discountValueNum) || 0;
  const storeDiscountAmount =
    storeForItem && (storeForItem.discountType === "amount" || storeForItem.discountType === "percent")
      ? computeDiscountAmount(priceValue, storeForItem.discountType, storeForItem.discountValue ?? null) || 0
      : 0;
  const effectivePriceValue = priceValue === null ? null : Math.max(0, priceValue - itemDiscountAmount - storeDiscountAmount);
  const inheritedItemPhotos = selectedOptionId ? optionAttachments[selectedOptionId] || [] : [];
  const inheritedItemPhotoLabel = selectedOption ? `Using photos from "${selectedOption.title}".` : undefined;

  async function onSelectStatus(s: ItemStatus) {
    setStatus(s);
    await commit({ status: s });
  }

  async function onDeleteItem() {
    if (!confirm(`Delete "${item.name}"?`)) return;
    const itemAtts = itemAttachments.length ? itemAttachments : await listAttachments("item", item.id);
    await Promise.all(itemAtts.map((att) => deleteAttachment(att.id)));
    for (const opt of itemOptions) {
      const optAtts = optionAttachments[opt.id] || (await listAttachments("option", opt.id));
      await Promise.all(optAtts.map((att) => deleteAttachment(att.id)));
    }
    await deleteItem(item.id);
    nav("/items");
  }

  function buildCopyName(base: string) {
    const name = base.trim() || "New item";
    const existing = new Set(items.filter((i) => i.syncState !== "deleted").map((i) => i.name));
    if (!existing.has(`${name} (copy)`)) return `${name} (copy)`;
    let idx = 2;
    while (existing.has(`${name} (copy ${idx})`)) idx += 1;
    return `${name} (copy ${idx})`;
  }

  function buildCopyOptionTitle(base: string) {
    const title = base.trim() || "Option";
    const existing = new Set(itemOptions.filter((o) => o.syncState !== "deleted").map((o) => o.title));
    if (!existing.has(`${title} (copy)`)) return `${title} (copy)`;
    let idx = 2;
    while (existing.has(`${title} (copy ${idx})`)) idx += 1;
    return `${title} (copy ${idx})`;
  }

  async function onDuplicateItem() {
    if (duplicateBusy) return;
    setDuplicateBusy(true);
    const maxAttachments = 3;
    try {
      const copyName = buildCopyName(item.name);
      const newId = await createItem({
        name: copyName,
        room: item.room,
        category: item.category,
        status: item.status,
        price: item.price ?? null,
        discountType: item.discountType ?? null,
        discountValue: item.discountValue ?? null,
        qty: item.qty ?? 1,
        store: item.store ?? null,
        link: item.link ?? null,
        notes: item.notes ?? null,
        priority: item.priority ?? null,
        tags: item.tags ? [...item.tags] : null,
        dimensions: item.dimensions ? { ...item.dimensions } : undefined,
        specs: item.specs ? { ...item.specs } : null,
      });

      const itemAtts = itemAttachments.length ? itemAttachments : await listAttachments("item", item.id);
      await Promise.all(
        itemAtts.slice(0, maxAttachments).map((att) =>
          addAttachmentFromBlob("item", newId, att.blob, { name: att.name ?? null, sourceUrl: att.sourceUrl ?? null }),
        ),
      );

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
        const optAtts = optionAttachments[oldId] || (await listAttachments("option", oldId));
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
      setDuplicateBusy(false);
    }
  }

  async function onDeleteOption(opt: Option) {
    const optAtts = optionAttachments[opt.id] || (await listAttachments("option", opt.id));
    await Promise.all(optAtts.map((att) => deleteAttachment(att.id)));
    await deleteOption(opt.id);
  }

  async function onDuplicateOption(opt: Option) {
    const maxAttachments = 3;
    const titleCopy = buildCopyOptionTitle(opt.title);
    try {
      const newOptId = await createOption({
        itemId: item.id,
        title: titleCopy,
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
        selected: false,
      });
      const optAtts = optionAttachments[opt.id] || (await listAttachments("option", opt.id));
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

  async function onShareItem() {
    const roomLabel = roomNameById.get(item.room) || item.room;
    const priceVal = typeof item.price === "number" ? item.price : null;
    const itemDiscount = computeDiscountAmount(
      priceVal,
      item.discountType === "percent" ? "percent" : "amount",
      typeof item.discountValue === "number" ? item.discountValue : null,
    ) || 0;
    const storeDiscount =
      storeForItem && (storeForItem.discountType === "amount" || storeForItem.discountType === "percent")
        ? computeDiscountAmount(priceVal, storeForItem.discountType, storeForItem.discountValue ?? null) || 0
        : 0;
    const shareDiscount = itemDiscount + storeDiscount;
    const shareTotal = priceVal === null ? null : Math.max(0, priceVal - shareDiscount);
    const parts = [
      item.name,
      roomLabel ? `Room: ${roomLabel}` : "",
      item.status ? `Status: ${item.status}` : "",
      shareTotal !== null ? `Total: ${formatMoneyUSD(shareTotal)}` : "",
      item.store ? `Store: ${item.store}` : "",
      item.link ? `Link: ${item.link}` : "",
    ].filter(Boolean);
    const text = parts.join("\n");
    const url = item.link || (typeof window !== "undefined" ? window.location.href : undefined);
    try {
      const res = await shareData({ title: item.name, text, url });
      const label = res.method === "share" ? "Shared" : res.method === "clipboard" ? "Copied" : "Ready";
      toast({ title: label, description: "Item details ready to share." });
    } catch (err: any) {
      toast({ title: "Share failed", description: err?.message || "Unable to share this item." });
    }
  }

  async function onShareOption(opt: Option) {
    const roomLabel = roomNameById.get(item.room) || item.room;
    const total = optionFinalTotal(opt);
    const parts = [
      `${opt.title} (${item.name})`,
      roomLabel ? `Room: ${roomLabel}` : "",
      opt.store ? `Store: ${opt.store}` : "",
      total ? `Total: ${formatMoneyUSD(total)}` : "",
      opt.link ? `Link: ${opt.link}` : "",
    ].filter(Boolean);
    const text = parts.join("\n");
    const url = opt.link || item.link || (typeof window !== "undefined" ? window.location.href : undefined);
    try {
      const res = await shareData({ title: opt.title, text, url });
      const label = res.method === "share" ? "Shared" : res.method === "clipboard" ? "Copied" : "Ready";
      toast({ title: label, description: "Option details ready to share." });
    } catch (err: any) {
      toast({ title: "Share failed", description: err?.message || "Unable to share this option." });
    }
  }

  async function onAddOption() {
    const title = prompt("Option title (e.g. IKEA - MALM dresser)")?.trim();
    if (!title) return;
    await createOption({ itemId: item.id, title });
  }

  async function onImportExistingItem() {
    if (!item || !importSelectedId || importBusy) return;
    setImportBusy(true);
    try {
      await convertItemToOption(item.id, importSelectedId);
      toast({ title: "Imported", description: "Imported as option and removed from room list." });
      setImportOpen(false);
      setImportSelectedId(null);
      setImportQuery("");
    } catch (err: any) {
      toast({ title: "Import failed", description: err?.message || "Could not import item." });
    } finally {
      setImportBusy(false);
    }
  }

  async function refreshAttachments(parentType: "item" | "option", parentId: string) {
    const rows = await listAttachments(parentType, parentId);
    if (parentType === "item") {
      setItemAttachments(rows);
    } else {
      setOptionAttachments((cur) => ({ ...cur, [parentId]: rows }));
    }
  }

  async function handleAddAttachments(parentType: "item" | "option", parentId: string, files: FileList | null) {
    if (!files || !files.length) return;
    const existing = parentType === "item" ? itemAttachments : optionAttachments[parentId] || [];
    const remainingSlots = 3 - existing.length;
    if (remainingSlots <= 0) {
      toast({ title: "Limit reached", description: "Up to 3 photos per item/option." });
      return;
    }
    const incoming = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, remainingSlots);
    if (!incoming.length) {
      toast({ title: "Unsupported file", description: "Please choose an image file." });
      return;
    }
    try {
      await Promise.all(incoming.map((file) => addAttachment(parentType, parentId, file)));
      await refreshAttachments(parentType, parentId);
    } catch (err: any) {
      toast({ title: "Photo upload failed", description: err?.message || "Could not upload photo." });
    }
  }

  async function handleRemoveAttachment(parentType: "item" | "option", parentId: string, attachmentId: string) {
    await deleteAttachment(attachmentId);
    await refreshAttachments(parentType, parentId);
  }

  async function onSelectOption(optionId: string) {
    const others = itemOptions.filter((o) => o.id !== optionId);
    await Promise.all([
      updateOption(optionId, { selected: true }),
      ...others.map((o) => updateOption(o.id, { selected: false })),
    ]);
    const chosen = itemOptions.find((o) => o.id === optionId);
    if (chosen) {
      const preDiscount = optionPreDiscountTotalOrNull(chosen);
      const optDiscountType =
        chosen.discountType === "percent" || chosen.discountType === "amount"
          ? chosen.discountType
          : typeof chosen.discount === "number"
            ? "amount"
            : null;
      const optDiscountValue =
        typeof chosen.discountValue === "number" ? chosen.discountValue : typeof chosen.discount === "number" ? chosen.discount : null;
      const next: Partial<Item> = {
        status: "Selected",
        selectedOptionId: chosen.id,
        name: chosen.title || item.name,
        store: chosen.store ?? null,
        link: chosen.link ?? null,
        price: preDiscount ?? null,
        discountType: optDiscountType,
        discountValue: optDiscountValue,
        priority: typeof chosen.priority === "number" ? chosen.priority : null,
        tags: chosen.tags ? [...chosen.tags] : null,
        dimensions: chosen.dimensions ? { ...chosen.dimensions } : undefined,
        specs: chosen.specs ? { ...chosen.specs } : null,
        notes: typeof chosen.notes === "string" ? chosen.notes : null,
      };
      await commit(next);
    } else {
      await commit({ status: "Selected" });
    }
  }

  const optionToOpen = useMemo(() => {
    const sp = new URLSearchParams(loc.search);
    const v = sp.get("option");
    return v && v.trim() ? v.trim() : null;
  }, [loc.search]);

  useEffect(() => {
    if (!optionToOpen) return;
    if (!itemOptions.some((o) => o.id === optionToOpen)) return;
    setOptionOnlyId(optionToOpen);
    setOpenOpt((cur) => ({ ...cur, [optionToOpen]: true }));
    nav({ pathname: loc.pathname, search: "" }, { replace: true });
  }, [itemOptions, loc.pathname, nav, optionToOpen]);

  useEffect(() => {
    if (!optionOnlyId) return;
    if (!itemOptions.some((o) => o.id === optionOnlyId)) {
      setOptionOnlyId(null);
    }
  }, [itemOptions, optionOnlyId]);

  useEffect(() => {
    if (!optionOnlyId) return;
    setReorderMode(false);
    setCompareOpen(false);
  }, [optionOnlyId]);

  const itemModifiedFields = Array.isArray(item?.provenance?.modifiedFields) ? item?.provenance?.modifiedFields : [];

  if (!id) return null;
  if (!item) {
    return (
      <Card className="p-4">
        <div className="space-y-2">
          <div className="text-base font-semibold">Item not found</div>
          <Button variant="secondary" onClick={() => nav("/items")}>
            Back to Items
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{roomNameById.get(item.room) || item.room}</div>
            <div className="truncate text-lg font-semibold">{item.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge status={item.status} />
              <ReviewStatusBadge status={item.provenance?.reviewStatus} />
              <DataSourceBadge dataSource={item.provenance?.dataSource} />
              {effectivePriceValue !== null ? <span className="text-sm font-semibold">{formatMoneyUSD(effectivePriceValue)}</span> : null}
              {item.store ? <span className="text-sm text-muted-foreground">{item.store}</span> : null}
            </div>
            {itemModifiedFields.length ? (
              <div className="mt-2 text-xs text-muted-foreground">
                Changed: {itemModifiedFields.slice(0, 6).join(", ")}
                {itemModifiedFields.length > 6 ? ` +${itemModifiedFields.length - 6}` : ""}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            {optionOnly ? (
              <Button variant="secondary" onClick={() => setOptionOnlyId(null)}>
                View parent details
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => void onShareItem()}>
                  Share
                </Button>
                <Button variant="secondary" onClick={() => void onDuplicateItem()} disabled={duplicateBusy}>
                  Duplicate
                </Button>
                <Button variant="destructive" onClick={() => void onDeleteItem()}>
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>

        {optionOnly ? (
          <div className="mt-4 rounded-lg border bg-secondary/30 p-3 text-sm">
            <div className="font-medium">Parent item hidden in option edit mode.</div>
            <div className="mt-1 text-xs text-muted-foreground">Use “View parent details” to edit the parent item.</div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <div className="text-sm font-medium">One-tap status</div>
              <div className="flex flex-wrap gap-2">
                {ITEM_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void onSelectStatus(s)}
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

            <div className="rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Review & source</div>
                  <div className="mt-1 text-xs text-muted-foreground">Mark verified to clear AI/needs-review flags.</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const at = nowMs();
                      const base = {
                        ...(item.provenance || {}),
                        dataSource,
                        sourceRef: sourceRef.trim() || null,
                      };
                      void commit({ provenance: markProvenanceVerified(base, at) });
                    }}
                  >
                    Mark verified
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const at = nowMs();
                      const base = {
                        ...(item.provenance || {}),
                        dataSource,
                        sourceRef: sourceRef.trim() || null,
                      };
                      void commit({ provenance: markProvenanceNeedsReview(base, at) });
                    }}
                  >
                    Needs review
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Data source</Label>
                  <select
                    value={dataSource || ""}
                    onChange={(e) => {
                      const v = (e.target.value as DataSource) || null;
                      setDataSource(v);
                      void commit({ provenance: { dataSource: v } });
                    }}
                    className="h-11 w-full rounded-md border bg-background px-3 text-base"
                  >
                    <option value="">(none)</option>
                    <option value="concrete">Concrete</option>
                    <option value="estimated">Estimated</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Review status</Label>
                  <select
                    value={reviewStatus || ""}
                    onChange={(e) => {
                      const v = (e.target.value as ReviewStatus) || null;
                      setReviewStatus(v);
                      const at = nowMs();
                      const base = {
                        ...(item.provenance || {}),
                        dataSource,
                        sourceRef: sourceRef.trim() || null,
                        reviewStatus: v,
                      };
                      if (v === "verified") void commit({ provenance: markProvenanceVerified(base, at) });
                      else if (v === "needs_review") void commit({ provenance: markProvenanceNeedsReview(base, at) });
                      else void commit({ provenance: { reviewStatus: v } });
                    }}
                    className="h-11 w-full rounded-md border bg-background px-3 text-base"
                  >
                    <option value="">(none)</option>
                    <option value="needs_review">Needs review</option>
                    <option value="verified">Verified</option>
                    <option value="ai_modified">AI modified</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                <Label>Source ref</Label>
                <Input
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  onBlur={() => void commit({ provenance: { sourceRef: sourceRef.trim() || null } })}
                  className="h-11 text-base"
                  placeholder='e.g. "Floor plan B1.1"'
                />
              </div>
            </div>

            {selectedOption ? (
              <div className="rounded-lg border bg-secondary/40 p-3 text-sm">
                <div className="font-medium">Using selected option: {selectedOption.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">Parent fields reflect the selected option.</div>
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setOptionOnlyId(selectedOption.id);
                      setOpenOpt((cur) => ({ ...cur, [selectedOption.id]: true }));
                    }}
                  >
                    Edit selected option
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="item_name">Name</Label>
                <Input
                  id="item_name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => void commit({ name: name.trim() || "Item" })}
                  className="h-12 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item_room">Room</Label>
                <select
                  id="item_room"
                  value={room}
                  onChange={(e) => {
                    const v = e.target.value as RoomId;
                    setRoom(v);
                    void commit({ room: v });
                  }}
                  className="h-12 w-full rounded-md border bg-background px-3 text-base"
                >
                  {orderedRoomIds.map((r) => (
                    <option key={r} value={r}>
                      {roomNameById.get(r) || r}
                    </option>
                  ))}
                </select>
              </div>
            </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="item_category">Category</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const oldCat = (item.category || "").trim();
                    if (!oldCat) return;
                    const next = prompt(`Rename category "${oldCat}" to:`, oldCat)?.trim();
                    if (!next || next === oldCat) return;
                    void renameCategory(oldCat, next);
                    setCategory(next);
                    void commit({ category: next });
                  }}
                >
                  Rename
                </Button>
              </div>
              <Input
                id="item_category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                onBlur={() => void commit({ category: category.trim() || "Other" })}
                className="h-12 text-base"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item_priority">Priority (1-5)</Label>
              <Input
                id="item_priority"
                inputMode="numeric"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                onBlur={() => {
                  const p = parseNumberOrNull(priority);
                  void commit({ priority: p === null ? null : Math.max(1, Math.min(5, Math.round(p))) });
                }}
                placeholder="1"
                className="h-12 text-base"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="item_price">Price (incl. shipping/tax)</Label>
              <Input
                id="item_price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onBlur={() => void commit({ price: parseNumberOrNull(price) })}
                placeholder="$"
                className="h-12 text-base"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item_qty">Qty</Label>
              <Input
                id="item_qty"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onBlur={() => {
                  const n = parseNumberOrNull(qty);
                  void commit({ qty: n && n > 0 ? Math.round(n) : 1 });
                }}
                className="h-12 text-base"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Discount</Label>
                <div className="flex rounded-full border bg-background p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setDiscountType("amount");
                      void commit({ discountType: "amount" });
                    }}
                    className={[
                      "rounded-full px-3 py-1 text-xs font-medium",
                      discountType === "amount" ? "bg-foreground text-background" : "text-muted-foreground",
                    ].join(" ")}
                  >
                    $
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDiscountType("percent");
                      void commit({ discountType: "percent" });
                    }}
                    className={[
                      "rounded-full px-3 py-1 text-xs font-medium",
                      discountType === "percent" ? "bg-foreground text-background" : "text-muted-foreground",
                    ].join(" ")}
                  >
                    %
                  </button>
                </div>
              </div>
              <Input
                inputMode="decimal"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                onBlur={() => {
                  const v = parseNumberOrNull(discountValue);
                  void commit({ discountType, discountValue: v });
                }}
                placeholder={discountType === "percent" ? "%" : "$"}
                className="h-12 text-base"
              />
              {discountValue ? (
                <div className="text-xs text-muted-foreground">
                  {(() => {
                    const priceVal = parseNumberOrNull(price);
                    const v = parseNumberOrNull(discountValue);
                    const itemAmt = computeDiscountAmount(priceVal, discountType, v) || 0;
                    const storeAmt =
                      storeForItem && (storeForItem.discountType === "amount" || storeForItem.discountType === "percent")
                        ? computeDiscountAmount(priceVal, storeForItem.discountType, storeForItem.discountValue ?? null) || 0
                        : 0;
                    const total = itemAmt + storeAmt;
                    return total ? `Savings: ${formatMoneyUSD(total)}${storeAmt ? " (incl. store)" : ""}` : "Savings: —";
                  })()}
                </div>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Effective total</Label>
              <div className="flex h-12 items-center rounded-md border bg-background px-3 text-sm">
                {(() => {
                  if (priceValue === null) return "—";
                  return formatMoneyUSD(effectivePriceValue ?? priceValue);
                })()}
              </div>
              <div className="text-xs text-muted-foreground">Used for budget totals.</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="item_store">Store</Label>
              <select
                id="item_store"
                value={store}
                onChange={(e) => {
                  const next = e.target.value;
                  setStore(next);
                  void commit({ store: next.trim() || null });
                }}
                className="h-12 w-full rounded-md border bg-background px-3 text-base"
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
              <Label htmlFor="item_link">Link</Label>
              <Input
                id="item_link"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onBlur={() => void commit({ link: link.trim() || null })}
                placeholder="https://"
                className="h-12 text-base"
              />
            </div>
          </div>

          {storeForItem ? (
            <Card className="rounded-2xl border border-border/50 bg-background/70 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-heading text-base font-semibold text-foreground">Store perks</h3>
                  <p className="text-xs text-muted-foreground">Applied alongside item discounts.</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                {typeof storeForItem.discountValue === "number" && storeForItem.discountValue > 0 ? (
                  <div>
                    <div className="font-semibold text-foreground">Discount</div>
                    <div>
                      {storeForItem.discountType === "percent"
                        ? `${storeForItem.discountValue}%`
                        : formatMoneyUSD(storeForItem.discountValue)}
                    </div>
                  </div>
                ) : null}
                {storeForItem.deliveryInfo ? (
                  <div>
                    <div className="font-semibold text-foreground">Delivery</div>
                    <div>{storeForItem.deliveryInfo}</div>
                  </div>
                ) : null}
                {storeForItem.extraWarranty ? (
                  <div>
                    <div className="font-semibold text-foreground">Extra warranty</div>
                    <div>{storeForItem.extraWarranty}</div>
                  </div>
                ) : null}
                {storeForItem.trial ? (
                  <div>
                    <div className="font-semibold text-foreground">Trial</div>
                    <div>{storeForItem.trial}</div>
                  </div>
                ) : null}
                {storeForItem.apr ? (
                  <div>
                    <div className="font-semibold text-foreground">APR</div>
                    <div>{storeForItem.apr}</div>
                  </div>
                ) : null}
              </div>
              {storeForItem.notes ? (
                <div className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">{storeForItem.notes}</div>
              ) : null}
            </Card>
          ) : null}

          <div className="space-y-1.5">
            <Label>Dimensions (in)</Label>
            <div className="grid grid-cols-3 gap-3">
              <Input
                inputMode="decimal"
                value={dimW}
                onChange={(e) => setDimW(e.target.value)}
                onBlur={() =>
                  void commit({
                    dimensions: {
                      wIn: parseNumberOrNull(dimW),
                      dIn: parseNumberOrNull(dimD),
                      hIn: parseNumberOrNull(dimH),
                    },
                  })
                }
                placeholder="W"
                className="h-12 text-base"
              />
              <Input
                inputMode="decimal"
                value={dimD}
                onChange={(e) => setDimD(e.target.value)}
                onBlur={() =>
                  void commit({
                    dimensions: {
                      wIn: parseNumberOrNull(dimW),
                      dIn: parseNumberOrNull(dimD),
                      hIn: parseNumberOrNull(dimH),
                    },
                  })
                }
                placeholder="D"
                className="h-12 text-base"
              />
              <Input
                inputMode="decimal"
                value={dimH}
                onChange={(e) => setDimH(e.target.value)}
                onBlur={() =>
                  void commit({
                    dimensions: {
                      wIn: parseNumberOrNull(dimW),
                      dIn: parseNumberOrNull(dimD),
                      hIn: parseNumberOrNull(dimH),
                    },
                  })
                }
                placeholder="H"
                className="h-12 text-base"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Fit checks</Label>
            {fitWarnings.length ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <div className="font-semibold">Potential fit issues</div>
                <div className="mt-2 space-y-1">
                  {fitWarnings.map((w) => (
                    <div key={`${w.dim}-${w.message}`}>{w.message}</div>
                  ))}
                </div>
                <div className="mt-3">
                  <Button variant="secondary" onClick={() => nav(`/rooms/${encodeURIComponent(item.room)}`)}>
                    Open room measurements
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No fit warnings (or missing measurements/dimensions).</div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Specs</Label>
              {findPreset(category)?.keys?.length ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const preset = findPreset(category);
                    if (!preset) return;
                    const base = item.specs && typeof item.specs === "object" ? { ...item.specs } : {};
                    for (const k of preset.keys) if (!(k in base)) (base as any)[k] = null;
                    void commit({ specs: base });
                  }}
                >
                  Apply {findPreset(category)?.name} preset
                </Button>
              ) : (
                <div className="text-xs text-muted-foreground">Add key/value attributes for this item.</div>
              )}
            </div>

            <div className="space-y-2">
              {item.specs && typeof item.specs === "object" && Object.keys(item.specs).length ? (
                Object.entries(item.specs)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([k, v]) => (
                    <div key={k} className="grid grid-cols-12 gap-2">
                      <Input value={k} readOnly className="col-span-5 h-11 text-base" />
                      <Input
                        defaultValue={v === null || typeof v === "undefined" ? "" : String(v)}
                        className="col-span-6 h-11 text-base"
                        onBlur={(e) => {
                          const next = item.specs && typeof item.specs === "object" ? { ...item.specs } : {};
                          (next as any)[k] = parseSpecValue(e.target.value);
                          void commit({ specs: next });
                        }}
                      />
                      <Button
                        variant="secondary"
                        className="col-span-1 h-11 px-0"
                        onClick={() => {
                          const next = item.specs && typeof item.specs === "object" ? { ...item.specs } : {};
                          delete (next as any)[k];
                          void commit({ specs: Object.keys(next).length ? next : null });
                        }}
                        aria-label={`Remove spec ${k}`}
                      >
                        &times;
                      </Button>
                    </div>
                  ))
              ) : (
                <div className="text-xs text-muted-foreground">No specs yet.</div>
              )}
            </div>

            <div className="grid grid-cols-12 gap-2">
              <Input
                value={newSpecKey}
                onChange={(e) => setNewSpecKey(e.target.value)}
                placeholder="key (e.g. size)"
                className="col-span-5 h-11 text-base"
              />
              <Input
                value={newSpecVal}
                onChange={(e) => setNewSpecVal(e.target.value)}
                placeholder="value (e.g. Queen)"
                className="col-span-6 h-11 text-base"
              />
              <Button
                className="col-span-1 h-11 px-0"
                onClick={() => {
                  const key = newSpecKey.trim();
                  if (!key) return;
                  const next = item.specs && typeof item.specs === "object" ? { ...item.specs } : {};
                  (next as any)[key] = parseSpecValue(newSpecVal);
                  void commit({ specs: next });
                  setNewSpecKey("");
                  setNewSpecVal("");
                }}
                aria-label="Add spec"
              >
                +
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="item_notes">Notes</Label>
            <Textarea
              id="item_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => void commit({ notes: notes.trim() || null })}
              placeholder="Material, size, delivery, assembly, etc"
              className="min-h-[120px] text-base"
            />
          </div>

          <AttachmentGallery
            label="Item photos"
            attachments={itemAttachments}
            inheritedAttachments={inheritedItemPhotos}
            inheritedLabel={inheritedItemPhotoLabel}
            onAdd={(files) => void handleAddAttachments("item", item.id, files)}
            onRemove={(attId) => void handleRemoveAttachment("item", item.id, attId)}
          />
        </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{optionOnly ? "Editing option" : "Options"}</div>
            <div className="text-xs text-muted-foreground">
              {optionOnly ? "You are editing a single variation for this item." : "Track candidates, compare, then select a winner."}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {optionOnly ? (
              <Button variant="secondary" onClick={() => setOptionOnlyId(null)}>
                Show all options
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setCompareOpen(true)} disabled={!itemOptions.length}>
                  Compare options
                </Button>
                <Button variant="secondary" onClick={() => setImportOpen(true)}>
                  Add existing Item as Option
                </Button>
                <Button variant="secondary" onClick={() => void onAddOption()}>
                  + Add option
                </Button>
              </>
            )}
          </div>
        </div>

        {!optionOnly ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Sort by</Label>
              <select
                value={`${optSortKey}:${optSortDir}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(":");
                  if (key === "price") {
                    setOptSortKey("price");
                    setOptSortDir(dir === "desc" ? "desc" : "asc");
                  } else if (key === "priority") {
                    setOptSortKey("priority");
                    setOptSortDir("asc");
                  } else {
                    setOptSortKey("name");
                    setOptSortDir("asc");
                  }
                }}
                className="h-11 w-full rounded-md border bg-background px-3 text-base"
              >
                <option value="price:asc">Price (Low to High)</option>
                <option value="price:desc">Price (High to Low)</option>
                <option value="priority:asc">Priority</option>
                <option value="name:asc">Name</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Min price</Label>
              <Input
                inputMode="decimal"
                value={optMinPrice}
                onChange={(e) => setOptMinPrice(e.target.value)}
                placeholder="$"
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Max price</Label>
              <Input
                inputMode="decimal"
                value={optMaxPrice}
                onChange={(e) => setOptMaxPrice(e.target.value)}
                placeholder="$"
                className="h-11 text-base"
              />
            </div>
            <div className="flex items-end">
              <div className="text-xs text-muted-foreground">
                Showing {optionsCount} option{optionsCount === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 text-xs text-muted-foreground">
            Showing {optionsCount} option{optionsCount === 1 ? "" : "s"}.
          </div>
        )}

        <div className="mt-3 space-y-3">
          {!optionOnly && reorderMode && itemOptions.length ? (
            <DragReorderList
              ariaLabel={`Reorder options for ${item.name}`}
              items={itemOptions.map((o) => {
                const final = optionFinalTotal(o);
                const subtitleParts = [
                  o.store ? String(o.store) : "",
                  final ? formatMoneyUSD(final) : "",
                  o.selected ? "selected" : "",
                ].filter(Boolean);
                return {
                  id: o.id,
                  title: o.title,
                  subtitle: subtitleParts.join(" \u00b7 "),
                };
              })}
              onCommit={async (ids) => {
                await reorderOptions(item.id, ids);
              }}
            />
          ) : (
            <div className="max-h-[520px] overflow-y-auto pr-1">
              <div className="space-y-3">
                {optionsToRender.length ? (
                  optionsToRender.map((o) => {
                    const total = optionTotalOrNull(o);
                    const final = total ?? 0;
                    const modifiedFields = Array.isArray(o.provenance?.modifiedFields) ? o.provenance.modifiedFields : [];
                    const isSelected = selectedOptionId === o.id || o.selected;
                    const isBest = bestOptionId === o.id;
                    const specDraft = optionSpecDrafts[o.id] || { key: "", value: "" };
                    return (
                      <Card key={o.id} className={["p-3", isBest ? "border-emerald-200/80 bg-emerald-50/40" : ""].join(" ")}>
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => setOpenOpt((cur) => ({ ...cur, [o.id]: !cur[o.id] }))}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="truncate text-base font-semibold">{o.title}</div>
                                  {isSelected ? <Badge>Selected</Badge> : null}
                                  {isBest ? <Badge variant="secondary">Top pick</Badge> : null}
                                </div>
                              </div>
                              {total !== null ? (
                                <div className="shrink-0 text-sm font-semibold">{formatMoneyUSD(final)}</div>
                              ) : (
                                <div className="shrink-0 text-xs text-muted-foreground">no total</div>
                              )}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <ReviewStatusBadge status={o.provenance?.reviewStatus} />
                              <DataSourceBadge dataSource={o.provenance?.dataSource} />
                              {modifiedFields.length ? (
                                <span className="text-xs text-muted-foreground">
                                  Changed: {modifiedFields.slice(0, 4).join(", ")}
                                  {modifiedFields.length > 4 ? ` +${modifiedFields.length - 4}` : ""}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {o.store ? <span>{o.store}</span> : null}
                              {typeof o.priority === "number" ? <span>priority {o.priority}</span> : null}
                              {formatDimensions(o) !== "-" ? <span>{formatDimensions(o)}</span> : null}
                              {o.price ? <span>price {formatMoneyUSD(o.price)}</span> : null}
                              {o.shipping ? <span>ship {formatMoneyUSD(o.shipping)}</span> : null}
                              {o.taxEstimate ? <span>tax {formatMoneyUSD(o.taxEstimate)}</span> : null}
                              {optionDiscountLabel(o) ? <span>{optionDiscountLabel(o)}</span> : null}
                            </div>
                          </button>

                          <div className="flex shrink-0 flex-col gap-2">
                            <Button variant={isSelected ? "default" : "secondary"} onClick={() => void onSelectOption(o.id)}>
                              {isSelected ? "Selected" : "Select"}
                            </Button>
                            <Button variant="secondary" onClick={() => void onShareOption(o)}>
                              Share
                            </Button>
                            <Button variant="secondary" onClick={() => void onDuplicateOption(o)}>
                              Duplicate
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setOpenOpt((cur) => ({ ...cur, [o.id]: !cur[o.id] }))}
                            >
                              {openOpt[o.id] ? "Hide" : "Edit"}
                            </Button>
                            <Button variant="destructive" onClick={() => void onDeleteOption(o)}>
                              Delete
                            </Button>
                          </div>
                        </div>

                        {openOpt[o.id] || optionOnly ? (
                          <div className="mt-4 space-y-3 border-t pt-4">
                            <div className="space-y-1.5">
                              <Label>Title</Label>
                              <Input
                                defaultValue={o.title}
                                className="h-11 text-base"
                                onBlur={(e) => void updateOption(o.id, { title: e.target.value.trim() || "Option" })}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label>Data source</Label>
                                <select
                                  value={o.provenance?.dataSource || ""}
                                  onChange={(e) =>
                                    void updateOption(o.id, { provenance: { dataSource: (e.target.value as DataSource) || null } })
                                  }
                                  className="h-11 w-full rounded-md border bg-background px-3 text-base"
                                >
                                  <option value="">(none)</option>
                                  <option value="concrete">Concrete</option>
                                  <option value="estimated">Estimated</option>
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <Label>Review status</Label>
                                <select
                                  value={o.provenance?.reviewStatus || ""}
                                  onChange={(e) => {
                                    const v = (e.target.value as ReviewStatus) || null;
                                    const at = nowMs();
                                    if (v === "verified") void updateOption(o.id, { provenance: markProvenanceVerified(o.provenance, at) });
                                    else if (v === "needs_review")
                                      void updateOption(o.id, { provenance: markProvenanceNeedsReview(o.provenance, at) });
                                    else void updateOption(o.id, { provenance: { reviewStatus: v } });
                                  }}
                                  className="h-11 w-full rounded-md border bg-background px-3 text-base"
                                >
                                  <option value="">(none)</option>
                                  <option value="needs_review">Needs review</option>
                                  <option value="verified">Verified</option>
                                  <option value="ai_modified">AI modified</option>
                                </select>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <Label>Source ref</Label>
                              <Input
                                defaultValue={o.provenance?.sourceRef || ""}
                                className="h-11 text-base"
                                placeholder='e.g. "Vendor PDF"'
                                onBlur={(e) => void updateOption(o.id, { provenance: { sourceRef: e.target.value.trim() || null } })}
                              />
                            </div>

                            {modifiedFields.length ? (
                              <div className="text-xs text-muted-foreground">
                                Changed: {modifiedFields.slice(0, 6).join(", ")}
                                {modifiedFields.length > 6 ? ` +${modifiedFields.length - 6}` : ""}
                              </div>
                            ) : null}

                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label>Priority (1-5)</Label>
                                <Input
                                  inputMode="numeric"
                                  defaultValue={o.priority === null || o.priority === undefined ? "" : String(o.priority)}
                                  className="h-11 text-base"
                                  onBlur={(e) => {
                                    const p = parseNumberOrNull(e.target.value);
                                    void updateOption(o.id, { priority: p === null ? null : Math.max(1, Math.min(5, Math.round(p))) });
                                  }}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Tags</Label>
                                <Input
                                  defaultValue={(o.tags || []).join(", ")}
                                  className="h-11 text-base"
                                  placeholder="e.g. king, mattress"
                                  onBlur={(e) => {
                                    const tags = e.target.value
                                      .split(",")
                                      .map((t) => t.trim())
                                      .filter(Boolean);
                                    void updateOption(o.id, { tags: tags.length ? tags : null });
                                  }}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label>Store</Label>
                                <select
                                  value={o.store || ""}
                                  onChange={(e) => void updateOption(o.id, { store: e.target.value.trim() || null })}
                                  className="h-11 w-full rounded-md border bg-background px-3 text-base"
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
                                <Label>Promo code</Label>
                                <Input
                                  defaultValue={o.promoCode || ""}
                                  className="h-11 text-base"
                                  onBlur={(e) => void updateOption(o.id, { promoCode: e.target.value.trim() || null })}
                                />
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <Label>Link</Label>
                              <Input
                                defaultValue={o.link || ""}
                                className="h-11 text-base"
                                placeholder="https://"
                                onBlur={(e) => void updateOption(o.id, { link: e.target.value.trim() || null })}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label>Price</Label>
                                <Input
                                  inputMode="decimal"
                                  defaultValue={o.price === null || o.price === undefined ? "" : String(o.price)}
                                  className="h-11 text-base"
                                  onBlur={(e) => void updateOption(o.id, { price: parseNumberOrNull(e.target.value) })}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Shipping</Label>
                                <Input
                                  inputMode="decimal"
                                  defaultValue={o.shipping === null || o.shipping === undefined ? "" : String(o.shipping)}
                                  className="h-11 text-base"
                                  onBlur={(e) => void updateOption(o.id, { shipping: parseNumberOrNull(e.target.value) })}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label>Tax estimate</Label>
                                <Input
                                  inputMode="decimal"
                                  defaultValue={o.taxEstimate === null || o.taxEstimate === undefined ? "" : String(o.taxEstimate)}
                                  className="h-11 text-base"
                                  onBlur={(e) => void updateOption(o.id, { taxEstimate: parseNumberOrNull(e.target.value) })}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <Label>Discount</Label>
                                  <div className="flex rounded-full border bg-background p-0.5 text-xs">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void updateOption(o.id, {
                                          discountType: "amount",
                                          discountValue:
                                            typeof o.discountValue === "number"
                                              ? o.discountValue
                                              : typeof o.discount === "number"
                                                ? o.discount
                                                : null,
                                          discount:
                                            typeof o.discountValue === "number"
                                              ? o.discountValue
                                              : typeof o.discount === "number"
                                                ? o.discount
                                                : null,
                                        })
                                      }
                                      className={[
                                        "rounded-full px-3 py-1 text-xs font-medium",
                                        o.discountType === "percent" ? "text-muted-foreground" : "bg-foreground text-background",
                                      ].join(" ")}
                                    >
                                      $
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void updateOption(o.id, {
                                          discountType: "percent",
                                          discountValue:
                                            typeof o.discountValue === "number"
                                              ? o.discountValue
                                              : typeof o.discount === "number"
                                                ? o.discount
                                                : null,
                                          discount: null,
                                        })
                                      }
                                      className={[
                                        "rounded-full px-3 py-1 text-xs font-medium",
                                        o.discountType === "percent" ? "bg-foreground text-background" : "text-muted-foreground",
                                      ].join(" ")}
                                    >
                                      %
                                    </button>
                                  </div>
                                </div>
                                <Input
                                  key={`${o.id}-discount-${o.discountType ?? "amount"}-${o.discountValue ?? ""}-${o.discount ?? ""}`}
                                  inputMode="decimal"
                                  defaultValue={
                                    typeof o.discountValue === "number"
                                      ? String(o.discountValue)
                                      : typeof o.discount === "number"
                                        ? String(o.discount)
                                        : ""
                                  }
                                  className="h-11 text-base"
                                  placeholder={o.discountType === "percent" ? "%" : "$"}
                                  onBlur={(e) => {
                                    const v = parseNumberOrNull(e.target.value);
                                    const type = o.discountType === "percent" ? "percent" : "amount";
                                    void updateOption(o.id, {
                                      discountType: type,
                                      discountValue: v,
                                      discount: type === "amount" ? v : null,
                                    });
                                  }}
                                />
                                {(() => {
                                  const pre = optionPreDiscountTotalOrNull(o);
                                  const amt = optionDiscountAmount({
                                    ...o,
                                    discountType: o.discountType ?? "amount",
                                    discountValue:
                                      typeof o.discountValue === "number"
                                        ? o.discountValue
                                        : typeof o.discount === "number"
                                          ? o.discount
                                          : null,
                                  });
                                  if (!pre || !amt) return null;
                                  return <div className="text-xs text-muted-foreground">Savings: {formatMoneyUSD(amt)}</div>;
                                })()}
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <Label>Dimensions (in)</Label>
                              <div className="grid grid-cols-3 gap-3">
                                <Input
                                  inputMode="decimal"
                                  defaultValue={o.dimensions?.wIn === null || o.dimensions?.wIn === undefined ? "" : String(o.dimensions?.wIn)}
                                  placeholder="W"
                                  className="h-11 text-base"
                                  onBlur={(e) => {
                                    const next = normalizeDimensionsInput({
                                      wIn: parseNumberOrNull(e.target.value),
                                      dIn: o.dimensions?.dIn ?? null,
                                      hIn: o.dimensions?.hIn ?? null,
                                    });
                                    void updateOption(o.id, { dimensions: next });
                                  }}
                                />
                                <Input
                                  inputMode="decimal"
                                  defaultValue={o.dimensions?.dIn === null || o.dimensions?.dIn === undefined ? "" : String(o.dimensions?.dIn)}
                                  placeholder="D"
                                  className="h-11 text-base"
                                  onBlur={(e) => {
                                    const next = normalizeDimensionsInput({
                                      wIn: o.dimensions?.wIn ?? null,
                                      dIn: parseNumberOrNull(e.target.value),
                                      hIn: o.dimensions?.hIn ?? null,
                                    });
                                    void updateOption(o.id, { dimensions: next });
                                  }}
                                />
                                <Input
                                  inputMode="decimal"
                                  defaultValue={o.dimensions?.hIn === null || o.dimensions?.hIn === undefined ? "" : String(o.dimensions?.hIn)}
                                  placeholder="H"
                                  className="h-11 text-base"
                                  onBlur={(e) => {
                                    const next = normalizeDimensionsInput({
                                      wIn: o.dimensions?.wIn ?? null,
                                      dIn: o.dimensions?.dIn ?? null,
                                      hIn: parseNumberOrNull(e.target.value),
                                    });
                                    void updateOption(o.id, { dimensions: next });
                                  }}
                                />
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <Label>Dimensions (text)</Label>
                              <Input
                                defaultValue={o.dimensionsText || ""}
                                className="h-11 text-base"
                                placeholder='e.g. "90x39x34 in"'
                                onBlur={(e) => void updateOption(o.id, { dimensionsText: e.target.value.trim() || null })}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Specs</Label>
                              {o.specs && typeof o.specs === "object" && Object.keys(o.specs).length ? (
                                Object.entries(o.specs)
                                  .sort((a, b) => a[0].localeCompare(b[0]))
                                  .map(([k, v]) => (
                                    <div key={k} className="grid grid-cols-12 gap-2">
                                      <Input value={k} readOnly className="col-span-5 h-11 text-base" />
                                      <Input
                                        defaultValue={v === null || typeof v === "undefined" ? "" : String(v)}
                                        className="col-span-6 h-11 text-base"
                                        onBlur={(e) => {
                                          const next = o.specs && typeof o.specs === "object" ? { ...o.specs } : {};
                                          (next as any)[k] = parseSpecValue(e.target.value);
                                          void updateOption(o.id, { specs: next });
                                        }}
                                      />
                                      <Button
                                        variant="secondary"
                                        className="col-span-1 h-11 px-0"
                                        onClick={() => {
                                          const next = o.specs && typeof o.specs === "object" ? { ...o.specs } : {};
                                          delete (next as any)[k];
                                          void updateOption(o.id, { specs: Object.keys(next).length ? next : null });
                                        }}
                                        aria-label={`Remove spec ${k}`}
                                      >
                                        &times;
                                      </Button>
                                    </div>
                                  ))
                              ) : (
                                <div className="text-xs text-muted-foreground">No specs yet.</div>
                              )}

                              <div className="grid grid-cols-12 gap-2">
                                <Input
                                  value={specDraft.key}
                                  onChange={(e) =>
                                    setOptionSpecDrafts((cur) => ({
                                      ...cur,
                                      [o.id]: { ...(cur[o.id] || { key: "", value: "" }), key: e.target.value },
                                    }))
                                  }
                                  placeholder="key (e.g. size)"
                                  className="col-span-5 h-11 text-base"
                                />
                                <Input
                                  value={specDraft.value}
                                  onChange={(e) =>
                                    setOptionSpecDrafts((cur) => ({
                                      ...cur,
                                      [o.id]: { ...(cur[o.id] || { key: "", value: "" }), value: e.target.value },
                                    }))
                                  }
                                  placeholder="value (e.g. King)"
                                  className="col-span-6 h-11 text-base"
                                />
                                <Button
                                  className="col-span-1 h-11 px-0"
                                  onClick={() => {
                                    const key = specDraft.key.trim();
                                    if (!key) return;
                                    const next = o.specs && typeof o.specs === "object" ? { ...o.specs } : {};
                                    (next as any)[key] = parseSpecValue(specDraft.value);
                                    void updateOption(o.id, { specs: next });
                                    setOptionSpecDrafts((cur) => ({ ...cur, [o.id]: { key: "", value: "" } }));
                                  }}
                                  aria-label="Add spec"
                                >
                                  +
                                </Button>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <Label>Notes</Label>
                              <Textarea
                                defaultValue={o.notes || ""}
                                className="min-h-[92px] text-base"
                                onBlur={(e) => void updateOption(o.id, { notes: e.target.value.trim() || null })}
                              />
                            </div>

                            <AttachmentGallery
                              label="Option photos"
                              attachments={optionAttachments[o.id] || []}
                              onAdd={(files) => void handleAddAttachments("option", o.id, files)}
                              onRemove={(attId) => void handleRemoveAttachment("option", o.id, attId)}
                            />
                          </div>
                        ) : null}
                      </Card>
                    );
                  })
                ) : optionOnly ? (
                  <div className="text-sm text-muted-foreground">Option not found.</div>
                ) : itemOptions.length ? (
                  <div className="text-sm text-muted-foreground">No options match the current filters.</div>
                ) : (
                  <div className="text-sm text-muted-foreground">No options yet. Add candidates as you shop.</div>
                )}
              </div>
            </div>
          )}
        </div>

        {!optionOnly && !reorderMode && totalPages > 1 ? (
          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Page {optionPage} of {totalPages}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOptionPage((p) => Math.max(1, p - 1))} disabled={optionPage <= 1}>
                Prev
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setOptionPage((p) => Math.min(totalPages, p + 1))} disabled={optionPage >= totalPages}>
                Next
              </Button>
            </div>
          </div>
        ) : null}

        {!optionOnly ? (
          <div className="mt-3">
            <Button
              variant={reorderMode ? "default" : "secondary"}
              className="w-full"
              onClick={() => setReorderMode((v) => !v)}
              disabled={!itemOptions.length}
            >
              {reorderMode ? "Done reordering" : "Reorder options"}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">Relationships</div>
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          <div>
            Parent item:{" "}
            {optionOnly ? (
              <Button variant="link" className="h-auto p-0 text-sm" onClick={() => setOptionOnlyId(null)}>
                {item.name}
              </Button>
            ) : (
              "None"
            )}
          </div>
          <div>Child options: {childOptionsLabel}</div>
        </div>
      </Card>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) {
            setImportSelectedId(null);
            setImportQuery("");
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import existing item</DialogTitle>
            <DialogDescription>Select a standalone item to import as an option. The original item will be removed from its room list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={importQuery}
              onChange={(e) => setImportQuery(e.target.value)}
              placeholder="Search by title, store, tags..."
              className="h-11 text-base"
            />
            <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
              {importCandidates.length ? (
                importCandidates.map((candidate) => {
                  const isSelected = importSelectedId === candidate.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setImportSelectedId(candidate.id)}
                      className={[
                        "w-full rounded-md border px-3 py-2 text-left transition",
                        isSelected ? "border-foreground bg-secondary/60" : "hover:border-foreground/60",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{candidate.name}</div>
                        {typeof candidate.price === "number" ? (
                          <div className="text-sm font-semibold">{formatMoneyUSD(candidate.price)}</div>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {candidate.store ? `${candidate.store} · ` : ""}
                        {roomNameById.get(candidate.room) || candidate.room}
                        {candidate.category ? ` · ${candidate.category}` : ""}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="text-sm text-muted-foreground">No matching items to import.</div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onImportExistingItem()} disabled={!importSelectedId || importBusy}>
              {importBusy ? "Importing..." : "Import as option"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Compare options</DialogTitle>
            <DialogDescription>Compare key fields and pick a winner. Filters apply to the comparison set.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Dimensions</th>
                  <th className="px-3 py-2">Store</th>
                  <th className="px-3 py-2">Link</th>
                  <th className="px-3 py-2">Specs</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredOptions.length ? (
                  filteredOptions.map((o) => {
                    const total = optionTotalOrNull(o);
                    const isSelected = selectedOptionId === o.id || o.selected;
                    const isBest = bestOptionId === o.id;
                    return (
                      <tr
                        key={o.id}
                        className={[
                          "border-t",
                          isSelected ? "bg-primary/10" : "",
                          !isSelected && isBest ? "bg-emerald-50/60" : "",
                        ].join(" ")}
                      >
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{o.title}</span>
                            {isSelected ? <Badge>Selected</Badge> : null}
                            {isBest ? <Badge variant="secondary">Top pick</Badge> : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">{total === null ? "-" : formatMoneyUSD(total)}</td>
                        <td className="px-3 py-2">{formatDimensions(o)}</td>
                        <td className="px-3 py-2">{o.store || "-"}</td>
                        <td className="px-3 py-2">
                          {o.link ? (
                            <a href={o.link} target="_blank" rel="noreferrer" className="text-primary underline">
                              Link
                            </a>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-3 py-2">{formatSpecs(o.specs)}</td>
                        <td className="px-3 py-2">{typeof o.priority === "number" ? o.priority : "-"}</td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant={isSelected ? "default" : "secondary"} onClick={() => void onSelectOption(o.id)}>
                            Select this option
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="px-3 py-4 text-center text-sm text-muted-foreground" colSpan={8}>
                      No options to compare.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AttachmentGallery({
  label,
  attachments,
  inheritedAttachments,
  inheritedLabel,
  onAdd,
  onRemove,
}: {
  label: string;
  attachments: AttachmentRecord[];
  inheritedAttachments?: AttachmentRecord[];
  inheritedLabel?: string;
  onAdd: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const max = 3;
  const usingInherited = attachments.length === 0 && Boolean(inheritedAttachments && inheritedAttachments.length);
  const displayAttachments = usingInherited ? inheritedAttachments || [] : attachments;

  useEffect(() => {
    const next: Record<string, string> = {};
    const toRevoke: string[] = [];
    for (const att of displayAttachments) {
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
  }, [displayAttachments]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={attachments.length >= max}
        >
          Add photo
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />
      {attachments.length ? (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div key={att.id} className="relative h-24 w-24 overflow-hidden rounded-md border bg-background">
              {urls[att.id] ? (
                <img src={urls[att.id]} alt={att.name || "Attachment"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">Loading</div>
              )}
              <button
                type="button"
                onClick={() => onRemove(att.id)}
                className="absolute right-1 top-1 rounded-full border bg-background px-1.5 text-xs text-muted-foreground hover:text-foreground"
                aria-label="Remove photo"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      ) : usingInherited ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {displayAttachments.slice(0, max).map((att) => (
              <div key={att.id} className="relative h-24 w-24 overflow-hidden rounded-md border bg-background">
                {urls[att.id] ? (
                  <img src={urls[att.id]} alt={att.name || "Attachment"} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">Loading</div>
                )}
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">{inheritedLabel || "Showing photos from the selected option."}</div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">No photos yet.</div>
      )}
      <div className="text-xs text-muted-foreground">Up to {max} photos.</div>
    </div>
  );
}
