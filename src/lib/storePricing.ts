import { inferItemKind, type Item, type Option, type Store, type SubItem } from "@/lib/domain";

export function normalizeStoreName(value: unknown): string {
  return String(value ?? "").trim();
}

export function storeKey(value: unknown): string {
  return normalizeStoreName(value).toLowerCase();
}

export function buildStoreIndex(stores: Store[]): Map<string, Store> {
  const map = new Map<string, Store>();
  for (const s of stores) {
    if (s.syncState === "deleted") continue;
    const key = storeKey(s.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, s);
  }
  return map;
}

export function orderStores(stores: Store[]): Store[] {
  const live = stores.filter((s) => s.syncState !== "deleted");
  return [...live].sort((a, b) => {
    const sa = typeof a.sort === "number" ? a.sort : 999999;
    const sb = typeof b.sort === "number" ? b.sort : 999999;
    if (sa !== sb) return sa - sb;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });
}

export function findStoreByName(stores: Store[], name: string | null | undefined): Store | null {
  const key = storeKey(name);
  if (!key) return null;
  return buildStoreIndex(stores).get(key) || null;
}

export function computeDiscountAmount(base: number | null, type: "amount" | "percent" | null | undefined, value: number | null | undefined): number | null {
  if (base === null) return null;
  if (typeof value !== "number" || value <= 0) return null;
  if (type === "amount") return value;
  if (type === "percent") return value >= 100 ? base : (base * value) / 100;
  return null;
}

export function itemBaseDiscountAmount(item: Item): number | null {
  const price = typeof item.price === "number" ? item.price : null;
  if (price === null) return null;
  return computeDiscountAmount(price, item.discountType, item.discountValue);
}

export function itemDiscountAmountWithStore(item: Item, store: Store | null): number | null {
  const price = typeof item.price === "number" ? item.price : null;
  if (price === null) return null;
  const itemDiscount = computeDiscountAmount(price, item.discountType, item.discountValue) || 0;
  const storeDiscount = store ? computeDiscountAmount(price, store.discountType, store.discountValue) || 0 : 0;
  const total = itemDiscount + storeDiscount;
  return total > 0 ? total : null;
}

export function optionPreDiscountTotalOrNull(opt: Option): number | null {
  const hasAny = typeof opt.price === "number" || typeof opt.shipping === "number" || typeof opt.taxEstimate === "number";
  if (!hasAny) return null;
  return (opt.price || 0) + (opt.shipping || 0) + (opt.taxEstimate || 0);
}

export function optionPreDiscountTotalWithStore(opt: Option, store: Store | null): number | null {
  const price = typeof opt.price === "number" ? opt.price : null;
  const tax = typeof opt.taxEstimate === "number" ? opt.taxEstimate : null;
  const explicitShipping = typeof opt.shipping === "number" ? opt.shipping : null;
  const fallbackShipping = explicitShipping !== null ? explicitShipping : typeof store?.shippingCost === "number" ? store.shippingCost : null;
  const hasAny = price !== null || tax !== null || explicitShipping !== null;
  if (!hasAny) return null;
  return (price || 0) + (tax || 0) + (fallbackShipping || 0);
}

export function optionBaseDiscountAmount(opt: Option, baseOverride?: number | null): number {
  const base = typeof baseOverride === "number" ? baseOverride : optionPreDiscountTotalOrNull(opt);
  const value = typeof opt.discountValue === "number" ? opt.discountValue : null;
  const type = opt.discountType === "percent" || opt.discountType === "amount" ? opt.discountType : null;
  const computed = computeDiscountAmount(base, type, value);
  if (computed !== null) return computed;
  return typeof opt.discount === "number" ? opt.discount : 0;
}

export function optionTotalWithoutStore(opt: Option): number | null {
  const base = optionPreDiscountTotalOrNull(opt);
  if (base === null) return null;
  return base - optionBaseDiscountAmount(opt, base);
}

export function optionDiscountAmountWithStore(opt: Option, store: Store | null): number {
  const base = optionPreDiscountTotalWithStore(opt, store);
  if (base === null) return 0;
  const baseDiscount = optionBaseDiscountAmount(opt, base);
  const storeDiscount = store ? computeDiscountAmount(base, store.discountType, store.discountValue) || 0 : 0;
  return baseDiscount + storeDiscount;
}

export function optionTotalWithStore(opt: Option, store: Store | null): number | null {
  const base = optionPreDiscountTotalWithStore(opt, store);
  if (base === null) return null;
  return base - optionDiscountAmountWithStore(opt, store);
}

function subItemPreDiscountTotalOrNull(sub: SubItem): number | null {
  const price = typeof sub.price === "number" ? sub.price : null;
  const tax = typeof sub.taxEstimate === "number" ? sub.taxEstimate : null;
  const warranty = typeof sub.extraWarrantyCost === "number" ? sub.extraWarrantyCost : null;
  const hasAny = price !== null || tax !== null || warranty !== null;
  if (!hasAny) return null;
  return (price || 0) + (tax || 0) + (warranty || 0);
}

function subItemQty(sub: SubItem): number {
  const raw = typeof sub.qty === "number" ? sub.qty : null;
  return raw !== null && raw > 0 ? Math.round(raw) : 1;
}

function subItemDiscountAmount(sub: SubItem, base: number): number {
  const value = typeof sub.discountValue === "number" ? sub.discountValue : 0;
  if (value <= 0) return 0;
  if (sub.discountType === "percent") {
    if (value >= 100) return base;
    return (base * value) / 100;
  }
  return Math.min(value, base);
}

