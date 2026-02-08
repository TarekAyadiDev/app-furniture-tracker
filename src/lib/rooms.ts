import type { Room, RoomId } from "@/lib/domain";

export function normalizeRoomName(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

export function ensureRoomNames(rooms: Room[]): Room[] {
  return rooms.map((r) => ({
    ...r,
    name: normalizeRoomName(r.name || r.id || "Room") || "Room",
  }));
}

export function orderRooms(rooms: Room[]): Room[] {
  const live = rooms.filter((r) => r.syncState !== "deleted");
  return [...live].sort((a, b) => {
    const sa = typeof a.sort === "number" ? a.sort : 999999;
    const sb = typeof b.sort === "number" ? b.sort : 999999;
    if (sa !== sb) return sa - sb;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });
}

export function buildRoomNameMap(rooms: Room[]): Map<RoomId, string> {
  const map = new Map<RoomId, string>();
  for (const r of rooms) {
    if (r.syncState === "deleted") continue;
    map.set(r.id, normalizeRoomName(r.name || r.id));
  }
  return map;
}

export function getRoomLabel(roomNames: Map<RoomId, string>, roomId: RoomId | null | undefined): string {
  if (!roomId) return "";
  return roomNames.get(roomId) || String(roomId);
}
