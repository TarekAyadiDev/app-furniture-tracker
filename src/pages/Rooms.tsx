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
  const { rooms, orderedRooms, roomNameById, measurements, reorderRooms, createRoom, updateRoom } = useData();
  const [reorderMode, setReorderMode] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");

  const orderedRoomIds = useMemo(() => orderedRooms.map((r) => r.id), [orderedRooms]);

  const roomNotes = useMemo(() => {
    const m = new Map<RoomId, string>();
    for (const r of rooms) m.set(r.id, r.notes || "");
    return m;
  }, [rooms]);

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

  return (
    <div className="space-y-5">
      <Card className="glass rounded-2xl border border-border/50 p-5 shadow-elegant">
        <label className="text-xs font-semibold uppercase tracking-widest text-primary">Add Room</label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <Input
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            placeholder="e.g. Office, Nursery, Patio..."
            className="h-12 flex-1 rounded-xl border-border/50 bg-background/50 text-base focus:ring-2 focus:ring-primary/30"
          />
          <Button className="h-12 rounded-xl px-6 transition-all duration-200 active:scale-[0.98]" onClick={() => void onAddRoom()}>
            Add Room
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Rooms organize your furniture across all pages.</p>
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
          <Card key={rid} className="glass rounded-2xl border border-border/50 p-5 shadow-elegant transition-all duration-300 hover:shadow-lg hover:border-primary/20">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="font-heading text-lg font-semibold text-card-foreground">
                  {roomLabel}
                  {sizeText ? <span className="ml-2 text-xs font-normal text-muted-foreground">{sizeText}</span> : null}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{list.length} measurement(s)</p>
                {preview ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{preview}</p> : null}
                {top.length ? (
                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {top.map((m) => (
                      <div key={m.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs">
                        <span className="min-w-0 truncate font-medium text-muted-foreground">{m.label}</span>
                        <span className="shrink-0 font-bold text-foreground">{formatInAndCm(m.valueIn)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <Button variant="secondary" className="rounded-xl transition-all duration-150 active:scale-95" onClick={() => nav(`/rooms/${encodeURIComponent(rid)}`)}>
                  Open
                </Button>
                <Button variant="secondary" className="rounded-xl transition-all duration-150 active:scale-95" onClick={() => void onRenameRoom(room)}>
                  Rename
                </Button>
              </div>
            </div>
          </Card>
        );
      })}

      <Card className="rounded-2xl border border-border p-4 shadow-sm">
        <h2 className="font-heading text-lg text-foreground">Reorder rooms</h2>
        <p className="mt-1 text-xs text-muted-foreground">Drag the handle to reorder rooms.</p>
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
