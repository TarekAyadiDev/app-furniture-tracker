import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/data/DataContext";
import type { Store } from "@/lib/domain";
import { formatMoneyUSD, parseNumberOrNull } from "@/lib/format";
import { normalizeStoreName, storeKey } from "@/lib/storePricing";
import { useToast } from "@/hooks/use-toast";
import { DragReorderList } from "@/components/reorder/DragReorderList";

export default function Stores() {
  const { toast } = useToast();
  const { stores, orderedStores, items, options, createStore, updateStore, deleteStore, reorderStores } = useData();
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [reorderMode, setReorderMode] = useState(false);

  const usageByStore = useMemo(() => {
    const map = new Map<string, { items: number; options: number }>();
    const bump = (name: string | null | undefined, key: "items" | "options") => {
      const k = storeKey(name);
      if (!k) return;
      if (!map.has(k)) map.set(k, { items: 0, options: 0 });
      map.get(k)![key] += 1;
    };
    for (const it of items) {
      if (it.syncState === "deleted") continue;
      bump(it.store, "items");
    }
    for (const opt of options) {
      if (opt.syncState === "deleted") continue;
      bump(opt.store, "options");
    }
    return map;
  }, [items, options]);

  async function onAddStore() {
    const name = normalizeStoreName(newName);
    if (!name) return;
    const existing = orderedStores.find((s) => storeKey(s.name) === storeKey(name));
    if (existing) {
      toast({ title: "Store already exists", description: existing.name });
      setNewName("");
      return;
    }
    const id = await createStore(name);
    if (id) {
      toast({ title: "Store added", description: name });
      setNewName("");
      setOpen((cur) => ({ ...cur, [id]: true }));
    }
  }

  async function onDeleteStore(store: Store) {
    const usage = usageByStore.get(storeKey(store.name));
    const usedItems = usage?.items || 0;
    const usedOptions = usage?.options || 0;
    const warning = usedItems || usedOptions ? ` This will clear the store from ${usedItems} item(s) and ${usedOptions} option(s).` : "";
    if (!confirm(`Delete "${store.name}"?${warning}`)) return;
    await deleteStore(store.id);
    toast({ title: "Store deleted", description: store.name });
  }

  function formatStoreDiscount(store: Store) {
    if (typeof store.discountValue !== "number" || store.discountValue <= 0) return "";
    if (store.discountType === "percent") return `${store.discountValue}%`;
    return formatMoneyUSD(store.discountValue);
  }

  return (
    <div className="space-y-5">
      <Card className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <label className="text-xs font-semibold uppercase tracking-widest text-primary">Add Store</label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Article, West Elm"
            className="h-12 flex-1 rounded-xl border-border/50 bg-background/50 text-base focus:ring-2 focus:ring-primary/30"
          />
          <Button className="h-12 rounded-xl px-6 transition-all duration-200 active:scale-[0.98]" onClick={() => void onAddStore()}>
            Add Store
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Store details apply to items and options using that store.</p>
      </Card>

      {orderedStores.length ? (
        orderedStores.map((store) => {
          const usage = usageByStore.get(storeKey(store.name)) || { items: 0, options: 0 };
          const isOpen = Boolean(open[store.id]);
          const discountLabel = formatStoreDiscount(store);
          return (
            <Card key={store.id} className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-heading text-lg font-semibold text-card-foreground">{store.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">items {usage.items}, options {usage.options}</p>
                  {discountLabel ? <p className="mt-2 text-xs text-muted-foreground">Discount: {discountLabel}</p> : null}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" className="rounded-xl" onClick={() => setOpen((cur) => ({ ...cur, [store.id]: !isOpen }))}>
                    {isOpen ? "Hide" : "Edit"}
                  </Button>
                  <Button variant="destructive" className="rounded-xl" onClick={() => void onDeleteStore(store)}>
                    Delete
                  </Button>
                </div>
              </div>

              {isOpen ? (
                <div className="mt-4 space-y-3 border-t pt-4">
                  <div className="space-y-1.5">
                    <Label>Store name</Label>
                    <Input
                      key={`${store.id}-name-${store.name}`}
                      defaultValue={store.name}
                      className="h-11 text-base"
                      onBlur={(e) => {
                        const next = e.target.value.trim() || store.name;
                        void updateStore(store.id, { name: next }).catch((err: any) => {
                          toast({ title: "Rename failed", description: err?.message || "Store name already exists." });
                        });
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Discount type</Label>
                      <select
                        value={store.discountType || ""}
                        onChange={(e) => void updateStore(store.id, { discountType: (e.target.value as Store["discountType"]) || null })}
                        className="h-11 w-full rounded-md border bg-background px-3 text-base"
                      >
                        <option value="">(none)</option>
                        <option value="amount">Amount</option>
                        <option value="percent">Percent</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Discount value</Label>
                      <Input
                        key={`${store.id}-discount-${store.discountType ?? ""}-${store.discountValue ?? ""}`}
                        inputMode="decimal"
                        defaultValue={typeof store.discountValue === "number" ? String(store.discountValue) : ""}
                        placeholder={store.discountType === "percent" ? "%" : "$"}
                        className="h-11 text-base"
                        onBlur={(e) => void updateStore(store.id, { discountValue: parseNumberOrNull(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Delivery info</Label>
                      <Textarea
                        key={`${store.id}-delivery-${store.deliveryInfo ?? ""}`}
                        defaultValue={store.deliveryInfo || ""}
                        className="min-h-[72px] resize-none text-base"
                        onBlur={(e) => void updateStore(store.id, { deliveryInfo: e.target.value.trim() || null })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Extra warranty</Label>
                      <Textarea
                        key={`${store.id}-warranty-${store.extraWarranty ?? ""}`}
                        defaultValue={store.extraWarranty || ""}
                        className="min-h-[72px] resize-none text-base"
                        onBlur={(e) => void updateStore(store.id, { extraWarranty: e.target.value.trim() || null })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Trial</Label>
                      <Textarea
                        key={`${store.id}-trial-${store.trial ?? ""}`}
                        defaultValue={store.trial || ""}
                        className="min-h-[72px] resize-none text-base"
                        onBlur={(e) => void updateStore(store.id, { trial: e.target.value.trim() || null })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>APR</Label>
                      <Input
                        key={`${store.id}-apr-${store.apr ?? ""}`}
                        defaultValue={store.apr || ""}
                        className="h-11 text-base"
                        onBlur={(e) => void updateStore(store.id, { apr: e.target.value.trim() || null })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Notes</Label>
                    <Textarea
                      key={`${store.id}-notes-${store.notes ?? ""}`}
                      defaultValue={store.notes || ""}
                      className="min-h-[88px] resize-none text-base"
                      onBlur={(e) => void updateStore(store.id, { notes: e.target.value.trim() || null })}
                    />
                  </div>
                </div>
              ) : null}
            </Card>
          );
        })
      ) : (
        <Card className="rounded-2xl border border-border p-5">
          <p className="text-sm text-muted-foreground">No stores yet. Add one to start building store policies.</p>
        </Card>
      )}

      <Card className="rounded-2xl border border-border p-4 shadow-sm">
        <h2 className="font-heading text-lg text-foreground">Reorder stores</h2>
        <p className="mt-1 text-xs text-muted-foreground">Drag the handle to reorder stores.</p>
        {reorderMode ? (
          <div className="mt-3">
            <DragReorderList
              ariaLabel="Reorder stores"
              items={orderedStores.map((s) => ({ id: s.id, title: s.name }))}
              onCommit={async (ids) => {
                await reorderStores(ids as string[]);
              }}
            />
          </div>
        ) : null}
        <div className="mt-3">
          <Button
            variant={reorderMode ? "default" : "secondary"}
            className="w-full rounded-xl transition-all duration-150 active:scale-[0.98]"
            onClick={() => setReorderMode((v) => !v)}
          >
            {reorderMode ? "Done" : "Reorder"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
