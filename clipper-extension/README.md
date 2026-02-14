# Furniture Tracker Clipper (MV3)

One-click browser clipper that sends product data to `/api/clip` and opens the item editor.

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `clipper-extension/`.

## Configure

Open the extension popup and set:

- **Clipper Token**
  - Must match `CLIPPER_TOKEN` in your app environment.

Click **Save Settings**.

Notes:
- API/Web URLs now auto-detect from your open app tab (`localhost` or Vercel).
- URL overrides are in **Advanced endpoint settings** and are masked like password fields.

## Use

1. On a product page, click the extension icon.
2. It captures from rendered page first.
3. If required fields are missing, it falls back to `/api/scrape/product`.
4. It posts to `/api/clip`.
5. It opens `/clip/open/:itemId`, auto-pulls latest data, then lands on `/items/:itemId`.

If you open popup while on the app tab itself (`/shopping`, `/items`, etc.):
1. Paste a product URL in popup.
2. Click **Capture URL**.
3. It uses scraper fallback and still creates the item + opens edit.
