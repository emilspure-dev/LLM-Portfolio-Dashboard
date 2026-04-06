import http from "node:http";
import { URL } from "node:url";
import {
  DASHBOARD_ALLOWED_ORIGINS,
  HOST,
  PORT,
  SQLITE_DB_PATH,
} from "./config.mjs";
import { checkDatabase, closeDatabase, queryAll, queryGet } from "./db.mjs";
import {
  addDateRangeFilter,
  addEqualsFilter,
  buildWhereClause,
  cleanBooleanFlag,
  cleanString,
  createHttpError,
  parsePagination,
  rowsToValues,
} from "./query-helpers.mjs";

function json(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  if (!DASHBOARD_ALLOWED_ORIGINS.includes(origin)) {
    throw createHttpError(403, `Origin not allowed: ${origin}`);
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
}

function getLatestExperimentRecord() {
  return (
    queryGet(`
      SELECT
        experiment_id,
        completed_at,
        status
      FROM experiments
      WHERE completed_at IS NOT NULL OR status = 'completed'
      ORDER BY COALESCE(completed_at, generated_at) DESC
      LIMIT 1
    `) ??
    queryGet(`
      SELECT
        experiment_id,
        completed_at,
        status
      FROM experiments
      ORDER BY COALESCE(completed_at, generated_at) DESC
      LIMIT 1
    `)
  );
}

function resolveExperimentId(url) {
  const requested = cleanString(url.searchParams.get("experiment_id"));
  if (requested) {
    return requested;
  }

  const latest = getLatestExperimentRecord();
  if (!latest?.experiment_id) {
    throw createHttpError(404, "No experiments are available");
  }

  return latest.experiment_id;
}

function withExperimentFilters(url, fieldMap = {}) {
  const clauses = [];
  const params = {
    experiment_id: resolveExperimentId(url),
  };

  addEqualsFilter(clauses, params, fieldMap.experimentId ?? "experiment_id", params.experiment_id, "experiment_id");

  for (const [queryParam, column] of Object.entries(fieldMap)) {
    if (queryParam === "experimentId") {
      continue;
    }

    const value = cleanString(url.searchParams.get(queryParam));
    addEqualsFilter(clauses, params, column, value, queryParam);
  }

  return { clauses, params };
}

function getDateBounds(experimentId) {
  return (
    queryGet(`
      SELECT
        MIN(date) AS date_min,
        MAX(date) AS date_max
      FROM daily_prices
      WHERE experiment_id = :experiment_id
    `, { experiment_id: experimentId }) ??
    { date_min: null, date_max: null }
  );
}

function getPaginatedPayload(items, page, pageSize, totalRows) {
  return {
    page,
    page_size: pageSize,
    total_rows: totalRows,
    total_pages: totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize),
    items,
  };
}

function handleHealth() {
  const dbAvailable = checkDatabase();
  return {
    status: dbAvailable ? "ok" : "degraded",
    db_available: dbAvailable,
    current_db_path: SQLITE_DB_PATH,
  };
}

function handleMetaCurrent() {
  const latest = getLatestExperimentRecord();
  const experimentId = latest?.experiment_id ?? null;

  if (!experimentId) {
    return {
      latest_experiment_id: null,
      latest_completed_at: null,
      available_experiments: [],
      available_markets: [],
      available_periods: [],
      available_strategies: [],
      available_prompt_types: [],
      available_models: [],
    };
  }

  return {
    latest_experiment_id: experimentId,
    latest_completed_at: latest.completed_at ?? null,
    available_experiments: queryAll(`
      SELECT
        experiment_id,
        completed_at,
        status
      FROM experiments
      ORDER BY COALESCE(completed_at, generated_at) DESC
    `),
    available_markets: rowsToValues(
      queryAll(`
        SELECT DISTINCT market
        FROM period_dim
        WHERE experiment_id = :experiment_id
        ORDER BY market
      `, { experiment_id: experimentId }),
      "market"
    ),
    available_periods: rowsToValues(
      queryAll(`
        SELECT DISTINCT period, period_order
        FROM period_dim
        WHERE experiment_id = :experiment_id
        ORDER BY period_order
      `, { experiment_id: experimentId }),
      "period"
    ),
    available_strategies: queryAll(`
      SELECT DISTINCT
        strategy_key,
        strategy,
        source_type,
        NULLIF(prompt_type, '') AS prompt_type
      FROM vw_strategy_summary
      WHERE experiment_id = :experiment_id
      ORDER BY source_type, strategy_key, strategy
    `, { experiment_id: experimentId }),
    available_prompt_types: rowsToValues(
      queryAll(`
        SELECT DISTINCT prompt_type
        FROM run_results
        WHERE experiment_id = :experiment_id
          AND COALESCE(prompt_type, '') <> ''
        ORDER BY prompt_type
      `, { experiment_id: experimentId }),
      "prompt_type"
    ),
    available_models: rowsToValues(
      queryAll(`
        SELECT DISTINCT model
        FROM run_results
        WHERE experiment_id = :experiment_id
          AND COALESCE(model, '') <> ''
        ORDER BY model
      `, { experiment_id: experimentId }),
      "model"
    ),
  };
}