export type StoreTotals = {
  total: number;
  storeDiscount: number;
  storeShipping: number;
  storeWarranty: number;
  storeTax: number;
  appliedItemId: string | null;
};

export type StoreAllocation = {
  itemTotals: Map<string, number | null>;
  itemBaseTotals: Map<string, number | null>;
  itemDiscountTotals: Map<string, number>;
  itemStoreKey: Map<string, string | null>;
  storeTotals: Map<string, StoreTotals>;
};

export function computeStoreAllocation(
  items: Item[],
  selectedOptionsByItem: Map<string, Option[]>,
  storeByName: Map<string, Store>,
  subItemsByOption?: Map<string, SubItem[]>,
  hasOptionsByItem?: Set<string>,
): StoreAllocation {
  const itemTotals = new Map<string, number | null>();
  const itemBaseTotals = new Map<string, number | null>();
  const itemDiscountTotals = new Map<string, number>();
  const itemStoreKey = new Map<string, string | null>();
  const storeTotals = new Map<string, StoreTotals>();
  const storeLines = new Map<string, { itemId: string; baseTotal: number }[]>();

  for (const item of items) {
    if (item.syncState === "deleted") continue;
    const hasOptions = hasOptionsByItem?.has(item.id) ?? false;
    const isPlaceholder = inferItemKind(item, hasOptions) === "placeholder";
    const selected = selectedOptionsByItem.get(item.id) || [];
    let baseTotal: number | null = null;
    let discountTotal = 0;
    if (selected.length) {
      let base = 0;
      let discount = 0;
      let hasAny = false;
      for (const opt of selected) {
        const subItems = subItemsByOption?.get(opt.id) || [];
        if (subItems.length) {
          let hasSubValues = false;
          for (const sub of subItems) {
            const preDiscount = subItemPreDiscountTotalOrNull(sub);
            if (preDiscount === null) continue;
            const subDiscount = subItemDiscountAmount(sub, preDiscount);
            const qty = subItemQty(sub);
            base += Math.max(0, preDiscount - subDiscount) * qty;
            discount += subDiscount * qty;
            hasAny = true;
            hasSubValues = true;
          }
          if (hasSubValues) continue;
          // If sub-items exist but no values are set, treat as missing for this option.
          continue;
        }

        const preDiscount = optionPreDiscountTotalOrNull(opt);
        if (preDiscount === null) continue;
        const optDiscountRaw = optionBaseDiscountAmount(opt, preDiscount);
        const optDiscount = Math.min(optDiscountRaw, preDiscount);
        base += Math.max(0, preDiscount - optDiscount);
        discount += optDiscount;
        hasAny = true;
      }
      if (hasAny) {
        const qty = item.qty || 1;
        baseTotal = base * qty;
        discountTotal = discount * qty;
      }
    } else {
      if (!isPlaceholder) {
        const price = typeof item.price === "number" ? item.price : null;
        if (price !== null) {
          const itemDiscountRaw = itemBaseDiscountAmount(item) || 0;
          const itemDiscount = Math.min(itemDiscountRaw, price);
          const qty = item.qty || 1;
          baseTotal = Math.max(0, price - itemDiscount) * qty;
          discountTotal = itemDiscount * qty;
        }
      }
    }

    itemBaseTotals.set(item.id, baseTotal);
    itemDiscountTotals.set(item.id, discountTotal);
    let key: string | null = null;
    if (selected.length) {
      key = storeKey(selected[0]?.store) || null;
    } else if (!isPlaceholder) {
      key = storeKey(item.store) || null;
    }
    itemStoreKey.set(item.id, key || null);

    if (baseTotal !== null && key) {
      if (!storeLines.has(key)) storeLines.set(key, []);
      storeLines.get(key)!.push({ itemId: item.id, baseTotal });
    } else {
      itemTotals.set(item.id, baseTotal);
    }
  }

  for (const [key, lines] of storeLines.entries()) {
    const store = storeByName.get(key) || null;
    const storeShipping = typeof store?.shippingCost === "number" ? store.shippingCost : 0;
    const storeWarranty = typeof store?.extraWarrantyCost === "number" ? store.extraWarrantyCost : 0;
    const storeTax = typeof store?.taxCost === "number" ? store.taxCost : 0;
    let maxLine = lines[0];
    for (const line of lines) {
      if (line.baseTotal > maxLine.baseTotal) maxLine = line;
    }
    const rawStoreDiscount = store ? computeDiscountAmount(maxLine.baseTotal, store.discountType, store.discountValue) || 0 : 0;
    const storeDiscount = Math.min(rawStoreDiscount, maxLine.baseTotal);

    let storeTotal = 0;
    for (const line of lines) {
      const hasStoreAdjustments =
        line.itemId === maxLine.itemId && (storeShipping !== 0 || storeWarranty !== 0 || storeTax !== 0 || storeDiscount !== 0);
      const lineTotal = hasStoreAdjustments
        ? Math.max(0, line.baseTotal + storeShipping + storeWarranty + storeTax - storeDiscount)
        : line.baseTotal;
      const prev = itemTotals.get(line.itemId);
      itemTotals.set(line.itemId, typeof prev === "number" ? prev + lineTotal : lineTotal);
      if (hasStoreAdjustments && storeDiscount) {
        itemDiscountTotals.set(line.itemId, (itemDiscountTotals.get(line.itemId) || 0) + storeDiscount);
      }
      storeTotal += lineTotal;
    }

    storeTotals.set(key, { total: storeTotal, storeDiscount, storeShipping, storeWarranty, storeTax, appliedItemId: maxLine.itemId });
  }

  return { itemTotals, itemBaseTotals, itemDiscountTotals, itemStoreKey, storeTotals };
}
