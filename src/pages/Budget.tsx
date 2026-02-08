import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import type { Item, ItemStatus, Option, RoomId } from "@/lib/domain";
import { formatMoneyUSD } from "@/lib/format";
import { useData } from "@/data/DataContext";

type Totals = { planned: number; selected: number; spent: number; missingPrice: number; count: number };

function optionTotalOrNull(opt: Option): number | null {
  const hasAny =
    typeof opt.price === "number" ||
    typeof opt.shipping === "number" ||
    typeof opt.taxEstimate === "number" ||
    typeof opt.discount === "number";
  if (!hasAny) return null;
  return (opt.price || 0) + (opt.shipping || 0) + (opt.taxEstimate || 0) - (opt.discount || 0);
}

function bucketForStatus(status: ItemStatus): keyof Totals | null {
  if (status === "Idea" || status === "Shortlist") return "planned";
  if (status === "Selected") return "selected";
  if (status === "Ordered" || status === "Delivered" || status === "Installed") return "spent";
  return null;
}

function addLine(t: Totals, item: Item, selectedTotals: Map<string, number | null>) {
  t.count += 1;
  const price = selectedTotals.get(item.id) ?? item.price ?? null;
  const line = (price || 0) * (item.qty || 1);
  if (!price) {
    t.missingPrice += 1;
    return;
  }
  const b = bucketForStatus(item.status);
  if (!b) return;
  t[b] += line;
}

export default function Budget() {
  const { items, options, orderedRooms, roomNameById } = useData();

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);

  const activeItems = useMemo(() => items.filter((i) => i.syncState !== "deleted"), [items]);

  const selectedOptionTotals = useMemo(() => {
    const byItem = new Map<string, Option[]>();
    for (const o of options) {
      if (o.syncState === "deleted") continue;
      if (!byItem.has(o.itemId)) byItem.set(o.itemId, []);
      byItem.get(o.itemId)!.push(o);
    }
    const totals = new Map<string, number | null>();
    for (const it of activeItems) {
      const list = byItem.get(it.id) || [];
      let selected = it.selectedOptionId ? list.find((o) => o.id === it.selectedOptionId) : null;
      if (!selected) selected = list.find((o) => o.selected) || null;
      totals.set(it.id, selected ? optionTotalOrNull(selected) : null);
    }
    return totals;
  }, [activeItems, options]);

  const totals = useMemo(() => {
    const t: Totals = { planned: 0, selected: 0, spent: 0, missingPrice: 0, count: 0 };
    for (const it of activeItems) addLine(t, it, selectedOptionTotals);
    return t;
  }, [activeItems, selectedOptionTotals]);

  const byRoom = useMemo(() => {
    const out = new Map<RoomId, Totals>();
    for (const r of orderedRoomIds) out.set(r, { planned: 0, selected: 0, spent: 0, missingPrice: 0, count: 0 });
    for (const it of activeItems) {
      const t = out.get(it.room);
      if (t) addLine(t, it, selectedOptionTotals);
    }
    return out;
  }, [activeItems, orderedRoomIds, selectedOptionTotals]);

  const byCategory = useMemo(() => {
    const out = new Map<string, Totals>();
    for (const it of activeItems) {
      const key = (it.category || "Other").trim() || "Other";
      if (!out.has(key)) out.set(key, { planned: 0, selected: 0, spent: 0, missingPrice: 0, count: 0 });
      addLine(out.get(key)!, it, selectedOptionTotals);
    }
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [activeItems, selectedOptionTotals]);

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
          {totals.count} item(s) tracked • {totals.missingPrice} need pricing
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
                {t.missingPrice ? <p className="mt-2 text-xs text-muted-foreground">{t.missingPrice} missing price</p> : null}
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
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
