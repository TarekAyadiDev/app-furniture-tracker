import type { Room } from "@/lib/domain";
import { DEFAULT_ROOMS } from "@/lib/domain";
import { nowMs } from "@/lib/format";

export const DEFAULT_HOME = {
  name: "Town Hollywood",
  tags: ["furniture", "Town"],
  description:
    "Town Hollywood (layout B1.1 \u2013 2 bed / 2 bath). Interior 1,094 sq ft; Balcony 243 sq ft; Total 1,337 sq ft.\n\nBest approach: use sq ft for rough sizing, then take quick real measurements for perfect fit.",
};

export function makeDefaultRooms(): Room[] {
  const t = nowMs();
  return DEFAULT_ROOMS.map((name, idx) => ({
    id: name,
    name,
    notes: "",
    sort: idx,
    createdAt: t,
    updatedAt: t,
    syncState: "dirty",
  }));
}
