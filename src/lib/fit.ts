import type { Item, Measurement } from "@/lib/domain";
import { formatNumber, inchesToCm } from "@/lib/format";

export type ItemDimsIn = {
  wIn: number | null;
  dIn: number | null;
  hIn: number | null;
};

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function getItemDimsIn(item: Item): ItemDimsIn {
  const fromDims = item.dimensions || {};
  let wIn = typeof fromDims.wIn === "number" && Number.isFinite(fromDims.wIn) ? fromDims.wIn : null;
  let dIn = typeof fromDims.dIn === "number" && Number.isFinite(fromDims.dIn) ? fromDims.dIn : null;
  let hIn = typeof fromDims.hIn === "number" && Number.isFinite(fromDims.hIn) ? fromDims.hIn : null;

  const specs = item.specs && typeof item.specs === "object" ? item.specs : null;
  if (specs) {
    // Common conventions: length_in / width_in / depth_in / height_in / diameter_in
    if (wIn === null) wIn = toNum((specs as any).width_in) ?? toNum((specs as any).length_in) ?? null;
    if (dIn === null) dIn = toNum((specs as any).depth_in) ?? null;
    if (hIn === null) hIn = toNum((specs as any).height_in) ?? null;
    const dia = toNum((specs as any).diameter_in);
    if (dia !== null) {
      if (wIn === null) wIn = dia;
      if (dIn === null) dIn = dia;
    }
  }

  return { wIn, dIn, hIn };
}

export function formatDimsCompact(d: ItemDimsIn) {
  const parts: string[] = [];
  if (d.wIn !== null) parts.push(formatNumber(d.wIn, 1));
  if (d.dIn !== null) parts.push(formatNumber(d.dIn, 1));
  if (d.hIn !== null) parts.push(formatNumber(d.hIn, 1));
  if (!parts.length) return "";
  return `${parts.join("x")} in`;
}

export function formatRectInAndCm(wIn: number, dIn: number, digitsIn = 1, digitsCm = 1) {
  const wCm = inchesToCm(wIn);
  const dCm = inchesToCm(dIn);
  return `${formatNumber(wIn, digitsIn)} x ${formatNumber(dIn, digitsIn)} in (${formatNumber(wCm, digitsCm)} x ${formatNumber(dCm, digitsCm)} cm)`;
}

function normalizeText(s: string) {
  return s.toLowerCase();
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((n) => haystack.includes(n));
}

function forCategoryMatches(m: Measurement, category: string) {
  const a = String(m.forCategory || "").trim().toLowerCase();
  const b = String(category || "").trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}

function categoryKeywords(item: Item) {
  const cat = normalizeText(item.category || "");
  const name = normalizeText(item.name || "");
  const keys: string[] = [];
  if (cat.includes("sofa") || name.includes("sofa") || cat.includes("sectional")) keys.push("sofa");
  if (cat.includes("dining") || name.includes("dining")) keys.push("dining");
  if (cat.includes("bed") || name.includes("bed") || cat.includes("mattress")) keys.push("bed");
  if (item.room === "Balcony" || cat.includes("outdoor") || name.includes("balcony")) keys.push("balcony");
  if (cat.includes("tv")) keys.push("tv");
  if (cat.includes("console")) keys.push("console");
  return keys;
}

type DimKey = "w" | "d" | "h";

function dimLabelKeywords(dim: DimKey) {
  if (dim === "w") return ["width", "wall", "length"];
  if (dim === "d") return ["depth", "distance"];
  return ["height"];
}

function scoreMeasurementForDim(m: Measurement, item: Item, dim: DimKey) {
  const label = normalizeText(m.label || "");
  const keys = categoryKeywords(item);
  const dimKeys = dimLabelKeywords(dim);

  // Skip irrelevant measurements for this dimension.
  if (!includesAny(label, dimKeys)) return -1;

  let score = 0;
  if (m.forItemId && m.forItemId === item.id) score += 50;
  if (forCategoryMatches(m, item.category)) score += 25;
  for (const k of keys) if (label.includes(k)) score += 6;
  for (const k of dimKeys) if (label.includes(k)) score += 4;
  if (label.includes("usable")) score += 1;
  if (label.includes("zone")) score += 1;
  return score;
}

export function pickRoomGlobalDims(measurements: Measurement[]) {
  const ms = measurements.filter((m) => m.syncState !== "deleted");
  const w = [...ms]
    .filter((m) => includesAny(normalizeText(m.label || ""), dimLabelKeywords("w")))
    .sort((a, b) => {
      const sa = typeof a.sort === "number" ? a.sort : 999999;
      const sb = typeof b.sort === "number" ? b.sort : 999999;
      if (sa !== sb) return sa - sb;
      return a.label.localeCompare(b.label);
    })[0];
  const d = [...ms]
    .filter((m) => includesAny(normalizeText(m.label || ""), dimLabelKeywords("d")))
    .sort((a, b) => {
      const sa = typeof a.sort === "number" ? a.sort : 999999;
      const sb = typeof b.sort === "number" ? b.sort : 999999;
      if (sa !== sb) return sa - sb;
      return a.label.localeCompare(b.label);
    })[0];

  if (!w || !d) return { w: w || null, d: d || null };
  if (w.id === d.id) return { w, d: null as any };
  return { w, d };
}

export type FitWarning = {
  dim: DimKey;
  message: string;
  measurement?: { id: string; label: string; valueIn: number };
};

export function computeItemFitWarnings(item: Item, roomMeasurements: Measurement[]): FitWarning[] {
  const dims = getItemDimsIn(item);
  const ms = roomMeasurements.filter((m) => m.syncState !== "deleted");

  function pick(dim: DimKey): Measurement | null {
    let best: { m: Measurement; score: number } | null = null;
    for (const m of ms) {
      const score = scoreMeasurementForDim(m, item, dim);
      if (score < 0) continue;
      if (!best || score > best.score) best = { m, score };
    }
    return best ? best.m : null;
  }

  const wMeas = pick("w");
  const dMeas = pick("d");
  const hMeas = pick("h");

  const warnings: FitWarning[] = [];
  const EPS = 0.25; // avoid noisy warnings from rounding

  if (dims.wIn !== null && wMeas && typeof wMeas.valueIn === "number") {
    if (dims.wIn > wMeas.valueIn + EPS) {
      warnings.push({
        dim: "w",
        message: `Width ${formatNumber(dims.wIn, 1)} in exceeds ${wMeas.label} (${formatNumber(wMeas.valueIn, 1)} in)`,
        measurement: { id: wMeas.id, label: wMeas.label, valueIn: wMeas.valueIn },
      });
    }
  }
  if (dims.dIn !== null && dMeas && typeof dMeas.valueIn === "number") {
    if (dims.dIn > dMeas.valueIn + EPS) {
      warnings.push({
        dim: "d",
        message: `Depth ${formatNumber(dims.dIn, 1)} in exceeds ${dMeas.label} (${formatNumber(dMeas.valueIn, 1)} in)`,
        measurement: { id: dMeas.id, label: dMeas.label, valueIn: dMeas.valueIn },
      });
    }
  }
  if (dims.hIn !== null && hMeas && typeof hMeas.valueIn === "number") {
    if (dims.hIn > hMeas.valueIn + EPS) {
      warnings.push({
        dim: "h",
        message: `Height ${formatNumber(dims.hIn, 1)} in exceeds ${hMeas.label} (${formatNumber(hMeas.valueIn, 1)} in)`,
        measurement: { id: hMeas.id, label: hMeas.label, valueIn: hMeas.valueIn },
      });
    }
  }

  return warnings;
}

