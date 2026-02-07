export function formatMoneyUSD(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${value.toFixed(0)}`;
  }
}

export function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value);
  } catch {
    return value.toFixed(digits);
  }
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function inchesToCm(inches: number) {
  return inches * 2.54;
}

export function cmToInches(cm: number) {
  return cm / 2.54;
}

export function formatInAndCm(inches: number, digitsIn = 1, digitsCm = 1) {
  const cm = inchesToCm(inches);
  return `${formatNumber(inches, digitsIn)} in (${formatNumber(cm, digitsCm)} cm)`;
}

export function parseNumberOrNull(input: string) {
  const t = input.trim();
  if (!t) return null;
  const cleaned = t.replace(/[^0-9.+-]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function nowMs() {
  return Date.now();
}

