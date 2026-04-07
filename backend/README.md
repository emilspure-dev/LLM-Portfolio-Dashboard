# Thesis dashboard API

Small read-only REST API for the dashboard. It opens SQLite in read-only mode, uses parameterized SQL, keeps filtering on the server, and paginates the large endpoints.

## Environment

```bash
cp .env.example .env
```

Key variables:

- `SQLITE_DB_PATH=/srv/thesis/db/current.sqlite`
- `DASHBOARD_ALLOWED_ORIGINS=https://dashboard.example.com`
- `PORT=3001`
- `HOST=0.0.0.0`

For local verification you can point `SQLITE_DB_PATH` at a copied snapshot, for example `/tmp/current.sqlite`.

## Run

```bash
npm run start
```

For development with auto-reload:

```bash
npm run dev
```

## Production notes

- The browser never connects to SQLite directly.
- The API process should run on the server and read `/srv/thesis/db/current.sqlite` through `SQLITE_DB_PATH`.
- CORS is restricted to the origins listed in `DASHBOARD_ALLOWED_ORIGINS`.
- The backend reads the raw schema-version-2 tables directly (`experiments`, `paths`, `llm_run_results`, `path_period_metrics`, `daily_path_metrics`, `daily_holdings`, `market_periods`, `instrument_periods`, `daily_prices`).
- `/api/health` reports the connected schema version, but the route layer no longer blocks requests once the live DB has been promoted.

### Updating the API after pulling new routes (e.g. `/api/summary/factor-style`)

The dashboard can **aggregate factor-style in the browser** from `GET /api/charts/factor-exposures` when `/api/summary/factor-style` returns 404 (same `daily_path_metrics` logic as the server). Deploying the current backend still removes the extra request and restores `routes.factor_style` on `/api/health`.

If the Vercel dashboard proxies to this server but you see `No route matches GET /api/summary/factor-style`, the running Node process is an **older build**. On the VPS:

```bash
cd /path/to/LLM-Portfolio-Dashboard
git pull origin main
cd backend
npm ci
# however you run prod, e.g.:
sudo systemctl restart thesis-dashboard-api
# or: pm2 restart thesis-dashboard-api
```

Add **`https://llm-portfolio-dashboard.vercel.app`** (your production dashboard origin) to **`DASHBOARD_ALLOWED_ORIGINS`** if you call the API **directly** from the browser with `VITE_API_BASE_URL`. When using the **Vercel `/api` proxy** (`dashboard/api/shim.js` or root `api/shim.js` depending on Vercel Root Directory), the browser talks only to `vercel.app`; the proxy server-to-server does not send an `Origin` that triggers your CORS allow-list the same way—keep the proxy as the primary path for production.

## Example curl requests

Replace `API_BASE_URL` if your API is not running on `http://127.0.0.1:3001`.

```bash
export API_BASE_URL=http://127.0.0.1:3001
export EXPERIMENT_ID=20260402_231231
```

Health:

```bash
curl -sS "$API_BASE_URL/api/health"
```

Current metadata:

```bash
curl -sS "$API_BASE_URL/api/meta/current"
```

Available filters:

```bash
curl -sS "$API_BASE_URL/api/filters?experiment_id=$EXPERIMENT_ID"
```

Strategy summary:

```bash
curl -sS "$API_BASE_URL/api/summary/strategies?experiment_id=$EXPERIMENT_ID"
```

Mean factor exposures by strategy (path-averaged from raw `daily_path_metrics`):

```bash
curl -sS "$API_BASE_URL/api/summary/factor-style?experiment_id=$EXPERIMENT_ID"
```

Run quality summary:

```bash
curl -sS "$API_BASE_URL/api/summary/run-quality?experiment_id=$EXPERIMENT_ID"
```

Equity chart series:

```bash
curl -sS "$API_BASE_URL/api/charts/equity?experiment_id=$EXPERIMENT_ID&strategy_key=equal_weight&market=germany&date_from=2021-09-01&date_to=2021-09-03"
```

Factor exposure chart series:

```bash
curl -sS "$API_BASE_URL/api/charts/factor-exposures?experiment_id=$EXPERIMENT_ID&strategy_key=equal_weight&market=germany&date_from=2021-09-01&date_to=2021-09-03"
```

Regime chart series:

```bash
curl -sS "$API_BASE_URL/api/charts/regimes?experiment_id=$EXPERIMENT_ID&strategy_key=equal_weight&market=germany&date_from=2021-09-01&date_to=2021-09-03"
```

Daily holdings with pagination:

```bash
curl -sS "$API_BASE_URL/api/holdings/daily?experiment_id=$EXPERIMENT_ID&strategy_key=equal_weight&market=germany&date=2021-09-01&page=1&page_size=100"
```

Prices:

```bash
curl -sS "$API_BASE_URL/api/prices?ticker=SPY&market=us&period=2025H2&experiment_id=$EXPERIMENT_ID"
```

Run results with pagination:

```bash
curl -sS "$API_BASE_URL/api/run-results?experiment_id=$EXPERIMENT_ID&market=germany&period=2021H2&prompt_type=advanced&page=1&page_size=100"
```

Periods:

```bash
curl -sS "$API_BASE_URL/api/periods?experiment_id=$EXPERIMENT_ID"
```
