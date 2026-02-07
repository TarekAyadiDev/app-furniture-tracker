import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useData } from "@/data/DataContext";
import type { DataSource, ReviewStatus, RoomId } from "@/lib/domain";
import { ROOMS } from "@/lib/domain";
import { nowMs } from "@/lib/format";
import { markProvenanceNeedsReview, markProvenanceVerified, reviewStatusNeedsAttention } from "@/lib/provenance";

type TypeFilter = "All" | "measurement" | "item" | "option";
type RoomFilter = "All" | RoomId;
type StatusFilter = "All" | Exclude<ReviewStatus, "verified" | null>;
type DataSourceFilter = "All" | Exclude<DataSource, null> | "unknown";

type ReviewRow = {
  key: string;
  type: Exclude<TypeFilter, "All">;
  id: string;
  room: RoomId | null;
  title: string;
  subtitle?: string;
  href: string;
  reviewStatus: Exclude<ReviewStatus, null>;
  dataSource: DataSource;
  sourceRef: string | null;
  modifiedFields: string[];
  changeLog: Array<{ field: string; from: unknown; to: unknown; at: number; by: unknown; sessionId?: string }> | null;
};

type ChangeLogEntry = NonNullable<ReviewRow["changeLog"]>[number];

function reviewBadge(status: ReviewRow["reviewStatus"]) {
  switch (status) {
    case "verified":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "needs_review":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "ai_modified":
      return "border-violet-200 bg-violet-50 text-violet-900";
    default:
      return "border-slate-200 bg-slate-50 text-slate-900";
  }
}

function dataSourceBadge(ds: DataSource) {
  switch (ds) {
    case "concrete":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "estimated":
      return "border-slate-200 bg-slate-50 text-slate-900";
    default:
      return "border-slate-200 bg-background text-muted-foreground";
  }
}

function compactFieldList(fields: string[]) {
  const shown = fields.slice(0, 4);
  const rest = fields.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
}

