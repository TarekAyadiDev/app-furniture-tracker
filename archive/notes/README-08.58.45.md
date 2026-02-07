# Furniture Tracker

Track and manage furniture items — inventory, locations, and status.

## 2B Furnishing Tracker (single-file Airtable UI)

`index.html` (root) is the single-page “2B Furnishing Tracker”. It talks directly to Airtable via `config.js` (same token/base/table as before). Open the HTML file locally in a browser; no build step is required.

### Recommended Airtable fields (single table, single-select `Record Type`)
- Common: Record Type, Title, Room, Status, Priority, Link, Notes, Budget Target, Price, Quantity
- Measurements: Measure Label, Value, Unit Entered, Value (cm), Value (in), Confidence
- Options: Parent Item Record Id, Parent Item Key, Store, Promo Code, Discount, Shipping, Tax Estimate, Final Total, Dimensions, Selected Option Id
- Purchases: Order Date, Order Number, Expected Delivery, Actual Delivery, Return By

### Field mapping
- The app ships with defaults above but many bases still have the old apartment columns (e.g., “Listing URL”, “Your Comment”, “Group”).
- Open the **Field mapping** panel in the UI to map each semantic field to your real column name; mapping is stored in `localStorage` and applied to all reads/writes.
- Optional **Schema check** calls Airtable’s Metadata API and shows which recommended columns are missing so you can create/rename them (app still works with mapping even if you skip this).

### Run locally
1) Place your `config.js` (with `AIRTABLE_TOKEN`, `BASE_ID`, `TABLE_ID`) next to `index.html` (already present if you copied it).
2) Open `index.html` directly in a browser, or serve the folder with any static server.
3) Use the three tabs: Measurements, Items, Options/Compare. Measurements always show cm and inches; Items and Options share the same Airtable table via `Record Type`.

### JSON import (all record types)
- JSON accepts either a `records` array (each object sets `recordType`) or typed arrays: `measurements`, `items`, `options`, `purchases`, `notes`. Legacy apartment JSON still maps to Items. Markdown checklists also import as Items.
- Example (Town Hollywood B1.1 quick-start): `JSONs/town_hollywood_setup.json` — includes the “10 measurements” plus starter items/options tied to our actual home (#furniture #Town). Import it via the app’s Import panel.

## Notes

- No build step is required; everything is in `index.html` + `config.js`.
- Serve locally with any static server if you prefer hot reload (e.g., `npx serve .`), otherwise just double-click `index.html`.
