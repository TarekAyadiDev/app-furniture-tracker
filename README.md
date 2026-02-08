# 2B Furnishing Tracker

Mobile-first furnishing tracker for quick updates while shopping/moving around:
- Offline-first storage (IndexedDB)
- Fast search + filters + bulk edit
- Rooms + measurements (always shown in inches + cm)
- Budget summary (planned vs selected vs spent)
- Optional Airtable sync via serverless API (no browser tokens)

## Local dev (root app)

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:8080`.

### Optional: Airtable sync in local dev

1) Copy `.env.example` to `.env.local`
2) Fill in:
   - `AIRTABLE_TOKEN`
   - `AIRTABLE_BASE_ID`
   - `AIRTABLE_TABLE_ID`
3) Restart `npm run dev`

Then go to Settings -> “Airtable sync” -> “Check backend”.

## Build / preview

```bash
npm run build
npm run preview
```

## Deploy to Vercel (recommended)

1) Push the repo to GitHub.
2) Import into Vercel.
3) Add environment variables (Project Settings -> Environment Variables):
   - `AIRTABLE_TOKEN` (Airtable PAT; keep private)
   - `AIRTABLE_BASE_ID`
   - `AIRTABLE_TABLE_ID`
   - Optional: `AIRTABLE_VIEW_NAME` (limit sync to a view)
   - Optional: `AIRTABLE_PRIORITY_FIELD` (defaults to `Prioirity`)
   - Optional: `AIRTABLE_SYNC_SOURCE` (stamp records on push)
   - Optional: `AIRTABLE_SYNC_SOURCE_FIELD` (defaults to `Last Sync Source`)
   - Optional: `AIRTABLE_SYNC_AT_FIELD` (defaults to `Last Sync At`)
4) Deploy.

The frontend calls `/api/*`; the backend talks to Airtable with env vars only.

## Deploy to Google Cloud (outline)

One simple approach:
- Frontend: build with `npm run build` and host `dist/` on Cloud Storage (or serve via Cloud Run).
- Backend: deploy the `api/` handlers as Cloud Functions / Cloud Run, set the same env vars, and route `/api/*` to them.

## Airtable schema (recommended)

This app expects a single Airtable table that contains multiple record types.

Required columns (minimum):
- `Record Type` (single select): `Item`, `Option`, `Measurement`, `Note`
- `Title` (single line text)
- `Room` (single select): `Living`, `Dining`, `Master`, `Bedroom2`, `Balcony`, `Entry`, `Kitchen`, `Bath`
- `Status` (single select): `Idea`, `Shortlist`, `Selected`, `Ordered`, `Delivered`, `Installed`
- `Notes` (long text)

Items:
- `Price` (number/currency)
- `Quantity` (number)
- `Store` (text)
- `Link` (url)
- `Dimensions` (text)
- Priority column:
  - This repo previously used `Prioirity` (typo). Either rename it to `Priority` or set `AIRTABLE_PRIORITY_FIELD=Prioirity`.

Options:
- `Parent Item Record Id` (text) (stores the Airtable record id of the parent item)
- `Promo Code` (text)
- `Discount` (number/currency)
- `Shipping` (number/currency)
- `Tax Estimate` (number/currency)
- `Final Total` (number/currency)
- `Dimensions` (text)

Measurements:
- `Measure Label` (text)
- `Value (in)` (number)
- `Value (cm)` (number)
- `Unit Entered` (single select: `in`, `cm`)
- `Confidence` (single select: `low`, `med`, `high`)

Notes:
- For room notes, the server writes `Record Type=Note` records keyed by `Room`.

Note: To avoid requiring extra columns, some item metadata (like `category` and exact dimension structure) is stored inside `Notes` in a hidden `app_meta` block.

Optional sync audit columns (for tagging where the last change came from):
- `Last Sync Source` (text)
- `Last Sync At` (text, ISO timestamp)

## Import / export

Open Settings:
- Export: downloads a JSON bundle containing rooms, measurements, items, and options.
- Import: paste a JSON bundle to merge or replace local data.
- “Load Town Hollywood”: seeds a realistic starter plan for your home.
- Measurement planner: paste a planner JSON to show room checklists (and include it in exports).

### AI-change tagging + review workflow

Workflow:
1) Export JSON
2) Edit the JSON externally (including via AI)
3) Import JSON (merge or replace)
4) Open the Review tab to see what needs attention

On import, the app diffs “business fields” and auto-tags:
- New entities: `provenance.reviewStatus = "needs_review"`
- Changed entities: `provenance.reviewStatus = "ai_modified"` plus `provenance.modifiedFields`

This works even if the external editor/AI forgets to set any tags.

### Manual test plan (import diff + verify)

1) Create 1 Measurement and 1 Item manually.
2) Export JSON.
3) Modify the exported JSON externally:
   - Change Measurement `valueIn` and `notes`
   - Change Item `link` and `price`
   - Add a new Item (with `link` + `price`)
4) Import JSON with “This JSON was edited by AI” enabled.

Expected:
- Changed existing entities show as “AI modified” with `modifiedFields` listing changed fields.
- New entities show as “Needs review”.
- Review page lists everything with “Needs review” or “AI modified”.
- “Mark verified” clears review flags and removes items from the Review list.
- Re-importing the same JSON does not create new change flags.

Bundled example JSON:
- `public/examples/town-hollywood.json` (served at `/examples/town-hollywood.json` in production)

## Security

- Never commit Airtable tokens or real values in `.env*` files (only commit `.env.example` as a template).
- If you ever committed a real Airtable PAT, rotate/revoke it in Airtable and consider purging git history.
- Dev server binds to `127.0.0.1` by default (see `vite.config.ts`).

## What changed (repo restructure)

- Promoted the Vite/React app to the repository root (single runnable app).
- Archived legacy single-file trackers and duplicated assets under `archive/`.
- Removed committed Airtable tokens from tracked files; switched sync to server-side env vars only.
- Added a build guard that fails if token-like strings are detected: `npm run guard:secrets`.
