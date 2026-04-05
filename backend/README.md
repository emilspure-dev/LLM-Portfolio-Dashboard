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
- The holdings endpoint currently preserves the intended `vw_holdings_daily` response shape by selecting from `daily_holdings` with explicit aliases, because the live `vw_holdings_daily` view references non-existent unqualified date columns in the current database build.

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

Mean factor exposures by strategy (path-averaged, from `vw_factor_exposure_daily`):

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