function handleFilters(url) {
  const experimentId = resolveExperimentId(url);
  const dateBounds = getDateBounds(experimentId);

  return {
    markets: rowsToValues(
      queryAll(`
        SELECT DISTINCT market
        FROM period_dim
        WHERE experiment_id = :experiment_id
        ORDER BY market
      `, { experiment_id: experimentId }),
      "market"
    ),
    periods: rowsToValues(
      queryAll(`
        SELECT DISTINCT period, period_order
        FROM period_dim
        WHERE experiment_id = :experiment_id
        ORDER BY period_order
      `, { experiment_id: experimentId }),
      "period"
    ),
    strategies: rowsToValues(
      queryAll(`
        SELECT DISTINCT strategy
        FROM vw_strategy_summary
        WHERE experiment_id = :experiment_id
        ORDER BY strategy
      `, { experiment_id: experimentId }),
      "strategy"
    ),
    strategy_keys: rowsToValues(
      queryAll(`
        SELECT DISTINCT strategy_key
        FROM vw_strategy_summary
        WHERE experiment_id = :experiment_id
        ORDER BY strategy_key
      `, { experiment_id: experimentId }),
      "strategy_key"
    ),
    prompt_types: rowsToValues(
      queryAll(`
        SELECT DISTINCT prompt_type
        FROM run_results
        WHERE experiment_id = :experiment_id
          AND COALESCE(prompt_type, '') <> ''
        ORDER BY prompt_type
      `, { experiment_id: experimentId }),
      "prompt_type"
    ),
    models: rowsToValues(
      queryAll(`
        SELECT DISTINCT model
        FROM run_results
        WHERE experiment_id = :experiment_id
          AND COALESCE(model, '') <> ''
        ORDER BY model
      `, { experiment_id: experimentId }),
      "model"
    ),
    source_types: rowsToValues(
      queryAll(`
        SELECT DISTINCT source_type
        FROM vw_strategy_summary
        WHERE experiment_id = :experiment_id
        ORDER BY source_type
      `, { experiment_id: experimentId }),
      "source_type"
    ),
    regime_labels: rowsToValues(
      queryAll(`
        SELECT label
        FROM (
          SELECT DISTINCT market_regime_label AS label
          FROM period_dim
          WHERE experiment_id = :experiment_id
            AND COALESCE(market_regime_label, '') <> ''
          UNION
          SELECT DISTINCT vol_regime_label AS label
          FROM period_dim
          WHERE experiment_id = :experiment_id
            AND COALESCE(vol_regime_label, '') <> ''
          UNION
          SELECT DISTINCT rate_regime_label AS label
          FROM period_dim
          WHERE experiment_id = :experiment_id
            AND COALESCE(rate_regime_label, '') <> ''
        )
        ORDER BY label
      `, { experiment_id: experimentId }),
      "label"
    ),
    date_min: dateBounds.date_min ?? null,
    date_max: dateBounds.date_max ?? null,
  };
}

