import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import type { Item, ItemStatus, RoomId } from "@/lib/domain";
import { formatMoneyUSD } from "@/lib/format";
import { useData } from "@/data/DataContext";

type Totals = { planned: number; selected: number; spent: number; missingPrice: number; count: number };

function bucketForStatus(status: ItemStatus): keyof Totals | null {
  if (status === "Idea" || status === "Shortlist") return "planned";
  if (status === "Selected") return "selected";
  if (status === "Ordered" || status === "Delivered" || status === "Installed") return "spent";
  return null;
}

function addLine(t: Totals, item: Item) {
  t.count += 1;
  const line = (item.price || 0) * (item.qty || 1);
  if (!item.price) {
    t.missingPrice += 1;
    return;
  }
  const b = bucketForStatus(item.status);
  if (!b) return;
  t[b] += line;
}

export default function Budget() {
  const { items, orderedRooms, roomNameById } = useData();

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);

  const activeItems = useMemo(() => items.filter((i) => i.syncState !== "deleted"), [items]);

  const totals = useMemo(() => {
    const t: Totals = { planned: 0, selected: 0, spent: 0, missingPrice: 0, count: 0 };
    for (const it of activeItems) addLine(t, it);
    return t;
  }, [activeItems]);

  const byRoom = useMemo(() => {
    const out = new Map<RoomId, Totals>();
    for (const r of orderedRoomIds) out.set(r, { planned: 0, selected: 0, spent: 0, missingPrice: 0, count: 0 });
    for (const it of activeItems) {
      const t = out.get(it.room);
      if (t) addLine(t, it);
    }
    return out;
  }, [activeItems, orderedRoomIds]);

  const byCategory = useMemo(() => {
    const out = new Map<string, Totals>();
    for (const it of activeItems) {
      const key = (it.category || "Other").trim() || "Other";
      if (!out.has(key)) out.set(key, { planned: 0, selected: 0, spent: 0, missingPrice: 0, count: 0 });
      addLine(out.get(key)!, it);
    }
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [activeItems]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-semibold">Totals</div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">Planned</div>
            <div className="mt-1 text-base font-semibold">{formatMoneyUSD(totals.planned)}</div>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">Selected</div>
            <div className="mt-1 text-base font-semibold">{formatMoneyUSD(totals.selected)}</div>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">Spent</div>
            <div className="mt-1 text-base font-semibold">{formatMoneyUSD(totals.spent)}</div>
          </div>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {totals.count} item(s). {totals.missingPrice} missing price.
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">By room</div>
        <div className="mt-3 space-y-2">
          {orderedRoomIds.map((r) => {
            const t = byRoom.get(r)!;
            const total = t.planned + t.selected + t.spent;
            return (
              <div key={r} className="rounded-lg border bg-background p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-base font-semibold">{roomNameById.get(r) || r}</div>
                  <div className="text-sm font-semibold">{formatMoneyUSD(total)}</div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <div>Planned</div>
                    <div className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.planned)}</div>
                  </div>
                  <div>
                    <div>Selected</div>
                    <div className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.selected)}</div>
                  </div>
                  <div>
                    <div>Spent</div>
                    <div className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.spent)}</div>
                  </div>
                </div>
                {t.missingPrice ? <div className="mt-2 text-xs text-muted-foreground">{t.missingPrice} missing price</div> : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">By category</div>
        <div className="mt-3 space-y-2">
          {byCategory.map(([cat, t]) => {
            const total = t.planned + t.selected + t.spent;
            return (
              <div key={cat} className="rounded-lg border bg-background p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 truncate text-base font-semibold">{cat}</div>
                  <div className="text-sm font-semibold">{formatMoneyUSD(total)}</div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <div>Planned</div>
                    <div className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.planned)}</div>
                  </div>
                  <div>
                    <div>Selected</div>
                    <div className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.selected)}</div>
                  </div>
                  <div>
                    <div>Spent</div>
                    <div className="mt-0.5 font-semibold text-foreground">{formatMoneyUSD(t.spent)}</div>
                  </div>
                </div>
                {t.missingPrice ? <div className="mt-2 text-xs text-muted-foreground">{t.missingPrice} missing price</div> : null}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
