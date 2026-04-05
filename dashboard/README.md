# Thesis dashboard (React UI)

Vite + React + TypeScript + Tailwind + shadcn-style components.

The dashboard now reads from a backend API instead of loading workbook uploads directly in the browser. UI structure, tabs, filters, and overview visuals stay in the React app; SQLite access stays server-side in `../backend`.

## Develop

```bash
npm install
npm run dev
```

Create a local env file when you want to point the frontend at a backend:

```bash
cp .env.example .env.local
```

Example:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

If the API is reverse-proxied under the same domain, `NEXT_PUBLIC_API_BASE_URL=https://dashboard.example.com` is enough because the client appends `/api` automatically.

## Build / Vercel

**Root Directory** in the Vercel project must match where `vercel.json` lives:

- **`dashboard`** (recommended): uses `dashboard/vercel.json` and `dashboard/api/shim.js`. Rewrites map every `/api/*` path into `shim` (Vercel’s `api/[...slug].js` only matched a single segment, so `/api/meta/current` used to 404). SPA rewrites skip `/api/*` via a negative lookahead.
- **Repository root** (`.`): uses the root `vercel.json` (builds `dashboard/` into `dashboard/dist`) and root `api/shim.js`.

Set `NEXT_PUBLIC_API_BASE_URL` in the frontend deployment so the browser knows where to fetch JSON from.

For the production server described in this project:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-dashboard-domain.example
```

The corresponding backend should run on the server with:

```bash
SQLITE_DB_PATH=/srv/thesis/db/current.sqlite
```

## Playwright

```bash
npx playwright install
npx playwright test
```
