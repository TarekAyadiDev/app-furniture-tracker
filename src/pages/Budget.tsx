import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Item, ItemStatus, Option, RoomId } from "@/lib/domain";
import { formatMoneyUSD } from "@/lib/format";
import { useData } from "@/data/DataContext";
import { buildStoreIndex, computeStoreAllocation } from "@/lib/storePricing";

type Totals = { planned: number; selected: number; spent: number; discount: number; missingPrice: number; count: number };

function bucketForStatus(status: ItemStatus): keyof Totals | null {
  if (status === "Idea" || status === "Shortlist") return "planned";
  if (status === "Selected") return "selected";
  if (status === "Ordered" || status === "Delivered" || status === "Installed") return "spent";
  return null;
}

function addLine(t: Totals, item: Item, allocation: ReturnType<typeof computeStoreAllocation>) {
  t.count += 1;
  const price = allocation.itemTotals.get(item.id) ?? null;
  if (price === null) {
    t.missingPrice += 1;
    return;
  }
  const discount = allocation.itemDiscountTotals.get(item.id) || 0;
  if (discount) t.discount += discount;
  const effective = Math.max(0, price);
  const b = bucketForStatus(item.status);
  if (!b) return;
  t[b] += effective;
}

export default function Budget() {
  const { items, options, subItems, orderedRooms, roomNameById, stores } = useData();
  const [openRooms, setOpenRooms] = useState<Record<string, boolean>>({});
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);
  const storeByName = useMemo(() => buildStoreIndex(stores), [stores]);

  const activeItems = useMemo(() => items.filter((i) => i.syncState !== "deleted"), [items]);

  const selectedOptionsByItem = useMemo(() => {
    const byItem = new Map<string, Option[]>();
    for (const o of options) {
      if (o.syncState === "deleted") continue;
      if (!byItem.has(o.itemId)) byItem.set(o.itemId, []);
      byItem.get(o.itemId)!.push(o);
    }
    for (const it of activeItems) {
      const list = byItem.get(it.id) || [];
      let selectedList = list.filter((o) => o.selected);
      if (!selectedList.length && it.selectedOptionId) {
        const selected = list.find((o) => o.id === it.selectedOptionId) || null;
        if (selected) selectedList = [selected];
      }
      if (selectedList.length) byItem.set(it.id, selectedList);
      else byItem.set(it.id, []);
    }
    return byItem;
  }, [activeItems, options]);
  const hasOptionsByItem = useMemo(() => {
    const set = new Set<string>();
    for (const o of options) {
      if (o.syncState === "deleted") continue;
      set.add(o.itemId);
    }
    return set;
  }, [options]);

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

  const storeAllocation = useMemo(
    () => computeStoreAllocation(activeItems, selectedOptionsByItem, storeByName, subItemsByOption, hasOptionsByItem),
    [activeItems, selectedOptionsByItem, storeByName, subItemsByOption, hasOptionsByItem],
  );

  const totals = useMemo(() => {
    const t: Totals = { planned: 0, selected: 0, spent: 0, discount: 0, missingPrice: 0, count: 0 };
    for (const it of activeItems) addLine(t, it, storeAllocation);
    return t;
  }, [activeItems, storeAllocation]);

  const byRoom = useMemo(() => {
    const out = new Map<RoomId, Totals>();
    for (const r of orderedRoomIds) out.set(r, { planned: 0, selected: 0, spent: 0, discount: 0, missingPrice: 0, count: 0 });
    for (const it of activeItems) {
      const t = out.get(it.room);
      if (t) addLine(t, it, storeAllocation);
    }
    return out;
  }, [activeItems, orderedRoomIds, storeAllocation]);

  const byCategory = useMemo(() => {
    const out = new Map<string, Totals>();
    for (const it of activeItems) {
      const key = (it.category || "Other").trim() || "Other";
      if (!out.has(key)) out.set(key, { planned: 0, selected: 0, spent: 0, discount: 0, missingPrice: 0, count: 0 });
      addLine(out.get(key)!, it, storeAllocation);
    }
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [activeItems, storeAllocation]);

  const itemsByRoom = useMemo(() => {
    const map = new Map<RoomId, Item[]>();
    for (const r of orderedRoomIds) map.set(r, []);
    for (const it of activeItems) {
      if (!map.has(it.room)) map.set(it.room, []);
      map.get(it.room)!.push(it);
    }
    for (const [key, list] of map.entries()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
      map.set(key, list);
    }
    return map;
  }, [activeItems, orderedRoomIds]);

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of activeItems) {
      const key = (it.category || "Other").trim() || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    for (const [key, list] of map.entries()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
      map.set(key, list);
    }
    return map;
  }, [activeItems]);

  const renderItemBreakdown = (it: Item) => {
    const selected = selectedOptionsByItem.get(it.id) || [];
    const subItemList = selected.flatMap((opt) => subItemsByOption.get(opt.id) || []);
    const selectionLabel =
      selected.length === 1
        ? selected[0].title
        : selected.length > 1
          ? `${selected.length} selected`
          : null;
    const displayName = selectionLabel ? `${it.name} · ${selectionLabel}` : it.name;
    const base = storeAllocation.itemBaseTotals.get(it.id) ?? null;
    const total = storeAllocation.itemTotals.get(it.id) ?? null;
    const storeKey = storeAllocation.itemStoreKey.get(it.id) || null;
    const storeSummary = storeKey ? storeAllocation.storeTotals.get(storeKey) || null : null;
    const storeApplied = Boolean(storeSummary && storeSummary.appliedItemId === it.id);
    const storeShipping = storeApplied ? storeSummary?.storeShipping || 0 : 0;
    const storeWarranty = storeApplied ? storeSummary?.storeWarranty || 0 : 0;
    const storeTax = storeApplied ? storeSummary?.storeTax || 0 : 0;
    const storeDiscount = storeApplied ? storeSummary?.storeDiscount || 0 : 0;
    const storeName = storeKey ? storeByName.get(storeKey)?.name || null : null;
    const totalLabel = typeof total === "number" ? formatMoneyUSD(total) : "—";
    const mathParts: string[] = [];
    if (typeof base === "number") {
      mathParts.push(formatMoneyUSD(base));
      if (storeShipping) mathParts.push(`+ ${formatMoneyUSD(storeShipping)}`);
      if (storeWarranty) mathParts.push(`+ ${formatMoneyUSD(storeWarranty)}`);
      if (storeTax) mathParts.push(`+ ${formatMoneyUSD(storeTax)}`);
      if (storeDiscount) mathParts.push(`- ${formatMoneyUSD(storeDiscount)}`);
      mathParts.push(`= ${formatMoneyUSD(typeof total === "number" ? total : base)}`);
    }

    return (
      <div key={it.id} className="rounded-lg border border-border/60 bg-background/70 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{displayName}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {it.status}
              {storeName ? ` · ${storeName}` : ""}
              {(it.qty || 1) > 1 ? ` · qty ${it.qty}` : ""}
              {subItemList.length ? ` · ${subItemList.length} sub-item(s)` : ""}
            </div>
          </div>
          <div className="text-sm font-semibold text-foreground">{totalLabel}</div>
        </div>
        {typeof base === "number" ? (
          <div className="mt-2 text-xs text-muted-foreground">Math: {mathParts.join(" ")}</div>
        ) : (
          <div className="mt-2 text-xs text-muted-foreground italic">No price details</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <Card className="glass rounded-2xl border border-border/50 p-6 shadow-elegant">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">Total Investment</p>
        <p className="mt-2 font-heading text-4xl font-bold text-gradient">{formatMoneyUSD(totals.planned + totals.selected + totals.spent)}</p>
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border/50 bg-background/50 p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Planned</p>
            <p className="mt-1 font-heading text-lg font-semibold text-foreground">{formatMoneyUSD(totals.planned)}</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/50 p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Selected</p>
            <p className="mt-1 font-heading text-lg font-semibold text-primary">{formatMoneyUSD(totals.selected)}</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/50 p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Spent</p>
            <p className="mt-1 font-heading text-lg font-semibold text-success">{formatMoneyUSD(totals.spent)}</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Total items: {totals.count} • {totals.missingPrice} need pricing • Discounts saved {formatMoneyUSD(totals.discount)}
        </p>
      </Card>

      <Card className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <h2 className="font-heading text-lg font-semibold text-foreground">By Room</h2>
        <div className="mt-4 space-y-3">
          {orderedRoomIds.map((r) => {
            const t = byRoom.get(r)!;
            const total = t.planned + t.selected + t.spent;
            const isOpen = Boolean(openRooms[r]);
            const roomItems = itemsByRoom.get(r) || [];
            return (
              <div key={r} className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-heading text-base text-card-foreground">{roomNameById.get(r) || r}</h3>
                  <div className="flex items-center gap-3">
                    <p className="font-body text-base font-bold text-foreground">{formatMoneyUSD(total)}</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 rounded-lg px-3 text-xs"
                      onClick={() => setOpenRooms((cur) => ({ ...cur, [r]: !isOpen }))}
                    >
                      {isOpen ? "Hide" : "Open"}
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <p>Planned</p>
                    <p className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.planned)}</p>
                  </div>
                  <div>
                    <p>Selected</p>
                    <p className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.selected)}</p>
                  </div>
                  <div>
                    <p>Spent</p>
                    <p className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.spent)}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Items: {t.count} • {t.missingPrice} missing price
                </p>
                {t.discount ? <p className="mt-1 text-xs text-muted-foreground">Discounts saved {formatMoneyUSD(t.discount)}</p> : null}
                {isOpen ? (
                  <div className="mt-3 space-y-2">
                    {roomItems.length ? roomItems.map((it) => renderItemBreakdown(it)) : <div className="text-xs text-muted-foreground">No items.</div>}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <h2 className="font-heading text-lg font-semibold text-foreground">By Category</h2>
        <div className="mt-4 space-y-3">
          {byCategory.map(([cat, t]) => {
            const total = t.planned + t.selected + t.spent;
            const isOpen = Boolean(openCategories[cat]);
            const categoryItems = itemsByCategory.get(cat) || [];
            return (
              <div key={cat} className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="min-w-0 truncate font-heading text-base text-card-foreground">{cat}</h3>
                  <div className="flex items-center gap-3">
                    <p className="font-body text-base font-bold text-foreground">{formatMoneyUSD(total)}</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 rounded-lg px-3 text-xs"
                      onClick={() => setOpenCategories((cur) => ({ ...cur, [cat]: !isOpen }))}
                    >
                      {isOpen ? "Hide" : "Open"}
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <p>Planned</p>
                    <p className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.planned)}</p>
                  </div>
                  <div>
                    <p>Selected</p>
                    <p className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.selected)}</p>
                  </div>
                  <div>
                    <p>Spent</p>
                    <p className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.spent)}</p>
                  </div>
                </div>
                {t.missingPrice ? <p className="mt-2 text-xs text-muted-foreground">{t.missingPrice} missing price</p> : null}
                {t.discount ? <p className="mt-1 text-xs text-muted-foreground">Discounts saved {formatMoneyUSD(t.discount)}</p> : null}
                {isOpen ? (
                  <div className="mt-3 space-y-2">
                    {categoryItems.length ? (
                      categoryItems.map((it) => renderItemBreakdown(it))
                    ) : (
                      <div className="text-xs text-muted-foreground">No items.</div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
