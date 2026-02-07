# Implementation prompt: Data quality, source, and review tags

Use this prompt (with an AI or as a spec) to add data management features to the furniture tracker app: **verifying and fixing data**, **tracking where data came from** (concrete vs inferred, file/source), and **review/confidence tags** (e.g. “modified by AI”, “needs review”).

---

## Context

- The app already has **import/export JSON** and a **measurement confidence** field (`low` | `med` | `high` | `null`) used in `RoomDetail` for measurements.
- Entity types: **Room**, **Measurement**, **Item**, **Option** (see `src/lib/domain.ts`).
- Data lives in IndexedDB and is normalized on import in `src/data/DataContext.tsx`.

## Goals

1. **Data source and quality**
   - Tag data as **concrete** (from real measurements, floor plans, or files) vs **estimated/inferred** (e.g. from AI or rough guesses).
   - Optionally attach **source references** (e.g. “Floor plan B1.1.pdf”, “Export 2026-02-07”, “Manual entry”).

2. **Review and confidence**
   - Extend beyond measurement-only confidence:
     - **Review status**: e.g. `needs_review` | `verified` | `ai_modified` (or similar) so users can mark “modified by AI, needs review” and then “verified” after checking.
   - Keep existing measurement **confidence** (`low` | `med` | `high`) and use it together with review status where it makes sense.

3. **Manage and verify data**
   - Surfaces to:
     - **Filter/list** entities that need review (e.g. “Show all measurements/items with `needs_review` or `ai_modified`”).
     - **Edit** source, review status, and confidence when fixing data.
     - **Bulk actions** (optional): e.g. “Mark all AI-modified measurements in this room as needs_review” or “Mark as verified”.

## Data model changes (conceptual)

- **Measurements** (already have `confidence`):
  - Add optional:
    - `dataSource?: "concrete" | "estimated" | null` — concrete = from tape/plan/file; estimated = inferred/AI/rough.
    - `sourceRef?: string | null` — short text reference (e.g. file name, “Floor plan”, “Manual”).
    - `reviewStatus?: "needs_review" | "verified" | "ai_modified" | null` — for “modified by AI, needs review” and “verified” workflow.
  - Keep existing `confidence` and `notes`; use them together with the above.

- **Items** (and optionally **Options**):
  - Add optional:
    - `dataSource?: "concrete" | "estimated" | null`
    - `sourceRef?: string | null`
    - `reviewStatus?: "needs_review" | "verified" | "ai_modified" | null`
  - So furniture entries (and shopping options) can also be tagged for verification.

- **Rooms** (optional, lower priority):
  - Same optional fields if you want to track room-level metadata (e.g. “room dimensions from plan PDF”).

- **Export/import**
  - Include the new fields in the export JSON and normalize them on import (with safe defaults: `null` or `"needs_review"` for imported/AI-modified data if desired).

## UI/UX (concrete)

1. **Room detail (measurements)**
   - When adding/editing a measurement, allow setting:
     - **Data source**: Concrete / Estimated (dropdown or chips).
     - **Source reference**: Short text (e.g. “B1.1 plan”, “Tape 2026-02”).
     - **Review status**: Needs review / Verified / AI modified (or subset).
     - Keep existing **Confidence** (low/med/high).
   - In the measurement list/cards, show small badges or labels for: confidence, review status, and optionally “concrete” vs “estimated”.

2. **Item detail (and option rows if you add fields to options)**
   - Same optional fields: data source, source ref, review status (and confidence for items if you add it).
   - Show them in the item/option UI so users can fix and verify furniture data.

3. **Data management / Review page or section**
   - Add a way to see “everything that needs attention”:
     - e.g. a **Settings** subsection or a **Review** tab/page that lists:
       - Measurements with `reviewStatus === "needs_review"` or `"ai_modified"`.
       - Items (and options) with the same.
     - Filters: by room, by type (measurement vs item), by review status, by data source (concrete vs estimated).
   - From this list, allow opening the entity (room/item) to edit and then set **Review status → Verified** and optionally **Data source → Concrete** and **Source ref**.

4. **Import behavior**
   - On import (merge or replace), optionally mark imported entities with `reviewStatus: "needs_review"` and `dataSource: "estimated"` so they show up in the “needs review” list for the user to verify and fix (configurable or default for “replace” only if preferred).

## Acceptance criteria

- [ ] **Domain**: New optional fields added to `Measurement` and `Item` (and optionally `Option`, `Room`) in `src/lib/domain.ts` with types (e.g. `DataSource`, `ReviewStatus`).
- [ ] **Persistence**: New fields are read/written in IndexedDB and included in export JSON; import in `DataContext` normalizes them (with safe defaults).
- [ ] **Room detail**: Measurement add/edit form and list show data source, source ref, review status, and confidence; user can set and update them.
- [ ] **Item detail**: Item (and optionally option) edit shows and persists data source, source ref, review status.
- [ ] **Review surface**: A dedicated page or Settings section lists measurements and items (and options if applicable) that have `needs_review` or `ai_modified`, with filters and links to edit; user can mark as verified and set concrete/source ref.
- [ ] **Backward compatibility**: Existing exports without the new fields still import; new fields default to `null` (or to `needs_review` for a specific import path if specified).

## Optional enhancements

- **Bulk actions**: “Mark all in this room as needs_review” or “Mark selected as verified”.
- **Confidence for items**: Add `confidence` to `Item` (and optionally `Option`) for consistency with measurements.
- **Home-level metadata**: If the app has a “home” or “project” entity, a single “default source” or “last export file” could be stored for context.

---

## Example export fragment (after implementation)

```json
{
  "measurements": [
    {
      "id": "m_2a352587-6801-4189-a337-e59f9f8bc4bc",
      "room": "Master",
      "label": "Master wall to wall depth",
      "valueIn": 129,
      "confidence": "med",
      "dataSource": "concrete",
      "sourceRef": "Floor plan B1.1",
      "reviewStatus": "verified",
      "notes": "Horizontal",
      "createdAt": 1770488186635,
      "updatedAt": 1770490580857
    }
  ],
  "items": [
    {
      "id": "i_861b9f03-4de2-45c0-b08e-987cd35ee231",
      "name": "Sofa",
      "room": "Living",
      "dataSource": "estimated",
      "sourceRef": null,
      "reviewStatus": "ai_modified",
      "status": "Shortlist",
      ...
    }
  ]
}
```

Use this prompt as-is or adapt the field names and UI placement to match your preferences (e.g. different `ReviewStatus` values or a single “needs review” boolean plus a “source” tag).
