# Archive

This folder contains legacy / duplicate artifacts that were moved out of the repo root so there is exactly one runnable app at the root (the Vite/React app).

Why this exists:
- Prevent accidentally opening the wrong `index.html` / `tracker.html`.
- Preserve prior work and reference material while the new app is the canonical implementation.

Contents (high level):
- `legacy-static/`: the older single-file HTML tracker + helper scripts/JSONs (no longer used).
- `legacy-vite-public/`: the previous `public/` assets that included a duplicate `tracker.html` and a legacy `config.js` (token redacted).
- `legacy-vite-source-robots.txt/`: the original folder where the Vite project lived before being moved to the repo root.
- `notes/`: scratch readmes and supporting notes.

Security note:
- Any legacy Airtable tokens were redacted. If you previously committed a real token, rotate/revoke it and (if the repo was ever pushed) consider purging git history.

