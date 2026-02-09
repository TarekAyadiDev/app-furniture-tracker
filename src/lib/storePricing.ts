import type { Item, Option, Store } from "@/lib/domain";

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

export function optionBaseDiscountAmount(opt: Option): number {
  const base = optionPreDiscountTotalOrNull(opt);
  const value = typeof opt.discountValue === "number" ? opt.discountValue : null;
  const type = opt.discountType === "percent" || opt.discountType === "amount" ? opt.discountType : null;
  const computed = computeDiscountAmount(base, type, value);
  if (computed !== null) return computed;
  return typeof opt.discount === "number" ? opt.discount : 0;
}

export function optionDiscountAmountWithStore(opt: Option, store: Store | null): number {
  const base = optionPreDiscountTotalOrNull(opt);
  if (base === null) return 0;
  const baseDiscount = optionBaseDiscountAmount(opt);
  const storeDiscount = store ? computeDiscountAmount(base, store.discountType, store.discountValue) || 0 : 0;
  return baseDiscount + storeDiscount;
}

export function optionTotalWithStore(opt: Option, store: Store | null): number | null {
  const base = optionPreDiscountTotalOrNull(opt);
  if (base === null) return null;
  return base - optionDiscountAmountWithStore(opt, store);
}