function handleStrategySummary(url) {
  const experimentId = resolveExperimentId(url);
  const clauses = ["s.experiment_id = :experiment_id"];
  const params = { experiment_id: experimentId };

  addEqualsFilter(clauses, params, "s.market", cleanString(url.searchParams.get("market")), "market");
  addEqualsFilter(clauses, params, "s.strategy_key", cleanString(url.searchParams.get("strategy_key")), "strategy_key");
  addEqualsFilter(clauses, params, "s.source_type", cleanString(url.searchParams.get("source_type")), "source_type");
  addEqualsFilter(clauses, params, "s.prompt_type", cleanString(url.searchParams.get("prompt_type")), "prompt_type");

  return queryAll(`
    WITH gpt_beat_rates AS (
      SELECT
        rr.experiment_id,
        rr.strategy_key,
        rr.market,
        rr.prompt_type,
        AVG(
          CASE
            WHEN idx.mean_sharpe IS NOT NULL AND rr.sharpe_ratio IS NOT NULL
              THEN CASE WHEN rr.sharpe_ratio > idx.mean_sharpe THEN 1.0 ELSE 0.0 END
            ELSE NULL
          END
        ) * 100.0 AS pct_runs_beating_index_sharpe,
        AVG(
          CASE
            WHEN sf.mean_sharpe IS NOT NULL AND rr.sharpe_ratio IS NOT NULL
              THEN CASE WHEN rr.sharpe_ratio > sf.mean_sharpe THEN 1.0 ELSE 0.0 END
            ELSE NULL
          END
        ) * 100.0 AS pct_runs_beating_sixty_forty_sharpe
      FROM run_results rr
      LEFT JOIN vw_strategy_summary idx
        ON idx.experiment_id = rr.experiment_id
       AND idx.market = rr.market
       AND idx.strategy_key = 'index'
      LEFT JOIN vw_strategy_summary sf
        ON sf.experiment_id = rr.experiment_id
       AND sf.market = rr.market
       AND sf.strategy_key = 'sixty_forty'
      WHERE rr.experiment_id = :experiment_id
        AND rr.strategy_key IN ('gpt_retail', 'gpt_advanced')
      GROUP BY rr.experiment_id, rr.strategy_key, rr.market, rr.prompt_type
    )
    SELECT
      s.experiment_id,
      s.source_type,
      s.strategy_key,
      s.strategy,
      s.market,
      NULLIF(s.prompt_type, '') AS prompt_type,
      s.observations,
      s.mean_return,
      s.mean_annualized_return,
      s.mean_volatility,
      NULL AS mean_historical_var_95,
      s.mean_sharpe,
      s.mean_turnover,
      g.pct_runs_beating_index_sharpe,
      g.pct_runs_beating_sixty_forty_sharpe
    FROM vw_strategy_summary s
    LEFT JOIN gpt_beat_rates g
      ON g.experiment_id = s.experiment_id
     AND g.strategy_key = s.strategy_key
     AND g.market = s.market
     AND COALESCE(g.prompt_type, '') = COALESCE(s.prompt_type, '')
    ${buildWhereClause(clauses)}
    ORDER BY s.source_type, s.strategy_key, s.market, s.prompt_type
  `, params);
}

function handleFactorStyleSummary(url) {
  const experimentId = resolveExperimentId(url);
  const clauses = ["experiment_id = :experiment_id"];
  const params = { experiment_id: experimentId };

  addEqualsFilter(clauses, params, "market", cleanString(url.searchParams.get("market")), "market");

  const whereClause = buildWhereClause(clauses);

  return queryAll(
    `
    WITH path_means AS (
      SELECT
        path_id,
        strategy_key,
        strategy,
        NULLIF(TRIM(COALESCE(prompt_type, '')), '') AS prompt_type,
        market,
        AVG(portfolio_size_exposure) AS avg_size,
        AVG(portfolio_value_exposure) AS avg_value,
        AVG(portfolio_momentum_exposure) AS avg_momentum,
        AVG(portfolio_low_risk_exposure) AS avg_low_risk,
        AVG(portfolio_quality_exposure) AS avg_quality
      FROM vw_factor_exposure_daily
      ${whereClause}
      GROUP BY path_id, strategy_key, strategy, NULLIF(TRIM(COALESCE(prompt_type, '')), ''), market
    )
    SELECT
      strategy_key,
      strategy,
      prompt_type,
      market,
      COUNT(*) AS path_count,
      AVG(avg_size) AS mean_size_exposure,
      AVG(avg_value) AS mean_value_exposure,
      AVG(avg_momentum) AS mean_momentum_exposure,
      AVG(avg_low_risk) AS mean_low_risk_exposure,
      AVG(avg_quality) AS mean_quality_exposure
    FROM path_means
    GROUP BY strategy_key, strategy, prompt_type, market
    ORDER BY strategy_key, prompt_type, market
  `,
    params
  );
}

