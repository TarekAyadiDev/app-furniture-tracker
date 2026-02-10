import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/data/DataContext";
import { useToast } from "@/hooks/use-toast";
import { pullNow, pushNow } from "@/sync/syncNow";
import type { RoomId } from "@/lib/domain";
import { normalizeRoomName } from "@/lib/rooms";

type Health = { ok: boolean; airtableConfigured: boolean; message?: string };

const SHOPPING_DATA_JSON = import.meta.glob("../../Shopping Data/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatExportStamp(ts = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = ts.getFullYear();
  const m = pad(ts.getMonth() + 1);
  const d = pad(ts.getDate());
  const hh = pad(ts.getHours());
  const mm = pad(ts.getMinutes());
  return `${y}${m}${d}_${hh}${mm}`;
}

function makeExportFilename(suffix?: string) {
  const stamp = formatExportStamp();
  const base = `furniture_tracker_export_${stamp}`;
  return suffix ? `${base}_${suffix}.json` : `${base}.json`;
}

function parseMarkdownTasks(text: string, rooms: Array<{ id: RoomId; name: string }>, fallbackRoom: RoomId) {
  const items: Array<{ title: string; room: RoomId; priority?: number; status: string; category?: string }> = [];
  const roomTags = new Map<string, RoomId>();
  for (const r of rooms) {
    const name = normalizeRoomName(r.name || r.id);
    if (name) roomTags.set(name.toLowerCase(), r.id);
    roomTags.set(String(r.id).toLowerCase(), r.id);
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^[-*]\s*\[( |x|X)\]\s*(.+)$/);
    if (!m) continue;
    const checked = String(m[1]).toLowerCase() === "x";
    let body = String(m[2] || "").trim();
    const tags = body.match(/#[A-Za-z0-9_]+/g) || [];

    let room: RoomId = fallbackRoom;
    let priority: number | undefined;

    for (const tagRaw of tags) {
      const tag = tagRaw.slice(1).trim();
      if (!tag) continue;
      const lower = tag.toLowerCase();
      if (roomTags.has(lower)) room = roomTags.get(lower)!;
      const pm = tag.match(/^p(\d+)$/i);
      if (pm) {
        const n = Number.parseInt(pm[1] || "", 10);
        if (Number.isFinite(n)) {
          // Support P0 shorthand (treat as highest priority).
          const p = n <= 0 ? 1 : n;
          priority = Math.max(1, Math.min(5, p));
        }
      }
    }

    body = body.replace(/#[A-Za-z0-9_]+/g, " ").replace(/\s+/g, " ").trim();
    if (!body) continue;
    items.push({
      title: body,
      room,
      priority,
      status: checked ? "Installed" : "Shortlist",
      category: "Other",
    });
  }

  return items;
}

function formatSyncCounts(counts: Record<string, number> | null | undefined) {
  if (!counts) return "none";
  const entries = Object.entries(counts).filter(([, v]) => Number.isFinite(v) && v > 0);
  if (!entries.length) return "none";
  return entries.map(([k, v]) => `${k} ${v}`).join(", ");
}

function formatWhen(ts: number | null) {
  return ts ? new Date(ts).toLocaleString() : "Never";
}

function formatPushWarnings(
  errors: Array<{ entity: string; action: string; title?: string; message: string }> | null | undefined,
): string | null {
  if (!errors || !errors.length) return null;
  const first = errors[0];
  const trimmedMsg = String(first.message || "").replace(/^Airtable error \d+:\s*/i, "");
  const label = `${first.entity} ${first.action}${first.title ? ` (${first.title})` : ""}`;
  const extra = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
  return `${label}: ${trimmedMsg || "Unknown error"}${extra}`;
}

export default function Settings() {
  const { toast } = useToast();
  const {
    home,
    planner,
    orderedRooms,
    unitPreference,
    lastSyncAt,
    lastSyncSummary,
    lastPullAt,
    dirtyCounts,
    saveHome,
    savePlanner,
    setUnitPreference,
    exportBundle,
    importBundle,
    resetLocal,
    loadExampleTownHollywood,
  } = useData();

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importAiAssisted, setImportAiAssisted] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [s3Pushing, setS3Pushing] = useState(false);
  const [s3Pulling, setS3Pulling] = useState(false);
  const [s3LastKey, setS3LastKey] = useState<string | null>(null);
  const [s3Snapshots, setS3Snapshots] = useState<Array<{ key: string; name: string | null; exportedAt: string | null; filename: string | null }>>([]);
  const [s3SnapshotsLoading, setS3SnapshotsLoading] = useState(false);

  const [plannerText, setPlannerText] = useState("");
  const [plannerError, setPlannerError] = useState<string | null>(null);

  const [homeName, setHomeName] = useState(home?.name || "");
  const [homeTags, setHomeTags] = useState((home?.tags || []).join(", "));
  const [homeDesc, setHomeDesc] = useState(home?.description || "");

  useEffect(() => {
    setHomeName(home?.name || "");
    setHomeTags((home?.tags || []).join(", "));
    setHomeDesc(home?.description || "");
  }, [home?.name, (home?.tags || []).join(","), home?.description]);

  useEffect(() => {
    void runHealth();
    void loadS3Snapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runHealth() {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/health");
      const text = await res.text();
      let json: Health | null = null;
      try {
        json = JSON.parse(text) as Health;
      } catch {
        json = null;
      }
      if (!res.ok) {
        throw new Error(json?.message || `/api/health returned ${res.status} ${res.statusText}`);
      }
      if (!json || typeof json.ok !== "boolean") {
        throw new Error("Invalid /api/health response");
      }
      setHealth(json);
    } catch (err: any) {
      setHealth({ ok: false, airtableConfigured: false, message: err?.message || "Failed to reach /api/health" });
    } finally {
      setHealthLoading(false);
    }
  }

  async function onPullNow() {
    setPulling(true);
    try {
      const res = await pullNow();
      const msg = `Pulled: ${formatSyncCounts(res.pull)}`;
      toast({ title: "Pulled", description: msg });
      console.info("[Airtable] Pull", msg, res);
      void runHealth();
      return res;
    } catch (err: any) {
      toast({ title: "Pull failed", description: err?.message || "Unknown error" });
      console.error("[Airtable] Pull failed", err);
      return null;
    } finally {
      setPulling(false);
    }
  }

  async function onPushNow() {
    setPushing(true);
    try {
      const res = await pushNow();
      const warning = formatPushWarnings(res.pushErrors);
      const msg = warning ? `Pushed: ${formatSyncCounts(res.push)} · ${warning}` : `Pushed: ${formatSyncCounts(res.push)}`;
      toast({
        title: warning ? "Pushed with errors" : "Pushed",
        description: msg,
      });
      console.info("[Airtable] Push", msg, res);
      void runHealth();
      return res;
    } catch (err: any) {
      toast({ title: "Push failed", description: err?.message || "Unknown error" });
      console.error("[Airtable] Push failed", err);
      return null;
    } finally {
      setPushing(false);
    }
  }

  async function onResetAndPush() {
    if (!confirm("Reset Airtable records in the current view, then push local data? This deletes Airtable rows first.")) {
      return null;
    }
    setResetting(true);
    try {
      const res = await pushNow("reset");
      const warning = formatPushWarnings(res.pushErrors);
      const msg = warning ? `Pushed: ${formatSyncCounts(res.push)} · ${warning}` : `Pushed: ${formatSyncCounts(res.push)}`;
      toast({
        title: warning ? "Reset + pushed with errors" : "Reset + pushed",
        description: msg,
      });
      console.info("[Airtable] Reset + push", msg, res);
      void runHealth();
      return res;
    } catch (err: any) {
      toast({ title: "Reset push failed", description: err?.message || "Unknown error" });
      console.error("[Airtable] Reset push failed", err);
      return null;
    } finally {
      setResetting(false);
    }
  }

  async function onExport() {
    try {
      const bundle = await exportBundle();
      downloadJson(makeExportFilename(), bundle);
      toast({ title: "Exported", description: "Downloaded JSON export." });
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message || "Unknown error" });
    }
  }

  async function onS3Push() {
    setS3Pushing(true);
    try {
      const bundle = await exportBundle();
      const filename = makeExportFilename();
      const res = await fetch("/api/s3/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: bundle, filename }),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (!res.ok || !json?.ok) {
        throw new Error(json?.message || `S3 upload failed (${res.status})`);
      }
      setS3LastKey(typeof json.key === "string" ? json.key : null);
      toast({ title: "Uploaded to S3", description: json.key ? `Saved: ${json.key}` : "Backup saved." });
      console.info("[S3] JSON upload", json);
      void loadS3Snapshots();
    } catch (err: any) {
      toast({ title: "S3 upload failed", description: err?.message || "Unknown error" });
      console.error("[S3] JSON upload failed", err);
    } finally {
      setS3Pushing(false);
    }
  }

  async function onS3Pull(keyOverride?: string) {
    setS3Pulling(true);
    try {
      const key = keyOverride || s3LastKey;
      const url = key ? `/api/s3/json?key=${encodeURIComponent(key)}` : "/api/s3/json";
      const res = await fetch(url);
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (!res.ok || !json?.ok) {
        throw new Error(json?.message || `S3 download failed (${res.status})`);
      }
      const payload = JSON.stringify(json.data || {}, null, 2);
      setImportError(null);
      setImportText(payload);
      toast({ title: "Loaded from S3", description: json.key ? `Loaded: ${json.key}` : "Loaded latest backup." });
      console.info("[S3] JSON download", json);
    } catch (err: any) {
      toast({ title: "S3 download failed", description: err?.message || "Unknown error" });
      console.error("[S3] JSON download failed", err);
    } finally {
      setS3Pulling(false);
    }
  }

  async function loadS3Snapshots() {
    setS3SnapshotsLoading(true);
    try {
      const res = await fetch("/api/s3/json?list=1");
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (!res.ok || !json?.ok) throw new Error(json?.message || `S3 snapshot list failed (${res.status})`);
      const list = Array.isArray(json.snapshots) ? json.snapshots : [];
      setS3Snapshots(
        list
          .filter((s: any) => s && typeof s.key === "string")
          .map((s: any) => ({
            key: s.key,
            name: typeof s.name === "string" ? s.name : null,
            exportedAt: typeof s.exportedAt === "string" ? s.exportedAt : null,
            filename: typeof s.filename === "string" ? s.filename : null,
          })),
      );
    } catch (err: any) {
      console.error("[S3] Snapshot list failed", err);
      setS3Snapshots([]);
    } finally {
      setS3SnapshotsLoading(false);
    }
  }

  function formatSnapshotLabel(snap: { name: string | null; exportedAt: string | null; filename: string | null }) {
    const name = snap.name || "Snapshot";
    const date = snap.exportedAt ? new Date(snap.exportedAt).toLocaleString() : null;
    const file = snap.filename ? ` · ${snap.filename}` : "";
    return `${name}${date ? ` · ${date}` : ""}${file}`;
  }

  async function onMergePlannerAndExport() {
    if (!plannerText.trim()) return;
    try {
      setPlannerError(null);
      const parsed = JSON.parse(plannerText);
      const attachment = { version: 1 as const, mergedAt: new Date().toISOString(), template: parsed };
      await savePlanner(attachment);
      const bundle = await exportBundle();
      downloadJson(makeExportFilename("with_planner"), bundle);
      toast({ title: "Merged", description: "Planner saved locally and downloaded merged export." });
    } catch (err: any) {
      setPlannerError(err?.message || "Invalid planner JSON.");
      toast({ title: "Merge failed", description: err?.message || "Invalid planner JSON." });
    }
  }

  async function onImport(mode: "merge" | "replace") {
    if (!importText.trim()) return;
    if (mode === "replace" && !confirm("Replace local data? This clears your current offline database.")) return;
    try {
      setImportError(null);
      try {
        const parsed = JSON.parse(importText);
        await importBundle(parsed, { mode, aiAssisted: importAiAssisted });
        toast({ title: "Imported", description: mode === "replace" ? "Local data replaced." : "Data merged." });
      } catch (jsonErr) {
        const fallbackRoom = orderedRooms[0]?.id || "Living";
        const tasks = parseMarkdownTasks(importText, orderedRooms, fallbackRoom);
        if (!tasks.length) throw jsonErr;
        await importBundle({ title: "Markdown tasks import", items: tasks }, { mode, aiAssisted: importAiAssisted });
        toast({ title: "Imported", description: `Imported ${tasks.length} Markdown task(s).` });
      }
    } catch (err: any) {
      setImportError(err?.message || "Invalid JSON or unsupported format.");
      toast({ title: "Import failed", description: err?.message || "Invalid JSON or unsupported format." });
    }
  }

  async function onReset() {
    if (!confirm("Reset local data? This clears your offline database.")) return;
    await resetLocal();
    toast({ title: "Reset", description: "Local data cleared." });
  }

  async function onLoadExample(mode: "merge" | "replace") {
    if (mode === "replace" && !confirm("Replace local data with the Town Hollywood example?")) return;
    await loadExampleTownHollywood(mode);
    toast({ title: "Loaded example", description: "Town Hollywood starter plan loaded." });
  }

  async function loadBundledImport(path: string) {
    try {
      setImportError(null);
      const res = await fetch(path);
      if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
      const text = await res.text();
      setImportText(text);
      toast({ title: "Loaded", description: `Loaded ${path} into the import box.` });
    } catch (err: any) {
      setImportError(err?.message || "Failed to load bundled JSON.");
      toast({ title: "Load failed", description: err?.message || "Failed to load bundled JSON." });
    }
  }

  const shoppingDataSeeds = useMemo(() => {
    return Object.entries(SHOPPING_DATA_JSON)
      .map(([path, raw]) => ({
        path,
        name: path.split("/").pop() || path,
        raw,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const shortcuts = useMemo(
    () => [
      { keys: "/", action: "Focus search on Items" },
      { keys: "Esc", action: "Exit bulk edit mode" },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-semibold">Home</div>
        <div className="mt-3 grid gap-3">
          <div className="space-y-1.5">
            <Label>Home name</Label>
            <Input value={homeName} onChange={(e) => setHomeName(e.target.value)} className="h-11 text-base" />
            <div className="text-xs text-muted-foreground">Currently informational (does not sync yet).</div>
          </div>
          <div className="space-y-1.5">
            <Label>Tags (comma separated)</Label>
            <Input value={homeTags} onChange={(e) => setHomeTags(e.target.value)} className="h-11 text-base" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={homeDesc}
              onChange={(e) => setHomeDesc(e.target.value)}
              className="min-h-[110px] text-base"
            />
            <div className="text-xs text-muted-foreground">
              Tip: keep quick measurement checklist and shopping notes here.
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                await saveHome({
                  name: homeName.trim() || "Home",
                  tags: homeTags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                  description: homeDesc,
                });
                toast({ title: "Saved", description: "Home metadata saved locally." });
              }}
            >
              Save home info
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">Units</div>
        <div className="mt-3 grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="unit_pref">Preferred measurement entry unit</Label>
            <select
              id="unit_pref"
              value={unitPreference}
              onChange={(e) => void setUnitPreference(e.target.value === "cm" ? "cm" : "in")}
              className="h-11 w-full rounded-md border bg-background px-3 text-base"
            >
              <option value="in">inches (in)</option>
              <option value="cm">centimeters (cm)</option>
            </select>
            <div className="text-xs text-muted-foreground">Used for measurement entry forms across the app.</div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">Import / Export</div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              setImportError(null);
              setImportText(String(reader.result || ""));
              toast({ title: "Loaded", description: `Loaded ${file.name}` });
            };
            reader.onerror = () => {
              setImportError("Failed to read file.");
              toast({ title: "Load failed", description: "Failed to read file." });
            };
            reader.readAsText(file);
            // Allow selecting the same file twice.
            e.target.value = "";
          }}
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => void onExport()}>Export JSON</Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Choose JSON file
          </Button>
          {shoppingDataSeeds.length ? (
            <Button
              variant="secondary"
              onClick={() => {
                const seed = shoppingDataSeeds[0];
                setImportError(null);
                setImportText(seed.raw);
                toast({ title: "Loaded", description: `Loaded ${seed.name} from Shopping Data/` });
              }}
            >
              Load Shopping Data JSON
            </Button>
          ) : null}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">Recent S3 snapshots (latest two backups).</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void loadS3Snapshots()} disabled={s3SnapshotsLoading}>
            {s3SnapshotsLoading ? "Refreshing..." : "Refresh snapshots"}
          </Button>
          {s3Snapshots.map((snap, idx) => (
            <Button key={`${snap.key}-${idx}`} variant="secondary" onClick={() => void onS3Pull(snap.key)} disabled={s3Pulling}>
              {formatSnapshotLabel(snap)}
            </Button>
          ))}
          {!s3SnapshotsLoading && s3Snapshots.length === 0 ? (
            <span className="text-xs text-muted-foreground">No snapshots yet.</span>
          ) : null}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Optional backup: push/pull JSON to S3 (same bucket as image uploads). Saves to `uploads/exports/` and updates
          `uploads/exports/latest.json`.
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void onS3Push()} disabled={s3Pushing}>
            {s3Pushing ? "Uploading..." : "Backup JSON to S3"}
          </Button>
          <Button variant="secondary" onClick={() => void onS3Pull()} disabled={s3Pulling}>
            {s3Pulling ? "Loading..." : "Load JSON from S3"}
          </Button>
        </div>
        {s3LastKey ? (
          <div className="mt-2 text-xs text-muted-foreground">
            Last S3 key: <span className="font-semibold">{s3LastKey}</span>
          </div>
        ) : null}
        <div className="mt-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            Paste JSON here, drag a JSON file into the box, or use “Choose JSON file”.
          </div>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'{ "version": 2, ... }'}
            className="min-h-[160px] font-mono text-xs"
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                setImportError(null);
                setImportText(String(reader.result || ""));
                toast({ title: "Loaded", description: `Loaded ${file.name}` });
              };
              reader.readAsText(file);
            }}
            onDragOver={(e) => e.preventDefault()}
          />
          <div className="flex items-start gap-2">
            <Checkbox
              id="import_ai_assisted"
              checked={importAiAssisted}
              onCheckedChange={(v) => setImportAiAssisted(v === true)}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="import_ai_assisted" className="text-sm">
                This JSON was edited by AI
              </Label>
              <div className="text-xs text-muted-foreground">
                Use this when you copy/paste an export into an AI and then import it back. The app will still diff and
                tag changes either way.
              </div>
            </div>
          </div>
          {importError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {importError}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void onImport("merge")}>
              Import (merge)
            </Button>
            <Button variant="destructive" onClick={() => void onImport("replace")}>
              Import (replace)
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">Measurement planner (merge)</div>
        <div className="mt-2 text-xs text-muted-foreground">
          Paste a planner JSON (like your measurement checklist). We’ll save it locally (for room checklists) and attach
          it to your export without overwriting your current measurements/items.
        </div>
        <div className="mt-3 space-y-2">
          <Textarea
            value={plannerText}
            onChange={(e) => setPlannerText(e.target.value)}
            placeholder='{"units": {"primary":"in"}, "rooms": [...]}'
            className="min-h-[160px] font-mono text-xs"
          />
          {plannerError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {plannerError}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void onMergePlannerAndExport()}>
              Merge planner & download JSON
            </Button>
            {planner ? (
              <Button
                variant="secondary"
                onClick={() => {
                  void savePlanner(null);
                  toast({ title: "Cleared", description: "Planner attachment removed locally." });
                }}
              >
                Clear saved planner
              </Button>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            Saved planner: <span className="font-semibold">{planner ? "Yes" : "No"}</span>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">Airtable sync (optional)</div>
        <div className="mt-2 text-xs text-muted-foreground">
          For public hosting, Airtable credentials must live server-side in Vercel env vars (never in the browser).
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Local dev: copy `.env.example` to `.env.local`, fill values, then restart `npm run dev`.
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Pull uses the Airtable view if `AIRTABLE_VIEW_ID` or `AIRTABLE_VIEW_NAME` is set. Push always writes to the table.
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Reset + push deletes Airtable rows in the current view first, then writes local data (useful for template resets).
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={() => void runHealth()} disabled={healthLoading}>
            {healthLoading ? "Checking..." : "Check backend"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void onPullNow()}
            disabled={pulling || pushing || resetting || healthLoading || !health?.ok || !health.airtableConfigured}
          >
            {pulling ? "Pulling..." : "Pull from Airtable"}
          </Button>
          <Button
            onClick={() => void onPushNow()}
            disabled={pulling || pushing || resetting || healthLoading || !health?.ok || !health.airtableConfigured}
          >
            {pushing ? "Pushing..." : "Push to Airtable"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onResetAndPush()}
            disabled={pulling || pushing || resetting || healthLoading || !health?.ok || !health.airtableConfigured}
          >
            {resetting ? "Resetting..." : "Reset + Push"}
          </Button>
        </div>
        {health ? (
          <div className="mt-3 rounded-lg border bg-background p-3 text-sm">
            <div>
              Backend: <span className="font-semibold">{health.ok ? "OK" : "Not reachable"}</span>
            </div>
            <div>
              Airtable env:{" "}
              <span className="font-semibold">
                {health.ok ? (health.airtableConfigured ? "Configured" : "Missing") : "Unknown"}
              </span>
            </div>
            {health.message ? <div className="mt-1 text-xs text-muted-foreground">{health.message}</div> : null}
          </div>
        ) : null}
        <div className="mt-3 text-xs text-muted-foreground">
          Pending changes: items {dirtyCounts.items}, options {dirtyCounts.options}, measurements {dirtyCounts.measurements}, rooms{" "}
          {dirtyCounts.rooms}, stores {dirtyCounts.stores}.
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Since last pull ({formatWhen(lastPullAt)}): {formatSyncCounts(dirtyCounts as Record<string, number>)} to push.
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Last sync action:{" "}
          <span className="font-semibold">{formatWhen(lastSyncAt)}</span>
        </div>
        {lastSyncSummary ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Last sync summary: Push {formatSyncCounts(lastSyncSummary.push)} \u00b7 Pull {formatSyncCounts(lastSyncSummary.pull)}
          </div>
        ) : null}
        <div className="mt-3 text-xs text-muted-foreground">
          Required env vars: `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID`. Optional: `AIRTABLE_VIEW_NAME`.
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">Local data</div>
        <div className="mt-3">
          <Button variant="destructive" onClick={() => void onReset()}>
            Reset local database
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-semibold">Keyboard shortcuts</div>
        <div className="mt-3 space-y-2 text-sm">
          {shortcuts.map((s) => (
            <div key={s.keys} className="flex items-baseline justify-between gap-3">
              <div className="rounded-md border bg-background px-2 py-1 font-mono text-xs">{s.keys}</div>
              <div className="text-muted-foreground">{s.action}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
