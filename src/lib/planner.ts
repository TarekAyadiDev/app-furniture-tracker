import type { Measurement, PlannerAttachmentV1, RoomId } from "@/lib/domain";

export type PlannerChecklistKey = {
  key: string;
  constraintTags: string[];
};

export type RoomPlannerChecklist = {
  roomId: RoomId;
  sources: string[];
  keys: PlannerChecklistKey[];
};

function normalizeTokens(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[_/()]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function dedupeStrings(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const t = String(v || "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function dedupeByKey(arr: PlannerChecklistKey[]) {
  const out: PlannerChecklistKey[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const k = String(v.key || "").trim();
    if (!k) continue;
    const kk = k.toLowerCase();
    if (seen.has(kk)) continue;
    seen.add(kk);
    out.push({ key: k, constraintTags: dedupeStrings(v.constraintTags || []) });
  }
  return out;
}

function mapPlannerRoomNameToRoomId(nameRaw: unknown): RoomId | null {
  const name = String(nameRaw || "").trim();
  if (!name) return null;
  const n = name.toLowerCase();

  if (n.includes("balcony")) return "Balcony";
  if (n.includes("kitchen")) return "Kitchen";
  if (n.includes("dining")) return "Dining";
  if (n.includes("great room") || n.includes("living")) return "Living";
  if (n.includes("primary bedroom") || n.includes("master")) return "Master";
  if (n.includes("bedroom 2") || n.includes("bedroom2") || n.includes("second bedroom")) return "Bedroom2";
  if (n.includes("entry") || n.includes("foyer") || n.includes("hallway")) return "Entry";
  if (n.includes("bathroom") || n === "bath") return "Bath";

  return null;
}

export function getRoomPlannerChecklist(planner: PlannerAttachmentV1 | null, roomId: RoomId): RoomPlannerChecklist | null {
  const template: any = planner?.template;
  if (!template || typeof template !== "object") return null;
  if (!Array.isArray(template.rooms)) return null;

  const sources: string[] = [];
  const keys: PlannerChecklistKey[] = [];

  for (const r of template.rooms as any[]) {
    const rid = mapPlannerRoomNameToRoomId(r?.name);
    if (rid !== roomId) continue;

    const sourceName = String(r?.name || "").trim();
    if (sourceName) sources.push(sourceName);

    if (Array.isArray(r?.key_measures_to_capture)) {
      for (const km of r.key_measures_to_capture as any[]) {
        const key = typeof km?.key === "string" ? km.key.trim() : "";
        if (!key) continue;
        const constraintTags = Array.isArray(km?.constraint_tags)
          ? (km.constraint_tags as any[]).map(String).map((s) => s.trim()).filter(Boolean)
          : [];
        keys.push({ key, constraintTags });
      }
    }
  }

  const dedupedSources = dedupeStrings(sources);
  const dedupedKeys = dedupeByKey(keys);
  if (!dedupedSources.length && !dedupedKeys.length) return null;

  return { roomId, sources: dedupedSources, keys: dedupedKeys };
}

export function prettyPlannerKey(keyRaw: string) {
  const key = String(keyRaw || "").trim();
  if (!key) return "";
  const s = key.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return s.replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

export function suggestCategoryFromTags(tags: string[]) {
  const t = String(tags?.[0] || "").trim();
  if (!t) return "";
  return prettyPlannerKey(t);
}

export function matchPlannerKeyToMeasurements(
  key: PlannerChecklistKey,
  measurements: Measurement[],
): { state: "missing" | "maybe" | "captured"; match: Measurement | null } {
  const keyTokens = dedupeStrings([...normalizeTokens(key.key), ...key.constraintTags.flatMap(normalizeTokens)]);
  if (!keyTokens.length) return { state: "missing", match: null };

  // Simple heuristic: count token overlap between the planner key and existing measurement labels.
  let best: { score: number; meas: Measurement } | null = null;
  for (const m of measurements) {
    const labelTokens = new Set(normalizeTokens(m.label));
    let score = 0;
    for (const t of keyTokens) if (labelTokens.has(t)) score++;
    if (!best || score > best.score) best = { score, meas: m };
  }

  if (!best || best.score <= 0) return { state: "missing", match: null };
  if (best.score >= 2) return { state: "captured", match: best.meas };
  return { state: "maybe", match: best.meas };
}

