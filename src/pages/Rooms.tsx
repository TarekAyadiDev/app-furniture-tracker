import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useData } from "@/data/DataContext";
import { ROOMS, type RoomId } from "@/lib/domain";
import { formatInAndCm } from "@/lib/format";
import { DragReorderList } from "@/components/reorder/DragReorderList";
import { formatRectInAndCm, pickRoomGlobalDims } from "@/lib/fit";

export default function Rooms() {
  const nav = useNavigate();
  const { rooms, measurements, reorderRooms } = useData();
  const [reorderMode, setReorderMode] = useState(false);

  const orderedRoomIds = useMemo(() => {
    const byId = new Map(rooms.filter((r) => r.syncState !== "deleted").map((r) => [r.id, r] as const));
    const base = ROOMS.map((rid, idx) => {
      const r = byId.get(rid);
      const sort = typeof r?.sort === "number" ? r.sort : idx;
      return { id: rid, sort, idx };
    });
    base.sort((a, b) => (a.sort !== b.sort ? a.sort - b.sort : a.idx - b.idx));
    return base.map((x) => x.id);
  }, [rooms]);

  const roomNotes = useMemo(() => {
    const m = new Map<RoomId, string>();
    for (const r of rooms) m.set(r.id, r.notes || "");
    return m;
  }, [rooms]);

  const measurementByRoom = useMemo(() => {
    const m = new Map<RoomId, typeof measurements>();
    for (const r of ROOMS) m.set(r, []);
    for (const meas of measurements) {
      if (meas.syncState === "deleted") continue;
      m.get(meas.room)?.push(meas);
    }
    for (const r of ROOMS) {
      const list = m.get(r) || [];
      list.sort((a, b) => {
        const sa = typeof a.sort === "number" ? a.sort : 999999;
        const sb = typeof b.sort === "number" ? b.sort : 999999;
        if (sa !== sb) return sa - sb;
        return a.label.localeCompare(b.label);
      });
      m.set(r, list);
    }
    return m;
  }, [measurements]);

  return (
    <div className="space-y-3">
      {orderedRoomIds.map((rid) => {
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
                  {rid}
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
              <Button variant="secondary" onClick={() => nav(`/rooms/${rid}`)}>
                Open
              </Button>
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
              items={orderedRoomIds.map((rid) => ({ id: rid, title: rid }))}
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
