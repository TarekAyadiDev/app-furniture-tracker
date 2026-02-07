import { GripVertical } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";

type DragItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
};

function move<T>(arr: T[], from: number, to: number) {
  if (from === to) return arr;
  const next = arr.slice();
  const [picked] = next.splice(from, 1);
  next.splice(to, 0, picked);
  return next;
}

export function DragReorderList({
  items,
  onCommit,
  ariaLabel,
}: {
  items: DragItem[];
  onCommit: (orderedIds: string[]) => void | Promise<void>;
  ariaLabel?: string;
}) {
  const idsFromProps = useMemo(() => items.map((i) => i.id), [items]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [order, setOrder] = useState<string[]>(idsFromProps);
  const orderRef = useRef<string[]>(idsFromProps);
  useEffect(() => {
    setOrder(idsFromProps);
  }, [idsFromProps]);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const startOrderRef = useRef<string[] | null>(null);

  function startDrag(id: string, e: React.PointerEvent<HTMLButtonElement>) {
    // Only primary button for mouse; allow touch/pen.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    draggingIdRef.current = id;
    startOrderRef.current = orderRef.current;
    setDraggingId(id);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handleMove(e: React.PointerEvent<HTMLButtonElement>) {
    const id = draggingIdRef.current;
    if (!id) return;
    e.preventDefault();

    const ids = orderRef.current;
    const from = ids.indexOf(id);
    if (from < 0) return;

    const y = e.clientY;
    let to = -1;

    for (let idx = 0; idx < ids.length; idx++) {
      const el = refs.current[ids[idx] || ""];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (y < mid) {
        to = idx;
        break;
      }
    }
    if (to === -1) to = ids.length - 1;
    if (to === from) return;

    const next = move(ids, from, to);
    setOrder(next);
  }

  async function endDrag(e: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingIdRef.current) return;
    e.preventDefault();
    const start = startOrderRef.current || [];
    const next = orderRef.current;
    draggingIdRef.current = null;
    startOrderRef.current = null;
    setDraggingId(null);
    if (start.join("|") !== next.join("|")) await onCommit(next);
  }

  return (
    <div role="list" aria-label={ariaLabel} className="space-y-2">
      {order.map((id) => {
        const item = itemById.get(id);
        if (!item) return null;
        const dragging = draggingId === id;
        return (
          <div
            key={id}
            ref={(el) => {
              refs.current[id] = el;
            }}
            role="listitem"
            className={[
              "flex items-center justify-between gap-3 rounded-lg border bg-background p-3",
              dragging ? "border-foreground shadow-sm" : "",
            ].join(" ")}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{item.title}</div>
              {item.subtitle ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.subtitle}</div> : null}
            </div>

            {item.right ? <div className="shrink-0">{item.right}</div> : null}

            <button
              type="button"
              className={[
                "touch-none select-none rounded-md border bg-background p-2 text-muted-foreground hover:text-foreground",
                dragging ? "border-foreground text-foreground" : "",
              ].join(" ")}
              aria-label={`Drag to reorder ${item.title}`}
              onPointerDown={(e) => startDrag(id, e)}
              onPointerMove={(e) => handleMove(e)}
              onPointerUp={(e) => void endDrag(e)}
              onPointerCancel={(e) => void endDrag(e)}
            >
              <GripVertical className="h-5 w-5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

