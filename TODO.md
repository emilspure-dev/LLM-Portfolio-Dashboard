# Web dashboard — notes

## Layout

- **`dashboard/`** — main Vite + React app (upload `.xlsx`, charts, shadcn UI). Deploy this folder (e.g. Vercel root = `web/dashboard` after you rename `lovable-web` → `web`).
- **Repo root `src/`** (next to `dashboard/`) — smaller experimental Vite shell; optional.

## JSON exports

Run from repo root:

```powershell
py export_to_json.py
```

Writes to **`web-data/`**. Copy into `dashboard/public/data/` if the SPA should serve bundled JSON.

## Vercel

Project **root directory**: `lovable-web/dashboard` (or `web/dashboard` after rename). Ensure `VITE_API_URL` is set if you call a backend API.

## Rename folder `lovable-web` → `web`

If Windows reports “access denied”, close Cursor/terminals using that folder, then run:

```powershell
Rename-Item -Path "thesis_dashboard\lovable-web" -NewName "web"
```

Or use Explorer to rename after closing the workspace.
