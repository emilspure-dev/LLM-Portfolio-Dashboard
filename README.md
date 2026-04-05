# Thesis dashboard

This repo now has two pieces:

- `dashboard/`: the Vite/React frontend
- `backend/`: the read-only SQLite REST API

The frontend keeps the existing dashboard layout and overview visuals, but its data source is now the backend API instead of workbook uploads or sheet exports.

## Frontend

```bash
cd dashboard
npm install
npm run dev
```

Point the dashboard at an API by setting one of these env vars:

- `NEXT_PUBLIC_API_BASE_URL=https://dashboard-api.example.com`
- `VITE_API_BASE_URL=https://dashboard-api.example.com`

If your reverse proxy serves the API under the same origin, you can also use the dashboard origin itself because the client automatically appends `/api` unless the env var already ends with `/api`.

Example:

```bash
NEXT_PUBLIC_API_BASE_URL=https://dashboard.example.com
```

## Backend

```bash
cd backend
npm run start
```

Recommended production env on `204.168.227.31`:

```bash
SQLITE_DB_PATH=/srv/thesis/db/current.sqlite
DASHBOARD_ALLOWED_ORIGINS=https://dashboard.example.com
PORT=3001
HOST=0.0.0.0
```

The live database currently points to experiment `20260402_231231`.

## Production wiring

1. Run the backend on the server that can read `/srv/thesis/db/current.sqlite`.
2. Expose the backend over HTTPS, either on its own subdomain or behind `/api`.
3. Set `NEXT_PUBLIC_API_BASE_URL` on the frontend deployment to that API base.
4. Set `DASHBOARD_ALLOWED_ORIGINS` on the backend to the exact dashboard origin.

The browser should only talk to the REST API. SQLite stays server-side and is opened read-only by the backend process.

## API reference

Full backend setup notes and example `curl` requests for every endpoint live in [backend/README.md](/Users/emil/Documents/GitHub/LLM-Portfolio-Dashboard/backend/README.md).
