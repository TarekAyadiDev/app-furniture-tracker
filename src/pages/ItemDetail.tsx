import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { ReviewStatusBadge } from "@/components/ReviewStatusBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { DragReorderList } from "@/components/reorder/DragReorderList";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { addAttachment, deleteAttachment, listAttachments, type AttachmentRecord } from "@/storage/attachments";

function optionFinalTotal(o: Option) {
  return (o.price || 0) + (o.shipping || 0) + (o.taxEstimate || 0) - (o.discount || 0);
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
    reorderOptions,
    renameCategory,
    updateItem,
    deleteItem,
    createOption,
    updateOption,
    deleteOption,
  } = useData();

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);

  const item = useMemo(() => items.find((x) => x.id === id), [items, id]);
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

  const [itemAttachments, setItemAttachments] = useState<AttachmentRecord[]>([]);
  const [optionAttachments, setOptionAttachments] = useState<Record<string, AttachmentRecord[]>>({});

  const [name, setName] = useState("");
  const [room, setRoom] = useState<RoomId>("Living");
  const [category, setCategory] = useState("Other");
  const [status, setStatus] = useState<ItemStatus>("Idea");
  const [price, setPrice] = useState("");
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
  const [reorderMode, setReorderMode] = useState(false);
  const [newSpecKey, setNewSpecKey] = useState("");
  const [newSpecVal, setNewSpecVal] = useState("");

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
  }, [item?.id]);

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

  async function commit(patch: Partial<Item>) {
    await updateItem(item.id, patch);
  }

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

  async function onDeleteOption(opt: Option) {
    const optAtts = optionAttachments[opt.id] || (await listAttachments("option", opt.id));
    await Promise.all(optAtts.map((att) => deleteAttachment(att.id)));
    await deleteOption(opt.id);
  }

  async function onShareItem() {
    const roomLabel = roomNameById.get(item.room) || item.room;
    const parts = [
      item.name,
      roomLabel ? `Room: ${roomLabel}` : "",
      item.status ? `Status: ${item.status}` : "",
      item.price ? `Price: ${formatMoneyUSD(item.price)}` : "",
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
    await Promise.all(incoming.map((file) => addAttachment(parentType, parentId, file)));
    await refreshAttachments(parentType, parentId);
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
      const final = optionFinalTotal(chosen);
      await commit({
        status: "Selected",
        store: chosen.store ?? null,
        link: chosen.link ?? null,
        price: final || null,
      });
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
    setOpenOpt((cur) => ({ ...cur, [optionToOpen]: true }));
    nav({ pathname: loc.pathname, search: "" }, { replace: true });
  }, [itemOptions, loc.pathname, nav, optionToOpen]);

  const itemModifiedFields = Array.isArray(item.provenance?.modifiedFields) ? item.provenance.modifiedFields : [];

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
              {item.price ? <span className="text-sm font-semibold">{formatMoneyUSD(item.price)}</span> : null}
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
            <Button variant="secondary" onClick={() => void onShareItem()}>
              Share
            </Button>
            <Button variant="destructive" onClick={() => void onDeleteItem()}>
              Delete
            </Button>
          </div>
        </div>

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
              <Label htmlFor="item_price">Final price (incl. shipping/tax)</Label>
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
              <Label htmlFor="item_store">Store</Label>
              <Input
                id="item_store"
                value={store}
                onChange={(e) => setStore(e.target.value)}
                onBlur={() => void commit({ store: store.trim() || null })}
                className="h-12 text-base"
              />
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
                        \u00d7
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
            onAdd={(files) => void handleAddAttachments("item", item.id, files)}
            onRemove={(attId) => void handleRemoveAttachment("item", item.id, attId)}
          />
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Options</div>
            <div className="text-xs text-muted-foreground">Track candidates, then tap Select to set the item.</div>
          </div>
          <Button variant="secondary" onClick={() => void onAddOption()}>
            + Add option
          </Button>
        </div>

        <div className="mt-3 space-y-3">
          {reorderMode && itemOptions.length ? (
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
          ) : itemOptions.length ? (
            itemOptions.map((o) => {
              const final = optionFinalTotal(o);
              const modifiedFields = Array.isArray(o.provenance?.modifiedFields) ? o.provenance.modifiedFields : [];
              return (
                <Card key={o.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setOpenOpt((cur) => ({ ...cur, [o.id]: !cur[o.id] }))}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-base font-semibold">{o.title}</div>
                        {final ? (
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
                        {o.price ? <span>price {formatMoneyUSD(o.price)}</span> : null}
                        {o.shipping ? <span>ship {formatMoneyUSD(o.shipping)}</span> : null}
                        {o.taxEstimate ? <span>tax {formatMoneyUSD(o.taxEstimate)}</span> : null}
                        {o.discount ? <span>disc -{formatMoneyUSD(o.discount)}</span> : null}
                        {o.selected ? <span className="font-semibold text-foreground">selected</span> : null}
                      </div>
                    </button>

                    <div className="flex shrink-0 flex-col gap-2">
                      <Button variant={o.selected ? "default" : "secondary"} onClick={() => void onSelectOption(o.id)}>
                        {o.selected ? "Selected" : "Select"}
                      </Button>
                      <Button variant="secondary" onClick={() => void onShareOption(o)}>
                        Share
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

                  {openOpt[o.id] ? (
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
                            onChange={(e) => void updateOption(o.id, { provenance: { dataSource: (e.target.value as DataSource) || null } })}
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
                              else if (v === "needs_review") void updateOption(o.id, { provenance: markProvenanceNeedsReview(o.provenance, at) });
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
                          <Label>Store</Label>
                          <Input
                            defaultValue={o.store || ""}
                            className="h-11 text-base"
                            onBlur={(e) => void updateOption(o.id, { store: e.target.value.trim() || null })}
                          />
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
                          <Label>Discount</Label>
                          <Input
                            inputMode="decimal"
                            defaultValue={o.discount === null || o.discount === undefined ? "" : String(o.discount)}
                            className="h-11 text-base"
                            onBlur={(e) => void updateOption(o.id, { discount: parseNumberOrNull(e.target.value) })}
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
          ) : (
            <div className="text-sm text-muted-foreground">No options yet. Add candidates as you shop.</div>
          )}
        </div>

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
      </Card>
    </div>
  );
}

function AttachmentGallery({
  label,
  attachments,
  onAdd,
  onRemove,
}: {
  label: string;
  attachments: AttachmentRecord[];
  onAdd: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const max = 3;

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const att of attachments) {
      next[att.id] = URL.createObjectURL(att.blob);
    }
    setUrls(next);
    return () => {
      Object.values(next).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments]);

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
                \u00d7
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">No photos yet.</div>
      )}
      <div className="text-xs text-muted-foreground">Up to {max} photos.</div>
    </div>
  );
}