function formatChangeValue(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "undefined") return "(missing)";
  if (typeof value === "string") return value.trim() || '""';
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(text: string, max = 72) {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}\u2026` : t;
}

export default function Review() {
  const nav = useNavigate();
  const { rooms, measurements, items, options, updateMeasurement, updateItem, updateOption } = useData();

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
  const [roomFilter, setRoomFilter] = useState<RoomFilter>("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [dataSourceFilter, setDataSourceFilter] = useState<DataSourceFilter>("All");
  const [busy, setBusy] = useState(false);
  const [openChanges, setOpenChanges] = useState<Record<string, boolean>>({});

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

  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it] as const)), [items]);

  const rows = useMemo((): ReviewRow[] => {
    const out: ReviewRow[] = [];

    for (const m of measurements) {
      if (m.syncState === "deleted") continue;
      const status = m.provenance?.reviewStatus ?? null;
      if (!reviewStatusNeedsAttention(status)) continue;
      out.push({
        key: `measurement:${m.id}`,
        type: "measurement",
        id: m.id,
        room: m.room,
        title: m.label,
        subtitle: `Room: ${m.room}`,
        href: `/rooms/${m.room}?editMeasurement=${encodeURIComponent(m.id)}`,
        reviewStatus: status || "needs_review",
        dataSource: m.provenance?.dataSource ?? null,
        sourceRef: m.provenance?.sourceRef ?? null,
        modifiedFields: Array.isArray(m.provenance?.modifiedFields) ? m.provenance?.modifiedFields : [],
        changeLog: Array.isArray(m.provenance?.changeLog) ? (m.provenance?.changeLog as any) : null,
      });
    }

    for (const it of items) {
      if (it.syncState === "deleted") continue;
      const status = it.provenance?.reviewStatus ?? null;
      if (!reviewStatusNeedsAttention(status)) continue;
      out.push({
        key: `item:${it.id}`,
        type: "item",
        id: it.id,
        room: it.room,
        title: it.name,
        subtitle: `Room: ${it.room} \u00b7 ${it.category}`,
        href: `/items/${it.id}`,
        reviewStatus: status || "needs_review",
        dataSource: it.provenance?.dataSource ?? null,
        sourceRef: it.provenance?.sourceRef ?? null,
        modifiedFields: Array.isArray(it.provenance?.modifiedFields) ? it.provenance?.modifiedFields : [],
        changeLog: Array.isArray(it.provenance?.changeLog) ? (it.provenance?.changeLog as any) : null,
      });
    }

    for (const op of options) {
      if (op.syncState === "deleted") continue;
      const status = op.provenance?.reviewStatus ?? null;
      if (!reviewStatusNeedsAttention(status)) continue;
      const parent = itemById.get(op.itemId);
      const room = parent?.room ?? null;
      out.push({
        key: `option:${op.id}`,
        type: "option",
        id: op.id,
        room,
        title: op.title,
        subtitle: parent ? `${parent.name} \u00b7 ${room ?? "Unknown room"}` : "Unknown item",
        href: parent ? `/items/${parent.id}?option=${encodeURIComponent(op.id)}` : `/items/${encodeURIComponent(op.itemId)}`,
        reviewStatus: status || "needs_review",
        dataSource: op.provenance?.dataSource ?? null,
        sourceRef: op.provenance?.sourceRef ?? null,
        modifiedFields: Array.isArray(op.provenance?.modifiedFields) ? op.provenance?.modifiedFields : [],
        changeLog: Array.isArray(op.provenance?.changeLog) ? (op.provenance?.changeLog as any) : null,
      });
    }

    out.sort((a, b) => {
      const rank = (s: ReviewRow["reviewStatus"]) => (s === "ai_modified" ? 0 : s === "needs_review" ? 1 : 2);
      const ra = rank(a.reviewStatus);
      const rb = rank(b.reviewStatus);
      if (ra !== rb) return ra - rb;
      return a.title.localeCompare(b.title);
    });

    return out;
  }, [itemById, items, measurements, options]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => (typeFilter === "All" ? true : r.type === typeFilter))
      .filter((r) => (roomFilter === "All" ? true : r.room === roomFilter))
      .filter((r) => (statusFilter === "All" ? true : r.reviewStatus === statusFilter))
      .filter((r) => {
        if (dataSourceFilter === "All") return true;
        const ds = r.dataSource ?? null;
        if (dataSourceFilter === "unknown") return ds === null;
        return ds === dataSourceFilter;
      })
      .filter((r) => {
        if (!needle) return true;
        const blob = `${r.title} ${r.subtitle || ""} ${r.sourceRef || ""} ${r.modifiedFields.join(" ")}`.toLowerCase();
        return blob.includes(needle);
      });
  }, [dataSourceFilter, q, roomFilter, rows, statusFilter, typeFilter]);

  async function markVerified(row: ReviewRow) {
    const at = nowMs();
    if (row.type === "measurement") {
      const m = measurements.find((x) => x.id === row.id);
      if (!m) return;
      await updateMeasurement(row.id, { provenance: markProvenanceVerified(m.provenance, at) });
      return;
    }
    if (row.type === "item") {
      const it = items.find((x) => x.id === row.id);
      if (!it) return;
      await updateItem(row.id, { provenance: markProvenanceVerified(it.provenance, at) });
      return;
    }
    const op = options.find((x) => x.id === row.id);
    if (!op) return;
    await updateOption(row.id, { provenance: markProvenanceVerified(op.provenance, at) });
  }

  async function markNeedsReview(row: ReviewRow) {
    const at = nowMs();
    if (row.type === "measurement") {
      const m = measurements.find((x) => x.id === row.id);
      if (!m) return;
      await updateMeasurement(row.id, { provenance: markProvenanceNeedsReview(m.provenance, at) });
      return;
    }
    if (row.type === "item") {
      const it = items.find((x) => x.id === row.id);
      if (!it) return;
      await updateItem(row.id, { provenance: markProvenanceNeedsReview(it.provenance, at) });
      return;
    }
    const op = options.find((x) => x.id === row.id);
    if (!op) return;
    await updateOption(row.id, { provenance: markProvenanceNeedsReview(op.provenance, at) });
  }

  async function markAllVisibleVerified() {
    if (!filtered.length) return;
    setBusy(true);
    try {
      for (const row of filtered) {
        await markVerified(row);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Review</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {filtered.length}/{rows.length} needing attention
            </div>
          </div>
          <Button variant="secondary" disabled={busy || !filtered.length} onClick={() => void markAllVisibleVerified()}>
            Mark all visible verified
          </Button>
        </div>

        <div className="mt-3 grid gap-3">
          <div>
            <Label htmlFor="review_search">Search</Label>
            <Input
              id="review_search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by name, room, fields..."
              className="mt-1 h-11 text-base"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Type</div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-base"
              >
                <option value="All">All</option>
                <option value="measurement">Measurements</option>
                <option value="item">Items</option>
                <option value="option">Options</option>
              </select>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground">Room</div>
              <select
                value={roomFilter}
                onChange={(e) => setRoomFilter(e.target.value as RoomFilter)}
                className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-base"
              >
                <option value="All">All</option>
                {orderedRoomIds.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Status</div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-base"
              >
                <option value="All">All</option>
                <option value="needs_review">Needs review</option>
                <option value="ai_modified">AI modified</option>
              </select>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground">Data source</div>
              <select
                value={dataSourceFilter}
                onChange={(e) => setDataSourceFilter(e.target.value as DataSourceFilter)}
                className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-base"
              >
                <option value="All">All</option>
                <option value="concrete">Concrete</option>
                <option value="estimated">Estimated</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
          </div>
        </div>
      </Card>

      {filtered.length ? (
        <div className="space-y-2">
          {filtered.map((r) => {
            const hasChanges = r.modifiedFields.length > 0;
            const canShowChanges = Array.isArray(r.changeLog) && r.changeLog.length > 0;
            const showChanges = Boolean(openChanges[r.key]);
            const latestByField = canShowChanges
              ? (() => {
                  const m = new Map<string, ChangeLogEntry>();
                  for (const entry of r.changeLog || []) {
                    const prev = m.get(entry.field);
                    if (!prev || entry.at > prev.at) m.set(entry.field, entry);
                  }
                  const arr = [...m.values()];
                  arr.sort((a, b) => b.at - a.at);
                  return arr.slice(0, 8);
                })()
              : [];
            return (
              <Card key={r.key} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => nav(r.href)}>
                    <div className="truncate text-base font-semibold">{r.title}</div>
                    {r.subtitle ? <div className="mt-1 text-xs text-muted-foreground">{r.subtitle}</div> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${reviewBadge(r.reviewStatus)}`}>
                        {r.reviewStatus === "needs_review" ? "Needs review" : r.reviewStatus === "ai_modified" ? "AI modified" : "Verified"}
                      </span>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${dataSourceBadge(r.dataSource)}`}>
                        {r.dataSource === "concrete" ? "Concrete" : r.dataSource === "estimated" ? "Estimated" : "Source unknown"}
                      </span>
                      {r.sourceRef ? (
                        <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {r.sourceRef}
                        </span>
                      ) : null}
                    </div>
                    {hasChanges ? (
                      <div className="mt-2 text-xs text-muted-foreground">Changed: {compactFieldList(r.modifiedFields)}</div>
                    ) : (
                      <div className="mt-2 text-xs text-muted-foreground">New / unverified</div>
                    )}
                  </button>
                  <div className="flex shrink-0 flex-col gap-2">
                    <Button size="sm" onClick={() => void markVerified(r)} disabled={busy}>
                      Mark verified
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => nav(r.href)} disabled={busy}>
                      Open
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void markNeedsReview(r)} disabled={busy}>
                      Needs review
                    </Button>
                    {canShowChanges ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setOpenChanges((cur) => ({ ...cur, [r.key]: !cur[r.key] }))}
                        disabled={busy}
                      >
                        {showChanges ? "Hide changes" : "View changes"}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {showChanges && latestByField.length ? (
                  <div className="mt-3 space-y-1 rounded-lg border bg-background p-3 text-xs">
                    {latestByField.map((c) => (
                      <div key={`${r.key}-${c.field}`} className="flex gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{c.field}</span>: {truncate(formatChangeValue(c.from))} \u2192{" "}
                          {truncate(formatChangeValue(c.to))}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Nothing needs review.</div>
        </Card>
      )}
    </div>
  );
}
