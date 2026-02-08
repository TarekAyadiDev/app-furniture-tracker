import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useData } from "@/data/DataContext";
import type { Room, RoomId } from "@/lib/domain";
import { formatInAndCm } from "@/lib/format";
import { DragReorderList } from "@/components/reorder/DragReorderList";
import { formatRectInAndCm, pickRoomGlobalDims } from "@/lib/fit";
import { useToast } from "@/hooks/use-toast";
import { normalizeRoomName } from "@/lib/rooms";

export default function Rooms() {
  const nav = useNavigate();
  const { toast } = useToast();
  const { rooms, orderedRooms, roomNameById, measurements, items, reorderRooms, createRoom, updateRoom, deleteRoom } = useData();
  const [reorderMode, setReorderMode] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);

  const roomNotes = useMemo(() => {
    const m = new Map<RoomId, string>();
    for (const r of rooms) m.set(r.id, r.notes || "");
    return m;
  }, [rooms]);

  const itemCountByRoom = useMemo(() => {
    const m = new Map<RoomId, number>();
    for (const r of orderedRooms) m.set(r.id, 0);
    for (const it of items) {
      if (it.syncState === "deleted") continue;
      m.set(it.room, (m.get(it.room) || 0) + 1);
    }
    return m;
  }, [items, orderedRooms]);

  const measurementCountByRoom = useMemo(() => {
    const m = new Map<RoomId, number>();
    for (const r of orderedRooms) m.set(r.id, 0);
    for (const meas of measurements) {
      if (meas.syncState === "deleted") continue;
      m.set(meas.room, (m.get(meas.room) || 0) + 1);
    }
    return m;
  }, [measurements, orderedRooms]);

  const measurementByRoom = useMemo(() => {
    const m = new Map<RoomId, typeof measurements>();
    for (const r of orderedRooms) m.set(r.id, []);
    for (const meas of measurements) {
      if (meas.syncState === "deleted") continue;
      if (!m.has(meas.room)) m.set(meas.room, []);
      m.get(meas.room)?.push(meas);
    }
    for (const r of orderedRooms) {
      const list = m.get(r.id) || [];
      list.sort((a, b) => {
        const sa = typeof a.sort === "number" ? a.sort : 999999;
        const sb = typeof b.sort === "number" ? b.sort : 999999;
        if (sa !== sb) return sa - sb;
        return a.label.localeCompare(b.label);
      });
      m.set(r.id, list);
    }
    return m;
  }, [measurements, orderedRooms]);

  async function onAddRoom() {
    const name = normalizeRoomName(newRoomName);
    if (!name) return;
    const existing = orderedRooms.find((r) => normalizeRoomName(r.name).toLowerCase() === name.toLowerCase());
    if (existing) {
      toast({ title: "Room already exists", description: existing.name });
      setNewRoomName("");
      return;
    }
    const id = await createRoom(name);
    if (id) {
      toast({ title: "Room added", description: name });
      setNewRoomName("");
    }
  }

  async function onRenameRoom(room: Room) {
    const next = prompt(`Rename "${room.name}" to:`, room.name)?.trim();
    if (!next || next === room.name) return;
    const normalized = normalizeRoomName(next);
    if (!normalized) return;
    const clash = orderedRooms.find(
      (r) => r.id !== room.id && normalizeRoomName(r.name).toLowerCase() === normalized.toLowerCase(),
    );
    if (clash) {
      toast({ title: "Room name already used", description: clash.name });
      return;
    }
    await updateRoom(room.id, { name: normalized });
    toast({ title: "Room renamed", description: normalized });
  }

  async function onDeleteRoom(room: Room) {
    if (orderedRooms.length <= 1) {
      toast({ title: "Can't delete last room", description: "Create another room first." });
      return;
    }
    const itemCount = itemCountByRoom.get(room.id) || 0;
    const measCount = measurementCountByRoom.get(room.id) || 0;
    if (itemCount || measCount) {
      const choices = orderedRooms.filter((r) => r.id !== room.id);
      const suggested = choices[0];
      const dest = prompt(
        `"${room.name}" has ${itemCount} item(s) and ${measCount} measurement(s).\n` +
          `Type destination room name to move them:`,
        suggested?.name || "",
      );
      if (!dest) return;
      const destName = normalizeRoomName(dest).toLowerCase();
      const target =
        choices.find((r) => normalizeRoomName(r.name).toLowerCase() === destName) ||
        choices.find((r) => String(r.id).toLowerCase() === destName);
      if (!target) {
        toast({ title: "Room not found", description: dest });
        return;
      }
      await deleteRoom(room.id, { moveTo: target.id });
      toast({ title: "Room deleted", description: `Moved items to ${target.name}` });
      return;
    }
    if (!confirm(`Delete room "${room.name}"?`)) return;
    await deleteRoom(room.id);
    toast({ title: "Room deleted", description: room.name });
  }

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="text-sm font-semibold">Add room</div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            placeholder="e.g. Office, Nursery, Patio..."
            className="h-11 flex-1 text-base"
          />
          <Button className="h-11" onClick={() => void onAddRoom()}>
            Add
          </Button>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">Rooms are used across Items, Shopping, and Measurements.</div>
      </Card>

      {orderedRooms.map((room) => {
        const rid = room.id;
        const roomLabel = roomNameById.get(rid) || room.name || rid;
        const list = measurementByRoom.get(rid) || [];
        const general = list.filter((m) => !m.forCategory && !m.forItemId);
        const global = pickRoomGlobalDims(general);
        const sizeText =
          global.w && global.d
            ? formatRectInAndCm(global.w.valueIn, global.d.valueIn)
            : global.w
              ? formatInAndCm(global.w.valueIn)
              : "";
        const snippet = (roomNotes.get(rid) || "").trim();
        const preview = snippet ? (snippet.length > 120 ? `${snippet.slice(0, 120)}\u2026` : snippet) : "";
        const top = list.slice(0, 2);
        return (
          <Card key={rid} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-base font-semibold">
                  {roomLabel}
                  {sizeText ? <span className="ml-2 text-xs font-normal text-muted-foreground">{sizeText}</span> : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{list.length} measurement(s)</div>
                {preview ? <div className="mt-2 whitespace-pre-wrap text-sm">{preview}</div> : null}
                {top.length ? (
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {top.map((m) => (
                      <div key={m.id} className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0 truncate">{m.label}</div>
                        <div className="shrink-0 font-medium text-foreground">{formatInAndCm(m.valueIn)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <Button variant="secondary" onClick={() => nav(`/rooms/${encodeURIComponent(rid)}`)}>
                  Open
                </Button>
                <Button variant="secondary" onClick={() => void onRenameRoom(room)}>
                  Rename
                </Button>
                <Button variant="destructive" onClick={() => void onDeleteRoom(room)}>
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        );
      })}

      <Card className="p-4">
        <div className="text-sm font-semibold">Reorder rooms</div>
        <div className="mt-1 text-xs text-muted-foreground">Drag the handle to reorder rooms.</div>
        {reorderMode ? (
          <div className="mt-3">
            <DragReorderList
              ariaLabel="Reorder rooms"
              items={orderedRooms.map((r) => ({ id: r.id, title: roomNameById.get(r.id) || r.name || r.id }))}
              onCommit={async (ids) => {
                await reorderRooms(ids as RoomId[]);
              }}
            />
          </div>
        ) : null}
        <div className="mt-3">
          <Button
            variant={reorderMode ? "default" : "secondary"}
            className="w-full"
            onClick={() => setReorderMode((v) => !v)}
          >
            {reorderMode ? "Done" : "Reorder"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
