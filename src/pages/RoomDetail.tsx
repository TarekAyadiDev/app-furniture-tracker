import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { DragReorderList } from "@/components/reorder/DragReorderList";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { ReviewStatusBadge } from "@/components/ReviewStatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/data/DataContext";
import { type DataSource, type Measurement, type ReviewStatus, type RoomId } from "@/lib/domain";
import { cmToInches, formatInAndCm, inchesToCm, nowMs, parseNumberOrNull } from "@/lib/format";
import { computeItemFitWarnings, formatDimsCompact, formatRectInAndCm, getItemDimsIn, pickRoomGlobalDims } from "@/lib/fit";
import { markProvenanceNeedsReview, markProvenanceVerified } from "@/lib/provenance";
import {
  getRoomPlannerChecklist,
  matchPlannerKeyToMeasurements,
  prettyPlannerKey,
  suggestCategoryFromTags,
} from "@/lib/planner";

type Unit = "in" | "cm";

export default function RoomDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const {
    planner,
    rooms,
    roomNameById,
    unitPreference,
    setUnitPreference,
    items,
    measurements,
    reorderMeasurements,
    updateRoom,
    createMeasurement,
    updateMeasurement,
    deleteMeasurement,
  } = useData();

  const roomId = typeof id === "string" ? (id as RoomId) : null;
  const room = useMemo(() => rooms.find((r) => r.id === roomId && r.syncState !== "deleted"), [rooms, roomId]);
  const roomLabel = roomId ? roomNameById.get(roomId) || roomId : "";
  const list = useMemo(() => {
    if (!roomId) return [];
    return measurements
      .filter((m) => m.syncState !== "deleted" && m.room === roomId)
      .sort((a, b) => {
        const sa = typeof a.sort === "number" ? a.sort : 999999;
        const sb = typeof b.sort === "number" ? b.sort : 999999;
        if (sa !== sb) return sa - sb;
        return a.label.localeCompare(b.label);
      });
  }, [measurements, roomId]);

  const [notes, setNotes] = useState(room?.notes || "");
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newConfidence, setNewConfidence] = useState<Measurement["confidence"]>("med");
  const [newForCategory, setNewForCategory] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newDataSource, setNewDataSource] = useState<DataSource>(null);
  const [newSourceRef, setNewSourceRef] = useState("");
  const [newReviewStatus, setNewReviewStatus] = useState<ReviewStatus>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);

  const labelRef = useRef<HTMLInputElement | null>(null);

  const [editing, setEditing] = useState<null | {
    id: string;
    label: string;
    value: string;
    unit: Unit;
    confidence: Measurement["confidence"];
    forCategory: string;
    notes: string;
    dataSource: DataSource;
    sourceRef: string;
    reviewStatus: ReviewStatus;
  }>(null);

  async function saveNotes() {
    if (!roomId) return;
    await updateRoom(roomId, { notes: notes });
  }

  async function addMeasurement() {
    if (!roomId) return;
    const lbl = newLabel.trim();
    const val = parseNumberOrNull(newValue);
    if (!lbl || val === null) return;
    const valueIn = unitPreference === "cm" ? cmToInches(val) : val;
    const ts = nowMs();
    const baseProv = {
      dataSource: newDataSource,
      sourceRef: newSourceRef.trim() || null,
      reviewStatus: newReviewStatus,
    };
    const provenance =
      newReviewStatus === "verified"
        ? markProvenanceVerified(baseProv, ts)
        : newReviewStatus === "needs_review"
          ? markProvenanceNeedsReview(baseProv, ts)
          : baseProv;
    await createMeasurement({
      room: roomId,
      label: lbl,
      valueIn,
      confidence: newConfidence,
      forCategory: newForCategory.trim() || null,
      notes: newNotes.trim() || null,
      provenance,
    });
    setNewLabel("");
    setNewValue("");
    setNewForCategory("");
    setNewNotes("");
    setNewDataSource(null);
    setNewSourceRef("");
    setNewReviewStatus(null);
  }

  function startEdit(m: Measurement) {
    setEditing({
      id: m.id,
      label: m.label,
      value: String(m.valueIn),
      unit: unitPreference,
      confidence: m.confidence || null,
      forCategory: m.forCategory || "",
      notes: m.notes || "",
      dataSource: m.provenance?.dataSource ?? null,
      sourceRef: m.provenance?.sourceRef ?? "",
      reviewStatus: m.provenance?.reviewStatus ?? null,
    });
  }

  async function saveEdit() {
    if (!editing) return;
    const lbl = editing.label.trim();
    const val = parseNumberOrNull(editing.value);
    if (!lbl || val === null) return;
    const valueIn = editing.unit === "cm" ? cmToInches(val) : val;
    const ts = nowMs();
    const cur = list.find((m) => m.id === editing.id) || null;
    const baseProv = {
      ...(cur?.provenance || {}),
      dataSource: editing.dataSource,
      sourceRef: editing.sourceRef.trim() || null,
      reviewStatus: editing.reviewStatus,
    };
    const provenance =
      editing.reviewStatus === "verified"
        ? markProvenanceVerified(baseProv, ts)
        : editing.reviewStatus === "needs_review"
          ? markProvenanceNeedsReview(baseProv, ts)
          : baseProv;
    await updateMeasurement(editing.id, {
      label: lbl,
      valueIn,
      confidence: editing.confidence || null,
      forCategory: editing.forCategory.trim() || null,
      notes: editing.notes.trim() || null,
      provenance,
    });
    setEditing(null);
  }

  const editMeasurementId = useMemo(() => {
    const sp = new URLSearchParams(loc.search);
    const m = sp.get("editMeasurement");
    return m && m.trim() ? m.trim() : null;
  }, [loc.search]);

  useEffect(() => {
    if (!editMeasurementId) return;
    if (editing) return;
    const match = list.find((m) => m.id === editMeasurementId) || null;
    if (!match) return;
    setEditing({
      id: match.id,
      label: match.label,
      value: String(match.valueIn),
      unit: unitPreference,
      confidence: match.confidence || null,
      forCategory: match.forCategory || "",
      notes: match.notes || "",
      dataSource: match.provenance?.dataSource ?? null,
      sourceRef: match.provenance?.sourceRef ?? "",
      reviewStatus: match.provenance?.reviewStatus ?? null,
    });
    nav({ pathname: loc.pathname, search: "" }, { replace: true });
  }, [editMeasurementId, editing, list, loc.pathname, nav]);

  useEffect(() => {
    setEditing((cur) => (cur ? { ...cur, unit: unitPreference } : cur));
  }, [unitPreference]);

  const itemsInRoom = useMemo(() => {
    if (!roomId) return [];
    return items.filter((i) => i.syncState !== "deleted" && i.room === roomId);
  }, [items, roomId]);

  const categoriesInRoom = useMemo(() => {
    const set = new Set<string>();
    for (const it of itemsInRoom) {
      const c = String(it.category || "").trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [itemsInRoom]);

  const generalMeasurements = useMemo(() => list.filter((m) => !m.forCategory && !m.forItemId), [list]);
  const globalDims = useMemo(() => pickRoomGlobalDims(generalMeasurements), [generalMeasurements]);
  const globalSizeText =
    globalDims.w && globalDims.d
      ? formatRectInAndCm(globalDims.w.valueIn, globalDims.d.valueIn)
      : globalDims.w
        ? formatInAndCm(globalDims.w.valueIn)
        : "";

  const byCategoryMeasurements = useMemo(() => {
    const map = new Map<string, Measurement[]>();
    for (const m of list) {
      if (m.syncState === "deleted") continue;
      const key = String(m.forCategory || "").trim();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        const sa = typeof a.sort === "number" ? a.sort : 999999;
        const sb = typeof b.sort === "number" ? b.sort : 999999;
        if (sa !== sb) return sa - sb;
        return a.label.localeCompare(b.label);
      });
      map.set(k, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list]);

  const plannerChecklist = useMemo(() => {
    if (!roomId) return null;
    return getRoomPlannerChecklist(planner, roomId);
  }, [planner, roomId]);

  const plannerMatches = useMemo(() => {
    if (!plannerChecklist) return null;
    return plannerChecklist.keys.map((k) => {
      const match = matchPlannerKeyToMeasurements(k, list);
      return { ...k, ...match };
    });
  }, [plannerChecklist, list]);

  const plannerSummary = useMemo(() => {
    if (!plannerMatches) return null;
    const total = plannerMatches.length;
    const captured = plannerMatches.filter((m) => m.state === "captured").length;
    const maybe = plannerMatches.filter((m) => m.state === "maybe").length;
    const missing = total - captured - maybe;
    return { total, captured, maybe, missing };
  }, [plannerMatches]);

  if (!roomId) {
    return (
      <Card className="p-4">
        <div className="space-y-2">
          <div className="text-base font-semibold">Room not found</div>
          <Button variant="secondary" onClick={() => nav("/rooms")}>
            Back to Rooms
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-base font-semibold">{roomLabel}</div>
          {globalSizeText ? <div className="text-xs text-muted-foreground">{globalSizeText}</div> : null}
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="room_notes">Room notes</Label>
          <Textarea
            id="room_notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => void saveNotes()}
            placeholder="Layout notes, must-buys, constraints..."
            className="min-h-[120px] text-base"
          />
          <div className="text-xs text-muted-foreground">Autosaves on blur.</div>
        </div>
      </Card>

      {plannerChecklist && plannerMatches && plannerSummary ? (
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Planner checklist</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {plannerSummary.captured}/{plannerSummary.total} matched
                {plannerSummary.maybe ? ` \u00b7 ${plannerSummary.maybe} maybe` : ""}
                {plannerChecklist.sources.length ? ` \u00b7 ${plannerChecklist.sources.join(", ")}` : ""}
              </div>
            </div>
            <Button variant="secondary" onClick={() => setPlannerOpen((v) => !v)}>
              {plannerOpen ? "Hide" : "Open"}
            </Button>
          </div>

          <Collapsible open={plannerOpen} onOpenChange={setPlannerOpen}>
            <CollapsibleTrigger className="hidden" />
            <CollapsibleContent>
              <div className="mt-3 space-y-2">
                {plannerMatches.map((k) => {
                  const title = prettyPlannerKey(k.key);
                  const suggested = suggestCategoryFromTags(k.constraintTags);
                  const stateText = k.state === "captured" ? "Captured" : k.state === "maybe" ? "Maybe" : "Missing";
                  const stateClass =
                    k.state === "captured"
                      ? "text-emerald-700"
                      : k.state === "maybe"
                        ? "text-amber-700"
                        : "text-muted-foreground";

                  return (
                    <div key={k.key} className="rounded-lg border bg-background p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{title}</div>
                          <div className={`mt-1 text-xs ${stateClass}`}>{stateText}</div>
                          {k.match ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Best match: <span className="font-medium text-foreground">{k.match.label}</span>
                            </div>
                          ) : null}
                          {k.constraintTags.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {k.constraintTags.slice(0, 6).map((t) => (
                                <span
                                  key={`${k.key}-${t}`}
                                  className="rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground"
                                >
                                  {prettyPlannerKey(t)}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="shrink-0">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setNewLabel(title);
                              if (suggested) setNewForCategory(suggested);
                              labelRef.current?.focus();
                            }}
                          >
                            Use
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      ) : null}

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Measurements</div>
            <div className="text-xs text-muted-foreground">Stored in inches; entry unit is global (set here or in Settings).</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="col-span-3 space-y-1.5">
            <Label htmlFor="m_label">Label</Label>
            <Input
              id="m_label"
              ref={labelRef}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Sofa wall"
              className="h-12 text-base"
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="m_value">Value</Label>
            <Input
              id="m_value"
              inputMode="decimal"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={unitPreference === "in" ? "inches" : "cm"}
              className="h-12 text-base"
            />
            {parseNumberOrNull(newValue) !== null ? (
              <div className="text-xs text-muted-foreground">
                {unitPreference === "in"
                  ? `${inchesToCm(parseNumberOrNull(newValue) || 0).toFixed(1)} cm`
                  : `${cmToInches(parseNumberOrNull(newValue) || 0).toFixed(1)} in`}
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m_unit">Unit</Label>
            <select
              id="m_unit"
              value={unitPreference}
              onChange={(e) => void setUnitPreference(e.target.value === "cm" ? "cm" : "in")}
              className="h-12 w-full rounded-md border bg-background px-3 text-base"
            >
              <option value="in">in</option>
              <option value="cm">cm</option>
            </select>
          </div>
          <div className="col-span-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="m_conf">Confidence</Label>
              <select
                id="m_conf"
                value={newConfidence || ""}
                onChange={(e) => setNewConfidence((e.target.value as Measurement["confidence"]) || null)}
                className="h-12 w-full rounded-md border bg-background px-3 text-base"
              >
                <option value="">(none)</option>
                <option value="low">low</option>
                <option value="med">med</option>
                <option value="high">high</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m_for_cat">For category (optional)</Label>
              <Input
                id="m_for_cat"
                value={newForCategory}
                onChange={(e) => setNewForCategory(e.target.value)}
                placeholder="Sofa, Dining Table, Bed..."
                className="h-12 text-base"
              />
              {categoriesInRoom.length ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {categoriesInRoom.slice(0, 8).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewForCategory(c)}
                      className="rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="col-span-3 space-y-1.5">
            <Label htmlFor="m_notes">Notes (optional)</Label>
            <Input
              id="m_notes"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Door swing, window sill height..."
              className="h-12 text-base"
            />
          </div>
          <div className="col-span-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="m_data_source">Data source</Label>
              <select
                id="m_data_source"
                value={newDataSource || ""}
                onChange={(e) => setNewDataSource((e.target.value as DataSource) || null)}
                className="h-12 w-full rounded-md border bg-background px-3 text-base"
              >
                <option value="">(none)</option>
                <option value="concrete">Concrete</option>
                <option value="estimated">Estimated</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m_review_status">Review status</Label>
              <select
                id="m_review_status"
                value={newReviewStatus || ""}
                onChange={(e) => setNewReviewStatus((e.target.value as ReviewStatus) || null)}
                className="h-12 w-full rounded-md border bg-background px-3 text-base"
              >
                <option value="">(none)</option>
                <option value="needs_review">Needs review</option>
                <option value="verified">Verified</option>
                <option value="ai_modified">AI modified</option>
              </select>
            </div>
          </div>
          <div className="col-span-3 space-y-1.5">
            <Label htmlFor="m_source_ref">Source ref (optional)</Label>
            <Input
              id="m_source_ref"
              value={newSourceRef}
              onChange={(e) => setNewSourceRef(e.target.value)}
              placeholder='e.g. "Floor plan B1.1"'
              className="h-12 text-base"
            />
          </div>
          <div className="col-span-3">
            <Button className="h-12 w-full text-base" onClick={() => void addMeasurement()}>
              Add measurement
            </Button>
          </div>
        </div>

        {editing ? (
          <div className="mt-4 rounded-lg border bg-accent p-3">
            <div className="text-sm font-semibold">Edit measurement</div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="col-span-3 space-y-1.5">
                <Label>Label</Label>
                <Input
                  value={editing.label}
                  onChange={(e) => setEditing((cur) => (cur ? { ...cur, label: e.target.value } : cur))}
                  className="h-11 text-base"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Value</Label>
                <Input
                  inputMode="decimal"
                  value={editing.value}
                  onChange={(e) => setEditing((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                  className="h-11 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <select
                  value={editing.unit}
                  onChange={(e) => {
                    const next = e.target.value as Unit;
                    void setUnitPreference(next);
                    setEditing((cur) => (cur ? { ...cur, unit: next } : cur));
                  }}
                  className="h-11 w-full rounded-md border bg-background px-3 text-base"
                >
                  <option value="in">in</option>
                  <option value="cm">cm</option>
                </select>
              </div>
              <div className="col-span-3 flex gap-2">
                <Button className="h-11 flex-1" onClick={() => void saveEdit()}>
                  Save
                </Button>
                <Button variant="secondary" className="h-11 flex-1" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
              <div className="col-span-3 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Confidence</Label>
                  <select
                    value={editing.confidence || ""}
                    onChange={(e) =>
                      setEditing((cur) => (cur ? { ...cur, confidence: (e.target.value as Measurement["confidence"]) || null } : cur))
                    }
                    className="h-11 w-full rounded-md border bg-background px-3 text-base"
                  >
                    <option value="">(none)</option>
                    <option value="low">low</option>
                    <option value="med">med</option>
                    <option value="high">high</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>For category (optional)</Label>
                  <Input
                    value={editing.forCategory}
                    onChange={(e) => setEditing((cur) => (cur ? { ...cur, forCategory: e.target.value } : cur))}
                    className="h-11 text-base"
                    placeholder="Sofa, Dining Table..."
                  />
                </div>
              </div>
              <div className="col-span-3 space-y-1.5">
                <Label>Notes</Label>
                <Input
                  value={editing.notes}
                  onChange={(e) => setEditing((cur) => (cur ? { ...cur, notes: e.target.value } : cur))}
                  className="h-11 text-base"
                />
              </div>
              <div className="col-span-3 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Data source</Label>
                  <select
                    value={editing.dataSource || ""}
                    onChange={(e) => setEditing((cur) => (cur ? { ...cur, dataSource: (e.target.value as DataSource) || null } : cur))}
                    className="h-11 w-full rounded-md border bg-background px-3 text-base"
                  >
                    <option value="">(none)</option>
                    <option value="concrete">Concrete</option>
                    <option value="estimated">Estimated</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Review status</Label>
                  <select
                    value={editing.reviewStatus || ""}
                    onChange={(e) =>
                      setEditing((cur) => (cur ? { ...cur, reviewStatus: (e.target.value as ReviewStatus) || null } : cur))
                    }
                    className="h-11 w-full rounded-md border bg-background px-3 text-base"
                  >
                    <option value="">(none)</option>
                    <option value="needs_review">Needs review</option>
                    <option value="verified">Verified</option>
                    <option value="ai_modified">AI modified</option>
                  </select>
                </div>
              </div>
              <div className="col-span-3 space-y-1.5">
                <Label>Source ref</Label>
                <Input
                  value={editing.sourceRef}
                  onChange={(e) => setEditing((cur) => (cur ? { ...cur, sourceRef: e.target.value } : cur))}
                  className="h-11 text-base"
                  placeholder='e.g. "Tape measure 2026-02"'
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {generalMeasurements.length ? (
            generalMeasurements.map((m) => (
              <Card key={m.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">{m.label}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{formatInAndCm(m.valueIn)}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ReviewStatusBadge status={m.provenance?.reviewStatus} />
                      <DataSourceBadge dataSource={m.provenance?.dataSource} />
                      {m.provenance?.sourceRef ? (
                        <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {m.provenance.sourceRef}
                        </span>
                      ) : null}
                    </div>
                    {Array.isArray(m.provenance?.modifiedFields) && m.provenance?.modifiedFields.length ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Changed: {m.provenance.modifiedFields.slice(0, 4).join(", ")}
                        {m.provenance.modifiedFields.length > 4 ? ` +${m.provenance.modifiedFields.length - 4}` : ""}
                      </div>
                    ) : null}
                    {m.confidence ? (
                      <div className="mt-1 text-xs text-muted-foreground">Confidence: {m.confidence}</div>
                    ) : null}
                    {m.notes ? <div className="mt-2 whitespace-pre-wrap text-sm">{m.notes}</div> : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <Button variant="secondary" onClick={() => startEdit(m)}>
                      Edit
                    </Button>
                    <Button variant="destructive" onClick={() => void deleteMeasurement(m.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          ) : (
            <div className="text-sm text-muted-foreground">No general measurements yet.</div>
          )}
        </div>

        {byCategoryMeasurements.length ? (
          <div className="mt-6 space-y-4">
            <div className="text-sm font-semibold">Category constraints</div>
            {byCategoryMeasurements.map(([cat, arr]) => (
              <div key={cat} className="rounded-lg border bg-background p-3">
                <div className="text-sm font-semibold">{cat}</div>
                <div className="mt-2 space-y-2">
                  {arr.map((m) => (
                    <div key={m.id} className="rounded-md border bg-background p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{m.label}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{formatInAndCm(m.valueIn)}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <ReviewStatusBadge status={m.provenance?.reviewStatus} />
                            <DataSourceBadge dataSource={m.provenance?.dataSource} />
                            {m.provenance?.sourceRef ? (
                              <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                {m.provenance.sourceRef}
                              </span>
                            ) : null}
                          </div>
                          {Array.isArray(m.provenance?.modifiedFields) && m.provenance?.modifiedFields.length ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Changed: {m.provenance.modifiedFields.slice(0, 4).join(", ")}
                              {m.provenance.modifiedFields.length > 4 ? ` +${m.provenance.modifiedFields.length - 4}` : ""}
                            </div>
                          ) : null}
                          {m.confidence ? (
                            <div className="mt-1 text-xs text-muted-foreground">Confidence: {m.confidence}</div>
                          ) : null}
                          {m.notes ? <div className="mt-2 whitespace-pre-wrap text-sm">{m.notes}</div> : null}
                        </div>
                        <div className="flex shrink-0 flex-col gap-2">
                          <Button size="sm" variant="secondary" onClick={() => startEdit(m)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => void deleteMeasurement(m.id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">Items & fit</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Items are checked against room/category measurements when dimensions are available.
        </div>
        <div className="mt-3 space-y-2">
          {itemsInRoom.length ? (
            itemsInRoom.map((it) => {
              const dims = getItemDimsIn(it);
              const dimText = formatDimsCompact(dims);
              const warnings = computeItemFitWarnings(it, list);
              return (
                <Card key={it.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => nav(`/items/${it.id}`)}>
                      <div className="truncate text-base font-semibold">{it.name}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <ReviewStatusBadge status={it.provenance?.reviewStatus} />
                        <DataSourceBadge dataSource={it.provenance?.dataSource} />
                        {Array.isArray(it.provenance?.modifiedFields) && it.provenance?.modifiedFields.length ? (
                          <span className="text-xs text-muted-foreground">
                            Changed: {it.provenance.modifiedFields.slice(0, 4).join(", ")}
                            {it.provenance.modifiedFields.length > 4 ? ` +${it.provenance.modifiedFields.length - 4}` : ""}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {it.category || "Other"}
                        {dimText ? ` \u00b7 ${dimText}` : " \u00b7 no dimensions"}
                      </div>
                      {warnings.length ? (
                        <div className="mt-2 space-y-1 text-xs text-destructive">
                          {warnings.slice(0, 3).map((w) => (
                            <div key={`${it.id}-${w.dim}-${w.message}`}>{w.message}</div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-muted-foreground">No fit warnings.</div>
                      )}
                    </button>
                    <Button variant="secondary" onClick={() => nav(`/items/${it.id}`)}>
                      Open
                    </Button>
                  </div>
                </Card>
              );
            })
          ) : (
            <div className="text-sm text-muted-foreground">No items in this room yet.</div>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">Reorder measurements</div>
        <div className="mt-1 text-xs text-muted-foreground">Drag the handle to reorder measurements in this room.</div>
        {reorderMode && list.length ? (
          <div className="mt-3">
            <DragReorderList
              ariaLabel={`Reorder measurements in ${roomLabel || roomId}`}
              items={list.map((m) => ({
                id: m.id,
                title: m.label,
                subtitle: `${formatInAndCm(m.valueIn)}${m.forCategory ? ` \u00b7 ${m.forCategory}` : ""}`,
              }))}
              onCommit={async (ids) => {
                await reorderMeasurements(roomId, ids);
              }}
            />
          </div>
        ) : null}
        <div className="mt-3">
          <Button
            variant={reorderMode ? "default" : "secondary"}
            className="w-full"
            onClick={() => setReorderMode((v) => !v)}
            disabled={!list.length}
          >
            {reorderMode ? "Done" : "Reorder"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
