# Furniture Tracker Clipper (MV3)

One-click browser clipper that captures product data and opens the app to create/edit the item in local app state.

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `clipper-extension/`.

## Configure

Open the extension popup and set:

- **Clipper Token**
  - Optional legacy setting (not required for local-first capture flow).

Click **Save Settings**.

Notes:
- API/Web URLs now auto-detect from your open app tab (`localhost` or Vercel).
- URL overrides are in **Advanced endpoint settings** and are masked like password fields.

## Use

1. On a product page, click the extension icon.
2. It captures from rendered page first.
3. If required fields are missing, it falls back to `/api/scrape/product`.
4. It opens `/clip/open/new` with the captured payload.
5. The app creates the item locally and lands on `/items/:itemId`.

If you open popup while on the app tab itself (`/shopping`, `/items`, etc.):
1. Paste a product URL in popup.
2. Click **Capture URL**.
3. It uses scraper fallback and still creates the local item + opens edit.
