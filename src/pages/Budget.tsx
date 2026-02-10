import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import type { Item, ItemStatus, Option, RoomId, Store } from "@/lib/domain";
import { formatMoneyUSD } from "@/lib/format";
import { useData } from "@/data/DataContext";
import { buildStoreIndex, itemDiscountAmountWithStore, optionDiscountAmountWithStore, optionTotalWithStore, storeKey } from "@/lib/storePricing";

type Totals = { planned: number; selected: number; spent: number; discount: number; missingPrice: number; count: number };

function bucketForStatus(status: ItemStatus): keyof Totals | null {
  if (status === "Idea" || status === "Shortlist") return "planned";
  if (status === "Selected") return "selected";
  if (status === "Ordered" || status === "Delivered" || status === "Installed") return "spent";
  return null;
}

type SelectedSummary = { total: number | null; discount: number };

function addLine(t: Totals, item: Item, selectedTotals: Map<string, SelectedSummary>, storeByName: Map<string, Store>) {
  t.count += 1;
  const itemPrice = typeof item.price === "number" ? item.price : null;
  const summary = selectedTotals.get(item.id) || { total: null, discount: 0 };
  const useSelected = summary.total !== null;
  const price = useSelected ? summary.total : itemPrice;
  if (price === null) {
    t.missingPrice += 1;
    return;
  }
  const store = storeByName.get(storeKey(item.store)) || null;
  const discount = useSelected ? summary.discount : itemPrice !== null ? itemDiscountAmountWithStore(item, store) || 0 : 0;
  if (discount) t.discount += discount * (item.qty || 1);
  const effective = useSelected ? price : Math.max(0, price - discount);
  const b = bucketForStatus(item.status);
  if (!b) return;
  t[b] += effective * (item.qty || 1);
}

export default function Budget() {
  const { items, options, orderedRooms, roomNameById, stores } = useData();

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);
  const storeByName = useMemo(() => buildStoreIndex(stores), [stores]);

  const activeItems = useMemo(() => items.filter((i) => i.syncState !== "deleted"), [items]);

  const selectedOptionTotals = useMemo(() => {
    const byItem = new Map<string, Option[]>();
    for (const o of options) {
      if (o.syncState === "deleted") continue;
      if (!byItem.has(o.itemId)) byItem.set(o.itemId, []);
      byItem.get(o.itemId)!.push(o);
    }
    const totals = new Map<string, SelectedSummary>();
    for (const it of activeItems) {
      const list = byItem.get(it.id) || [];
      let selectedList = list.filter((o) => o.selected);
      if (!selectedList.length && it.selectedOptionId) {
        const selected = list.find((o) => o.id === it.selectedOptionId) || null;
        if (selected) selectedList = [selected];
      }
      if (!selectedList.length) {
        totals.set(it.id, { total: null, discount: 0 });
        continue;
      }
      let total = 0;
      let hasAny = false;
      let discount = 0;
      for (const opt of selectedList) {
        const store = storeByName.get(storeKey(opt.store || it.store)) || null;
        const optTotal = optionTotalWithStore(opt, store);
        if (optTotal === null) continue;
        total += optTotal;
        discount += optionDiscountAmountWithStore(opt, store);
        hasAny = true;
      }
      totals.set(it.id, { total: hasAny ? total : null, discount });
    }
    return totals;
  }, [activeItems, options, storeByName]);

  const totals = useMemo(() => {
    const t: Totals = { planned: 0, selected: 0, spent: 0, discount: 0, missingPrice: 0, count: 0 };
    for (const it of activeItems) addLine(t, it, selectedOptionTotals, storeByName);
    return t;
  }, [activeItems, selectedOptionTotals, storeByName]);

  const byRoom = useMemo(() => {
    const out = new Map<RoomId, Totals>();
    for (const r of orderedRoomIds) out.set(r, { planned: 0, selected: 0, spent: 0, discount: 0, missingPrice: 0, count: 0 });
    for (const it of activeItems) {
      const t = out.get(it.room);
      if (t) addLine(t, it, selectedOptionTotals, storeByName);
    }
    return out;
  }, [activeItems, orderedRoomIds, selectedOptionTotals, storeByName]);

  const byCategory = useMemo(() => {
    const out = new Map<string, Totals>();
    for (const it of activeItems) {
      const key = (it.category || "Other").trim() || "Other";
      if (!out.has(key)) out.set(key, { planned: 0, selected: 0, spent: 0, discount: 0, missingPrice: 0, count: 0 });
      addLine(out.get(key)!, it, selectedOptionTotals, storeByName);
    }
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [activeItems, selectedOptionTotals, storeByName]);

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
            return (
              <div key={r} className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-heading text-base text-card-foreground">{roomNameById.get(r) || r}</h3>
                  <p className="font-body text-base font-bold text-foreground">{formatMoneyUSD(total)}</p>
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
            return (
              <div key={cat} className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="min-w-0 truncate font-heading text-base text-card-foreground">{cat}</h3>
                  <p className="font-body text-base font-bold text-foreground">{formatMoneyUSD(total)}</p>
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
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