function handleRunQuality(url) {
  const { clauses, params } = withExperimentFilters(url, {
    experimentId: "experiment_id",
    market: "market",
    period: "period",
    prompt_type: "prompt_type",
    model: "model",
    failure_type: "failure_type",
    execution_mode: "execution_mode",
  });

  return queryAll(`
    SELECT
      experiment_id,
      market,
      period,
      prompt_type,
      model,
      failure_type,
      execution_mode,
      row_count,
      valid_rows,
      repaired_rows,
      avg_repair_attempts
    FROM vw_run_quality
    ${buildWhereClause(clauses)}
    ORDER BY market, period, prompt_type, model, failure_type, execution_mode
  `, params);
}

function handleEquity(url) {
  const { clauses, params } = withExperimentFilters(url, {
    experimentId: "experiment_id",
    strategy_key: "strategy_key",
    market: "market",
    prompt_type: "prompt_type",
    model: "model",
    path_id: "path_id",
  });

  addDateRangeFilter(
    clauses,
    params,
    "date",
    cleanString(url.searchParams.get("date_from")),
    cleanString(url.searchParams.get("date_to"))
  );

  return queryAll(`
    SELECT
      experiment_id,
      path_id,
      source_type,
      strategy_key,
      strategy,
      market,
      NULLIF(prompt_type, '') AS prompt_type,
      NULLIF(model, '') AS model,
      NULLIF(trajectory_id, '') AS trajectory_id,
      run_id,
      date,
      period,
      period_start_date,
      period_end_date,
      asof_cutoff_date,
      market_regime_label,
      vol_regime_label,
      rate_regime_label,
      regime_code,
      portfolio_value,
      daily_return,
      running_peak,
      drawdown,
      drifted_hhi,
      drifted_effective_n_holdings,
      active_holdings,
      top1_weight,
      top3_weight,
      portfolio_size_exposure,
      portfolio_value_exposure,
      portfolio_momentum_exposure,
      portfolio_low_risk_exposure,
      portfolio_quality_exposure
    FROM vw_strategy_daily
    ${buildWhereClause(clauses)}
    ORDER BY path_id, date
  `, params);
}

function handleFactorExposures(url) {
  const { clauses, params } = withExperimentFilters(url, {
    experimentId: "experiment_id",
    strategy_key: "strategy_key",
    market: "market",
    prompt_type: "prompt_type",
    model: "model",
    path_id: "path_id",
  });

  addDateRangeFilter(
    clauses,
    params,
    "date",
    cleanString(url.searchParams.get("date_from")),
    cleanString(url.searchParams.get("date_to"))
  );

  return queryAll(`
    SELECT
      experiment_id,
      path_id,
      source_type,
      strategy_key,
      strategy,
      market,
      NULLIF(prompt_type, '') AS prompt_type,
      NULLIF(model, '') AS model,
      NULLIF(trajectory_id, '') AS trajectory_id,
      run_id,
      date,
      period,
      market_regime_label,
      vol_regime_label,
      rate_regime_label,
      regime_code,
      portfolio_size_exposure,
      portfolio_value_exposure,
      portfolio_momentum_exposure,
      portfolio_low_risk_exposure,
      portfolio_quality_exposure
    FROM vw_factor_exposure_daily
    ${buildWhereClause(clauses)}
    ORDER BY path_id, date
  `, params);
}

function handleRegimes(url) {
  const { clauses, params } = withExperimentFilters(url, {
    experimentId: "experiment_id",
    strategy_key: "strategy_key",
    market: "market",
    prompt_type: "prompt_type",
    model: "model",
    path_id: "path_id",
  });

  addDateRangeFilter(
    clauses,
    params,
    "date",
    cleanString(url.searchParams.get("date_from")),
    cleanString(url.searchParams.get("date_to"))
  );

  return queryAll(`
    SELECT
      experiment_id,
      path_id,
      source_type,
      strategy_key,
      strategy,
      market,
      NULLIF(prompt_type, '') AS prompt_type,
      NULLIF(model, '') AS model,
      NULLIF(trajectory_id, '') AS trajectory_id,
      run_id,
      date,
      period,
      period_start_date,
      period_end_date,
      asof_cutoff_date,
      market_regime_label,
      vol_regime_label,
      rate_regime_label,
      regime_code,
      market_regime_changed,
      vol_regime_changed,
      rate_regime_changed,
      any_regime_changed,
      portfolio_value,
      daily_return,
      drawdown
    FROM vw_regime_daily
    ${buildWhereClause(clauses)}
    ORDER BY path_id, date
  `, params);
}

