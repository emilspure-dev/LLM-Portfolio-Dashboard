# Web dashboard — notes

## App location

All UI code is in **`dashboard/`** (Vite + React, shadcn-style components). Deploy that folder (Vercel root = `lovable-web/dashboard`, or `web/dashboard` if you rename the parent folder).

## JSON exports

From the **thesis** repo root (`thesis_dashboard/`):

```powershell
py export_to_json.py
```

Writes to **`web-data/`**. Copy into `dashboard/public/data/` if the SPA should ship bundled JSON.

## Vercel

Set **`VITE_API_URL`** in project env if the app calls a backend API.

## Rename folder `lovable-web` → `web`

If Windows reports “access denied”, close Cursor/terminals using that folder, then:

```powershell
Rename-Item -Path "thesis_dashboard\lovable-web" -NewName "web"
```

Or use Explorer after closing the workspace.