function handleHoldings(url) {
  const { page, pageSize, limit, offset } = parsePagination(url.searchParams);
  const clauses = ["experiment_id = :experiment_id"];
  const params = {
    experiment_id: resolveExperimentId(url),
  };

  addEqualsFilter(clauses, params, "strategy_key", cleanString(url.searchParams.get("strategy_key")), "strategy_key");
  addEqualsFilter(clauses, params, "market", cleanString(url.searchParams.get("market")), "market");
  addEqualsFilter(clauses, params, "prompt_type", cleanString(url.searchParams.get("prompt_type")), "prompt_type");
  addEqualsFilter(clauses, params, "model", cleanString(url.searchParams.get("model")), "model");
  addEqualsFilter(clauses, params, "path_id", cleanString(url.searchParams.get("path_id")), "path_id");
  addEqualsFilter(clauses, params, "period", cleanString(url.searchParams.get("period")), "period");
  addEqualsFilter(clauses, params, "ticker", cleanString(url.searchParams.get("ticker")), "ticker");

  const dateValue = cleanString(url.searchParams.get("date"));
  if (dateValue != null) {
    clauses.push("date(date) = date(:date)");
    params.date = dateValue;
  }

  const whereClause = buildWhereClause(clauses);
  const paginationParams = {
    ...params,
    limit,
    offset,
  };
  const totalRow = queryGet(`
    SELECT COUNT(*) AS total_rows
    FROM daily_holdings
    ${whereClause}
  `, params);

  const items = queryAll(`
    SELECT
      experiment_id,
      path_id,
      source_type,
      strategy_key,
      strategy,
      market,
      NULLIF(prompt_type, '') AS prompt_type,
      NULLIF(model, '') AS model,
      NULLIF(trajectory_id, '') AS trajectory_id,
      run_id,
      date,
      period,
      COALESCE(period_start_date_y, period_start_date_x) AS period_start_date,
      COALESCE(period_end_date_y, period_end_date_x) AS period_end_date,
      COALESCE(asof_cutoff_date_y, asof_cutoff_date_x) AS asof_cutoff_date,
      market_regime_label,
      vol_regime_label,
      rate_regime_label,
      regime_code,
      ticker,
      name,
      asset_class,
      sector,
      market_cap,
      pb_ratio,
      roe,
      debt_to_equity,
      trailing_return_6m,
      trailing_vol_6m,
      net_margin_proxy,
      size_rank_pct,
      value_rank_pct,
      momentum_rank_pct,
      low_risk_rank_pct,
      quality_rank_pct,
      size_label,
      value_label,
      momentum_label,
      low_risk_label,
      quality_label,
      close,
      start_close,
      price_relative,
      target_weight,
      effective_weight_period_start,
      drifted_weight,
      weighted_value,
      value_contribution_pct
    FROM daily_holdings
    ${whereClause}
    ORDER BY date DESC, path_id, value_contribution_pct DESC, ticker
    LIMIT :limit OFFSET :offset
  `, paginationParams);

  return getPaginatedPayload(
    items,
    page,
    pageSize,
    Number(totalRow?.total_rows ?? 0)
  );
}

function handlePrices(url) {
  const ticker = cleanString(url.searchParams.get("ticker"));
  if (!ticker) {
    throw createHttpError(400, "ticker is required");
  }

  const clauses = ["experiment_id = :experiment_id", "ticker = :ticker"];
  const params = {
    experiment_id: resolveExperimentId(url),
    ticker,
  };

  addEqualsFilter(clauses, params, "market", cleanString(url.searchParams.get("market")), "market");
  addEqualsFilter(clauses, params, "period", cleanString(url.searchParams.get("period")), "period");

  return queryAll(`
    SELECT
      experiment_id,
      market,
      period,
      date,
      ticker,
      close
    FROM daily_prices
    ${buildWhereClause(clauses)}
    ORDER BY date
  `, params);
}

function handleRunResults(url) {
  const { page, pageSize, limit, offset } = parsePagination(url.searchParams);
  const clauses = ["experiment_id = :experiment_id"];
  const params = {
    experiment_id: resolveExperimentId(url),
  };

  addEqualsFilter(clauses, params, "market", cleanString(url.searchParams.get("market")), "market");
  addEqualsFilter(clauses, params, "period", cleanString(url.searchParams.get("period")), "period");
  addEqualsFilter(clauses, params, "prompt_type", cleanString(url.searchParams.get("prompt_type")), "prompt_type");
  addEqualsFilter(clauses, params, "model", cleanString(url.searchParams.get("model")), "model");
  addEqualsFilter(clauses, params, "strategy_key", cleanString(url.searchParams.get("strategy_key")), "strategy_key");
  addEqualsFilter(clauses, params, "failure_type", cleanString(url.searchParams.get("failure_type")), "failure_type");
  addEqualsFilter(clauses, params, "execution_mode", cleanString(url.searchParams.get("execution_mode")), "execution_mode");

  const validFlag = cleanBooleanFlag(url.searchParams.get("valid"));
  addEqualsFilter(clauses, params, "valid", validFlag, "valid");

  const whereClause = buildWhereClause(clauses);
  const paginationParams = {
    ...params,
    limit,
    offset,
  };
  const totalRow = queryGet(`
    SELECT COUNT(*) AS total_rows
    FROM run_results
    ${whereClause}
  `, params);

  const items = queryAll(`
    SELECT *
    FROM run_results
    ${whereClause}
    ORDER BY market, period, prompt_type, model, run_id
    LIMIT :limit OFFSET :offset
  `, paginationParams);

  return getPaginatedPayload(
    items,
    page,
    pageSize,
    Number(totalRow?.total_rows ?? 0)
  );
}

function handlePeriods(url) {
  const clauses = ["experiment_id = :experiment_id"];
  const params = {
    experiment_id: resolveExperimentId(url),
  };

  addEqualsFilter(clauses, params, "market", cleanString(url.searchParams.get("market")), "market");

  return queryAll(`
    SELECT
      experiment_id,
      market,
      period,
      period_start_date,
      period_end_date,
      asof_cutoff_date,
      period_order,
      market_regime_label,
      vol_regime_label,
      rate_regime_label,
      regime_code,
      market_regime_order,
      vol_regime_order,
      rate_regime_order,
      market_regime_changed,
      vol_regime_changed,
      rate_regime_changed,
      any_regime_changed
    FROM period_dim
    ${buildWhereClause(clauses)}
    ORDER BY market, period_order
  `, params);
}

const routes = new Map([
  ["GET /api/health", () => handleHealth()],
  ["GET /api/meta/current", () => handleMetaCurrent()],
  ["GET /api/filters", ({ url }) => handleFilters(url)],
  ["GET /api/summary/strategies", ({ url }) => handleStrategySummary(url)],
  ["GET /api/summary/factor-style", ({ url }) => handleFactorStyleSummary(url)],
  ["GET /api/summary/run-quality", ({ url }) => handleRunQuality(url)],
  ["GET /api/charts/equity", ({ url }) => handleEquity(url)],
  ["GET /api/charts/factor-exposures", ({ url }) => handleFactorExposures(url)],
  ["GET /api/charts/regimes", ({ url }) => handleRegimes(url)],
  ["GET /api/holdings/daily", ({ url }) => handleHoldings(url)],
  ["GET /api/prices", ({ url }) => handlePrices(url)],
  ["GET /api/run-results", ({ url }) => handleRunResults(url)],
  ["GET /api/periods", ({ url }) => handlePeriods(url)],
]);

const server = http.createServer((request, response) => {
  try {
    applyCors(request, response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const routeKey = `${request.method} ${url.pathname}`;
    const handler = routes.get(routeKey);

    if (!handler) {
      json(response, 404, {
        error: "not_found",
        message: `No route matches ${routeKey}`,
      });
      return;
    }

    if (!checkDatabase() && url.pathname !== "/api/health") {
      throw createHttpError(503, "SQLite database is unavailable");
    }

    let payload = handler({ request, response, url });
    if (url.pathname === "/api/health" && payload && typeof payload === "object") {
      payload = {
        ...payload,
        routes: {
          factor_style: routes.has("GET /api/summary/factor-style"),
        },
      };
    }
    json(response, 200, payload);
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    json(response, statusCode, {
      error: statusCode >= 500 ? "internal_error" : "bad_request",
      message: error.message ?? "Unexpected error",
      details: error.details ?? null,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `Read-only dashboard API listening on http://${HOST}:${PORT} using ${SQLITE_DB_PATH}`
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    closeDatabase();
    server.close(() => process.exit(0));
  });
}
