import http from "node:http";
import { URL } from "node:url";
import {
  DASHBOARD_ALLOWED_ORIGINS,
  HOST,
  PORT,
  SQLITE_DB_PATH,
} from "./config.mjs";
import {
  checkDatabase,
  closeDatabase,
  getSchemaVersion,
  getTableColumns,
  queryAll,
  queryGet,
} from "./db.mjs";
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

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll(`"`, `""`)}"`;
}

function buildAliasedSelectList(alias, columns, excluded = new Set()) {
  return columns
    .filter((column) => !excluded.has(column))
    .map((column) => `${alias}.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`);
}

function getLatestExperimentRecord() {
  return (
    queryGet(`
      SELECT
        experiment_id,
        completed_at,
        status
      FROM experiments
      WHERE completed_at IS NOT NULL
         OR lower(COALESCE(status, '')) = 'completed'
      ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC, experiment_id DESC
      LIMIT 1
    `) ??
    queryGet(`
      SELECT
        experiment_id,
        completed_at,
        status
      FROM experiments
      ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC, experiment_id DESC
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

  addEqualsFilter(
    clauses,
    params,
    fieldMap.experimentId ?? "experiment_id",
    params.experiment_id,
    "experiment_id"
  );

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
        MIN(dp.date) AS date_min,
        MAX(dp.date) AS date_max
      FROM experiments e
      JOIN daily_prices dp
        ON dp.data_snapshot_id = e.data_snapshot_id
      WHERE e.experiment_id = :experiment_id
    `, { experiment_id: experimentId }) ?? { date_min: null, date_max: null }
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
  const schemaVersion = getSchemaVersion();
  const dbAvailable = checkDatabase();

  return {
    status: dbAvailable ? "ok" : "degraded",
    db_available: dbAvailable,
    current_db_path: SQLITE_DB_PATH,
    schema_version: schemaVersion,
    expected_schema_version: 2,
    schema_ready: schemaVersion === 2,
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
      ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC, experiment_id DESC
    `),
    available_markets: rowsToValues(
      queryAll(`
        SELECT DISTINCT mp.market
        FROM experiments e
        JOIN market_periods mp
          ON mp.data_snapshot_id = e.data_snapshot_id
        WHERE e.experiment_id = :experiment_id
        ORDER BY mp.market
      `, { experiment_id: experimentId }),
      "market"
    ),
    available_periods: rowsToValues(
      queryAll(`
        SELECT
          mp.period,
          MIN(mp.period_order) AS period_order
        FROM experiments e
        JOIN market_periods mp
          ON mp.data_snapshot_id = e.data_snapshot_id
        WHERE e.experiment_id = :experiment_id
        GROUP BY mp.period
        ORDER BY MIN(mp.period_order), mp.period
      `, { experiment_id: experimentId }),
      "period"
    ),
    available_strategies: queryAll(`
      SELECT DISTINCT
        p.strategy_key,
        p.strategy,
        p.source_type,
        NULLIF(p.prompt_type, '') AS prompt_type
      FROM paths p
      WHERE p.experiment_id = :experiment_id
      ORDER BY p.source_type, p.strategy_key, p.strategy, NULLIF(p.prompt_type, '')
    `, { experiment_id: experimentId }),
    available_prompt_types: rowsToValues(
      queryAll(`
        SELECT DISTINCT NULLIF(prompt_type, '') AS prompt_type
        FROM paths
        WHERE experiment_id = :experiment_id
          AND COALESCE(prompt_type, '') <> ''
        ORDER BY prompt_type
      `, { experiment_id: experimentId }),
      "prompt_type"
    ),
    available_models: rowsToValues(
      queryAll(`
        SELECT DISTINCT NULLIF(model, '') AS model
        FROM llm_run_results
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
        SELECT DISTINCT mp.market
        FROM experiments e
        JOIN market_periods mp
          ON mp.data_snapshot_id = e.data_snapshot_id
        WHERE e.experiment_id = :experiment_id
        ORDER BY mp.market
      `, { experiment_id: experimentId }),
      "market"
    ),
    periods: rowsToValues(
      queryAll(`
        SELECT
          mp.period,
          MIN(mp.period_order) AS period_order
        FROM experiments e
        JOIN market_periods mp
          ON mp.data_snapshot_id = e.data_snapshot_id
        WHERE e.experiment_id = :experiment_id
        GROUP BY mp.period
        ORDER BY MIN(mp.period_order), mp.period
      `, { experiment_id: experimentId }),
      "period"
    ),
    strategies: rowsToValues(
      queryAll(`
        SELECT DISTINCT strategy
        FROM paths
        WHERE experiment_id = :experiment_id
        ORDER BY strategy
      `, { experiment_id: experimentId }),
      "strategy"
    ),
    strategy_keys: rowsToValues(
      queryAll(`
        SELECT DISTINCT strategy_key
        FROM paths
        WHERE experiment_id = :experiment_id
        ORDER BY strategy_key
      `, { experiment_id: experimentId }),
      "strategy_key"
    ),
    prompt_types: rowsToValues(
      queryAll(`
        SELECT DISTINCT NULLIF(prompt_type, '') AS prompt_type
        FROM paths
        WHERE experiment_id = :experiment_id
          AND COALESCE(prompt_type, '') <> ''
        ORDER BY prompt_type
      `, { experiment_id: experimentId }),
      "prompt_type"
    ),
    models: rowsToValues(
      queryAll(`
        SELECT DISTINCT NULLIF(model, '') AS model
        FROM llm_run_results
        WHERE experiment_id = :experiment_id
          AND COALESCE(model, '') <> ''
        ORDER BY model
      `, { experiment_id: experimentId }),
      "model"
    ),
    source_types: rowsToValues(
      queryAll(`
        SELECT DISTINCT source_type
        FROM paths
        WHERE experiment_id = :experiment_id
        ORDER BY source_type
      `, { experiment_id: experimentId }),
      "source_type"
    ),
    regime_labels: rowsToValues(
      queryAll(`
        SELECT label
        FROM (
          SELECT DISTINCT mp.market_regime_label AS label
          FROM experiments e
          JOIN market_periods mp
            ON mp.data_snapshot_id = e.data_snapshot_id
          WHERE e.experiment_id = :experiment_id
            AND COALESCE(mp.market_regime_label, '') <> ''
          UNION
          SELECT DISTINCT mp.vol_regime_label AS label
          FROM experiments e
          JOIN market_periods mp
            ON mp.data_snapshot_id = e.data_snapshot_id
          WHERE e.experiment_id = :experiment_id
            AND COALESCE(mp.vol_regime_label, '') <> ''
          UNION
          SELECT DISTINCT mp.rate_regime_label AS label
          FROM experiments e
          JOIN market_periods mp
            ON mp.data_snapshot_id = e.data_snapshot_id
          WHERE e.experiment_id = :experiment_id
            AND COALESCE(mp.rate_regime_label, '') <> ''
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
  addEqualsFilter(
    clauses,
    params,
    "s.strategy_key",
    cleanString(url.searchParams.get("strategy_key")),
    "strategy_key"
  );
  addEqualsFilter(
    clauses,
    params,
    "s.source_type",
    cleanString(url.searchParams.get("source_type")),
    "source_type"
  );
  addEqualsFilter(
    clauses,
    params,
    "s.prompt_type",
    cleanString(url.searchParams.get("prompt_type")),
    "prompt_type"
  );

  return queryAll(`
    WITH benchmark_sharpes AS (
      SELECT
        ppm.experiment_id,
        p.market,
        p.strategy_key,
        AVG(ppm.sharpe_ratio) AS mean_sharpe
      FROM path_period_metrics ppm
      JOIN paths p
        ON p.experiment_id = ppm.experiment_id
       AND p.path_id = ppm.path_id
      WHERE ppm.experiment_id = :experiment_id
        AND p.strategy_key IN ('index', 'sixty_forty')
      GROUP BY ppm.experiment_id, p.market, p.strategy_key
    ),
    gpt_beat_rates AS (
      SELECT
        ppm.experiment_id,
        p.strategy_key,
        p.market,
        NULLIF(p.prompt_type, '') AS prompt_type,
        AVG(
          CASE
            WHEN idx.mean_sharpe IS NOT NULL AND ppm.sharpe_ratio IS NOT NULL
              THEN CASE WHEN ppm.sharpe_ratio > idx.mean_sharpe THEN 1.0 ELSE 0.0 END
            ELSE NULL
          END
        ) * 100.0 AS pct_runs_beating_index_sharpe,
        AVG(
          CASE
            WHEN sf.mean_sharpe IS NOT NULL AND ppm.sharpe_ratio IS NOT NULL
              THEN CASE WHEN ppm.sharpe_ratio > sf.mean_sharpe THEN 1.0 ELSE 0.0 END
            ELSE NULL
          END
        ) * 100.0 AS pct_runs_beating_sixty_forty_sharpe
      FROM path_period_metrics ppm
      JOIN paths p
        ON p.experiment_id = ppm.experiment_id
       AND p.path_id = ppm.path_id
      LEFT JOIN benchmark_sharpes idx
        ON idx.experiment_id = ppm.experiment_id
       AND idx.market = p.market
       AND idx.strategy_key = 'index'
      LEFT JOIN benchmark_sharpes sf
        ON sf.experiment_id = ppm.experiment_id
       AND sf.market = p.market
       AND sf.strategy_key = 'sixty_forty'
      WHERE ppm.experiment_id = :experiment_id
        AND p.strategy_key IN ('gpt_retail', 'gpt_advanced')
      GROUP BY ppm.experiment_id, p.strategy_key, p.market, NULLIF(p.prompt_type, '')
    ),
    s AS (
      SELECT
        ppm.experiment_id,
        p.source_type,
        p.strategy_key,
        p.strategy,
        p.market,
        NULLIF(p.prompt_type, '') AS prompt_type,
        COUNT(*) AS observations,
        AVG(ppm.period_return) AS mean_return,
        AVG(ppm.annualized_return) AS mean_annualized_return,
        AVG(ppm.volatility) AS mean_volatility,
        AVG(ppm.historical_var_95) AS mean_historical_var_95,
        AVG(ppm.sharpe_ratio) AS mean_sharpe,
        AVG(ppm.turnover) AS mean_turnover
      FROM path_period_metrics ppm
      JOIN paths p
        ON p.experiment_id = ppm.experiment_id
       AND p.path_id = ppm.path_id
      WHERE ppm.experiment_id = :experiment_id
      GROUP BY
        ppm.experiment_id,
        p.source_type,
        p.strategy_key,
        p.strategy,
        p.market,
        NULLIF(p.prompt_type, '')
    )
    SELECT
      s.experiment_id,
      s.source_type,
      s.strategy_key,
      s.strategy,
      s.market,
      s.prompt_type,
      s.observations,
      s.mean_return,
      s.mean_annualized_return,
      s.mean_volatility,
      s.mean_historical_var_95,
      s.mean_sharpe,
      s.mean_turnover,
      g.pct_runs_beating_index_sharpe,
      g.pct_runs_beating_sixty_forty_sharpe
    FROM s
    LEFT JOIN gpt_beat_rates g
      ON g.experiment_id = s.experiment_id
     AND g.strategy_key = s.strategy_key
     AND g.market = s.market
     AND COALESCE(g.prompt_type, '') = COALESCE(s.prompt_type, '')
    ${buildWhereClause(clauses)}
    ORDER BY s.source_type, s.strategy_key, s.market, s.prompt_type
  `, params);
}

function handleRunQuality(url) {
  const { clauses, params } = withExperimentFilters(url, {
    experimentId: "rr.experiment_id",
    market: "rr.market",
    period: "rr.period",
    prompt_type: "rr.prompt_type",
    model: "rr.model",
    failure_type: "rr.failure_type",
    execution_mode: "rr.execution_mode",
  });

  return queryAll(`
    SELECT
      rr.experiment_id,
      rr.market,
      rr.period,
      NULLIF(rr.prompt_type, '') AS prompt_type,
      NULLIF(rr.model, '') AS model,
      rr.failure_type,
      rr.execution_mode,
      COUNT(*) AS row_count,
      SUM(CASE WHEN COALESCE(rr.valid, 0) <> 0 THEN 1 ELSE 0 END) AS valid_rows,
      SUM(CASE WHEN COALESCE(rr.repaired, 0) <> 0 THEN 1 ELSE 0 END) AS repaired_rows,
      AVG(rr.repair_attempts) AS avg_repair_attempts
    FROM llm_run_results rr
    ${buildWhereClause(clauses)}
    GROUP BY
      rr.experiment_id,
      rr.market,
      rr.period,
      rr.prompt_type,
      rr.model,
      rr.failure_type,
      rr.execution_mode
    ORDER BY rr.market, rr.period, rr.prompt_type, rr.model, rr.failure_type, rr.execution_mode
  `, params);
}

function handleEquity(url) {
  const { clauses, params } = withExperimentFilters(url, {
    experimentId: "dpm.experiment_id",
    strategy_key: "p.strategy_key",
    market: "p.market",
    prompt_type: "p.prompt_type",
    model: "p.model",
    path_id: "dpm.path_id",
  });

  addDateRangeFilter(
    clauses,
    params,
    "dpm.date",
    cleanString(url.searchParams.get("date_from")),
    cleanString(url.searchParams.get("date_to"))
  );

  return queryAll(`
    SELECT
      dpm.experiment_id,
      dpm.path_id,
      p.source_type,
      p.strategy_key,
      p.strategy,
      p.market,
      NULLIF(p.prompt_type, '') AS prompt_type,
      NULLIF(p.model, '') AS model,
      NULLIF(p.trajectory_id, '') AS trajectory_id,
      p.run_id,
      dpm.date,
      dpm.period,
      mp.period_start_date,
      mp.period_end_date,
      mp.asof_cutoff_date,
      mp.market_regime_label,
      mp.vol_regime_label,
      mp.rate_regime_label,
      mp.regime_code,
      dpm.portfolio_value,
      dpm.daily_return,
      dpm.running_peak,
      dpm.drawdown,
      dpm.drifted_hhi,
      dpm.drifted_effective_n_holdings,
      dpm.active_holdings,
      dpm.top1_weight,
      dpm.top3_weight,
      dpm.portfolio_size_exposure,
      dpm.portfolio_value_exposure,
      dpm.portfolio_momentum_exposure,
      dpm.portfolio_low_risk_exposure,
      dpm.portfolio_quality_exposure
    FROM daily_path_metrics dpm
    JOIN paths p
      ON p.experiment_id = dpm.experiment_id
     AND p.path_id = dpm.path_id
    JOIN experiments e
      ON e.experiment_id = dpm.experiment_id
    LEFT JOIN market_periods mp
      ON mp.data_snapshot_id = e.data_snapshot_id
     AND mp.market = p.market
     AND mp.period = dpm.period
    ${buildWhereClause(clauses)}
    ORDER BY dpm.path_id, dpm.date
  `, params);
}

function handleFactorExposures(url) {
  const { clauses, params } = withExperimentFilters(url, {
    experimentId: "dpm.experiment_id",
    strategy_key: "p.strategy_key",
    market: "p.market",
    prompt_type: "p.prompt_type",
    model: "p.model",
    path_id: "dpm.path_id",
  });

  addDateRangeFilter(
    clauses,
    params,
    "dpm.date",
    cleanString(url.searchParams.get("date_from")),
    cleanString(url.searchParams.get("date_to"))
  );

  return queryAll(`
    SELECT
      dpm.experiment_id,
      dpm.path_id,
      p.source_type,
      p.strategy_key,
      p.strategy,
      p.market,
      NULLIF(p.prompt_type, '') AS prompt_type,
      NULLIF(p.model, '') AS model,
      NULLIF(p.trajectory_id, '') AS trajectory_id,
      p.run_id,
      dpm.date,
      dpm.period,
      mp.market_regime_label,
      mp.vol_regime_label,
      mp.rate_regime_label,
      mp.regime_code,
      dpm.portfolio_size_exposure,
      dpm.portfolio_value_exposure,
      dpm.portfolio_momentum_exposure,
      dpm.portfolio_low_risk_exposure,
      dpm.portfolio_quality_exposure
    FROM daily_path_metrics dpm
    JOIN paths p
      ON p.experiment_id = dpm.experiment_id
     AND p.path_id = dpm.path_id
    JOIN experiments e
      ON e.experiment_id = dpm.experiment_id
    LEFT JOIN market_periods mp
      ON mp.data_snapshot_id = e.data_snapshot_id
     AND mp.market = p.market
     AND mp.period = dpm.period
    ${buildWhereClause(clauses)}
    ORDER BY dpm.path_id, dpm.date
  `, params);
}

function handleRegimes(url) {
  const { clauses, params } = withExperimentFilters(url, {
    experimentId: "dpm.experiment_id",
    strategy_key: "p.strategy_key",
    market: "p.market",
    prompt_type: "p.prompt_type",
    model: "p.model",
    path_id: "dpm.path_id",
  });

  addDateRangeFilter(
    clauses,
    params,
    "dpm.date",
    cleanString(url.searchParams.get("date_from")),
    cleanString(url.searchParams.get("date_to"))
  );

  return queryAll(`
    SELECT
      dpm.experiment_id,
      dpm.path_id,
      p.source_type,
      p.strategy_key,
      p.strategy,
      p.market,
      NULLIF(p.prompt_type, '') AS prompt_type,
      NULLIF(p.model, '') AS model,
      NULLIF(p.trajectory_id, '') AS trajectory_id,
      p.run_id,
      dpm.date,
      dpm.period,
      mp.period_start_date,
      mp.period_end_date,
      mp.asof_cutoff_date,
      mp.market_regime_label,
      mp.vol_regime_label,
      mp.rate_regime_label,
      mp.regime_code,
      mp.market_regime_changed,
      mp.vol_regime_changed,
      mp.rate_regime_changed,
      mp.any_regime_changed,
      dpm.portfolio_value,
      dpm.daily_return,
      dpm.drawdown
    FROM daily_path_metrics dpm
    JOIN paths p
      ON p.experiment_id = dpm.experiment_id
     AND p.path_id = dpm.path_id
    JOIN experiments e
      ON e.experiment_id = dpm.experiment_id
    LEFT JOIN market_periods mp
      ON mp.data_snapshot_id = e.data_snapshot_id
     AND mp.market = p.market
     AND mp.period = dpm.period
    ${buildWhereClause(clauses)}
    ORDER BY dpm.path_id, dpm.date
  `, params);
}

function handleHoldings(url) {
  const { page, pageSize, limit, offset } = parsePagination(url.searchParams);
  const clauses = ["dh.experiment_id = :experiment_id"];
  const params = {
    experiment_id: resolveExperimentId(url),
  };

  addEqualsFilter(clauses, params, "p.strategy_key", cleanString(url.searchParams.get("strategy_key")), "strategy_key");
  addEqualsFilter(clauses, params, "p.market", cleanString(url.searchParams.get("market")), "market");
  addEqualsFilter(clauses, params, "p.prompt_type", cleanString(url.searchParams.get("prompt_type")), "prompt_type");
  addEqualsFilter(clauses, params, "p.model", cleanString(url.searchParams.get("model")), "model");
  addEqualsFilter(clauses, params, "dh.path_id", cleanString(url.searchParams.get("path_id")), "path_id");
  addEqualsFilter(clauses, params, "dh.period", cleanString(url.searchParams.get("period")), "period");
  addEqualsFilter(clauses, params, "dh.ticker", cleanString(url.searchParams.get("ticker")), "ticker");

  const dateValue = cleanString(url.searchParams.get("date"));
  if (dateValue != null) {
    clauses.push("date(dh.date) = date(:date)");
    params.date = dateValue;
  }

  const fromClause = `
    FROM daily_holdings dh
    JOIN paths p
      ON p.experiment_id = dh.experiment_id
     AND p.path_id = dh.path_id
    JOIN experiments e
      ON e.experiment_id = dh.experiment_id
    LEFT JOIN market_periods mp
      ON mp.data_snapshot_id = e.data_snapshot_id
     AND mp.market = p.market
     AND mp.period = dh.period
    LEFT JOIN instrument_periods ip
      ON ip.data_snapshot_id = e.data_snapshot_id
     AND ip.market = p.market
     AND ip.period = dh.period
     AND ip.ticker = dh.ticker
  `;
  const whereClause = buildWhereClause(clauses);
  const paginationParams = {
    ...params,
    limit,
    offset,
  };
  const totalRow = queryGet(`
    SELECT COUNT(*) AS total_rows
    ${fromClause}
    ${whereClause}
  `, params);

  const items = queryAll(`
    SELECT
      dh.experiment_id,
      dh.path_id,
      p.source_type,
      p.strategy_key,
      p.strategy,
      p.market,
      NULLIF(p.prompt_type, '') AS prompt_type,
      NULLIF(p.model, '') AS model,
      NULLIF(p.trajectory_id, '') AS trajectory_id,
      p.run_id,
      dh.date,
      dh.period,
      mp.period_start_date,
      mp.period_end_date,
      mp.asof_cutoff_date,
      mp.market_regime_label,
      mp.vol_regime_label,
      mp.rate_regime_label,
      mp.regime_code,
      dh.ticker,
      ip.name,
      ip.asset_class,
      ip.sector,
      ip.market_cap,
      ip.pb_ratio,
      ip.roe,
      ip.debt_to_equity,
      ip.trailing_return_6m,
      ip.trailing_vol_6m,
      ip.net_margin_proxy,
      ip.size_rank_pct,
      ip.value_rank_pct,
      ip.momentum_rank_pct,
      ip.low_risk_rank_pct,
      ip.quality_rank_pct,
      ip.size_label,
      ip.value_label,
      ip.momentum_label,
      ip.low_risk_label,
      ip.quality_label,
      dh.close,
      dh.start_close,
      dh.price_relative,
      dh.target_weight,
      dh.effective_weight_period_start,
      dh.drifted_weight,
      dh.weighted_value,
      dh.value_contribution_pct
    ${fromClause}
    ${whereClause}
    ORDER BY dh.date DESC, dh.path_id, dh.value_contribution_pct DESC, dh.ticker
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

  const clauses = ["e.experiment_id = :experiment_id", "dp.ticker = :ticker"];
  const params = {
    experiment_id: resolveExperimentId(url),
    ticker,
  };

  addEqualsFilter(clauses, params, "dp.market", cleanString(url.searchParams.get("market")), "market");
  addEqualsFilter(clauses, params, "dp.period", cleanString(url.searchParams.get("period")), "period");

  return queryAll(`
    SELECT
      e.experiment_id,
      dp.market,
      dp.period,
      dp.date,
      dp.ticker,
      dp.close
    FROM experiments e
    JOIN daily_prices dp
      ON dp.data_snapshot_id = e.data_snapshot_id
    ${buildWhereClause(clauses)}
    ORDER BY dp.date
  `, params);
}

function buildRunResultsSelectList() {
  const ppmColumns = getTableColumns("path_period_metrics");
  const rrColumns = getTableColumns("llm_run_results");
  const rrColumnSet = new Set(rrColumns);
  const ppmColumnSet = new Set(ppmColumns);
  const excluded = new Set([
    "experiment_id",
    "path_id",
    "period",
    "period_return",
    "annualized_return",
    "volatility",
    "historical_var_95",
    "sharpe_ratio",
    "turnover",
    "expected_portfolio_return_6m",
    "forecast_bias",
    "forecast_abs_error",
    "prior_period_return",
    "is_rebalance",
    "post_loss_rebalance",
    "vs_index",
    "vs_sixty_forty",
    "vs_equal_weight",
    "vs_mean_variance",
    "vs_fama_french",
    "risk_free_rate",
    "uses_only_empirical_data",
    "quantitative_flags",
    "volatility_method",
    "market",
    "prompt_type",
    "model",
    "trajectory_id",
    "run_id",
    "source_type",
    "strategy_key",
    "strategy",
    "market_regime_label",
    "vol_regime_label",
    "rate_regime_label",
    "regime_code",
    "n_holdings",
    "hhi",
    "effective_n_holdings",
  ]);

  const selectParts = buildAliasedSelectList("ppm", ppmColumns);
  selectParts.push(
    ...buildAliasedSelectList(
      "rr",
      rrColumns,
      new Set([...excluded, ...ppmColumns.filter((column) => ppmColumnSet.has(column))])
    )
  );
  selectParts.push(
    "p.source_type AS source_type",
    "p.strategy_key AS strategy_key",
    "p.strategy AS strategy",
    "p.market AS market",
    "NULLIF(p.prompt_type, '') AS prompt_type",
    "NULLIF(p.model, '') AS model",
    "NULLIF(p.trajectory_id, '') AS trajectory_id",
    "p.run_id AS run_id",
    "mp.market_regime_label AS market_regime_label",
    "mp.vol_regime_label AS vol_regime_label",
    "mp.rate_regime_label AS rate_regime_label",
    "mp.regime_code AS regime_code",
    rrColumnSet.has("n_holdings")
      ? "COALESCE(rr.n_holdings, holdings.n_holdings) AS n_holdings"
      : "holdings.n_holdings AS n_holdings",
    rrColumnSet.has("hhi")
      ? "COALESCE(rr.hhi, holdings.hhi) AS hhi"
      : "holdings.hhi AS hhi",
    rrColumnSet.has("effective_n_holdings")
      ? "COALESCE(rr.effective_n_holdings, holdings.effective_n_holdings) AS effective_n_holdings"
      : "holdings.effective_n_holdings AS effective_n_holdings"
  );

  return selectParts.join(",\n      ");
}

function handleRunResults(url) {
  const { page, pageSize, limit, offset } = parsePagination(url.searchParams);
  const clauses = ["ppm.experiment_id = :experiment_id"];
  const params = {
    experiment_id: resolveExperimentId(url),
  };

  addEqualsFilter(clauses, params, "p.market", cleanString(url.searchParams.get("market")), "market");
  addEqualsFilter(clauses, params, "ppm.period", cleanString(url.searchParams.get("period")), "period");
  addEqualsFilter(clauses, params, "p.prompt_type", cleanString(url.searchParams.get("prompt_type")), "prompt_type");
  addEqualsFilter(clauses, params, "p.model", cleanString(url.searchParams.get("model")), "model");
  addEqualsFilter(clauses, params, "p.strategy_key", cleanString(url.searchParams.get("strategy_key")), "strategy_key");
  addEqualsFilter(clauses, params, "rr.failure_type", cleanString(url.searchParams.get("failure_type")), "failure_type");
  addEqualsFilter(clauses, params, "rr.execution_mode", cleanString(url.searchParams.get("execution_mode")), "execution_mode");

  const validFlag = cleanBooleanFlag(url.searchParams.get("valid"));
  addEqualsFilter(clauses, params, "rr.valid", validFlag, "valid");

  const fromClause = `
    FROM path_period_metrics ppm
    JOIN paths p
      ON p.experiment_id = ppm.experiment_id
     AND p.path_id = ppm.path_id
    JOIN experiments e
      ON e.experiment_id = ppm.experiment_id
    LEFT JOIN market_periods mp
      ON mp.data_snapshot_id = e.data_snapshot_id
     AND mp.market = p.market
     AND mp.period = ppm.period
    LEFT JOIN llm_run_results rr
      ON rr.experiment_id = ppm.experiment_id
     AND rr.path_id = ppm.path_id
     AND rr.period = ppm.period
    LEFT JOIN (
      SELECT
        base.experiment_id,
        base.path_id,
        base.period,
        COUNT(*) AS n_holdings,
        SUM(base.weight_basis * base.weight_basis) AS hhi,
        CASE
          WHEN SUM(base.weight_basis * base.weight_basis) > 0
            THEN 1.0 / SUM(base.weight_basis * base.weight_basis)
          ELSE NULL
        END AS effective_n_holdings
      FROM (
        SELECT
          experiment_id,
          path_id,
          period,
          COALESCE(target_weight, effective_weight_period_start, 0.0) AS weight_basis
        FROM decision_holdings
      ) base
      GROUP BY base.experiment_id, base.path_id, base.period
    ) holdings
      ON holdings.experiment_id = ppm.experiment_id
     AND holdings.path_id = ppm.path_id
     AND holdings.period = ppm.period
  `;
  const whereClause = buildWhereClause(clauses);
  const paginationParams = {
    ...params,
    limit,
    offset,
  };
  const totalRow = queryGet(`
    SELECT COUNT(*) AS total_rows
    ${fromClause}
    ${whereClause}
  `, params);

  const items = queryAll(`
    SELECT
      ${buildRunResultsSelectList()}
    ${fromClause}
    ${whereClause}
    ORDER BY market, ppm.period, prompt_type, model, run_id
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
  const clauses = ["e.experiment_id = :experiment_id"];
  const params = {
    experiment_id: resolveExperimentId(url),
  };

  addEqualsFilter(clauses, params, "mp.market", cleanString(url.searchParams.get("market")), "market");

  return queryAll(`
    SELECT
      e.experiment_id,
      mp.market,
      mp.period,
      mp.period_start_date,
      mp.period_end_date,
      mp.asof_cutoff_date,
      mp.period_order,
      mp.market_regime_label,
      mp.vol_regime_label,
      mp.rate_regime_label,
      mp.regime_code,
      mp.market_regime_order,
      mp.vol_regime_order,
      mp.rate_regime_order,
      mp.market_regime_changed,
      mp.vol_regime_changed,
      mp.rate_regime_changed,
      mp.any_regime_changed
    FROM experiments e
    JOIN market_periods mp
      ON mp.data_snapshot_id = e.data_snapshot_id
    ${buildWhereClause(clauses)}
    ORDER BY mp.market, mp.period_order
  `, params);
}

const routes = new Map([
  ["GET /api/health", () => handleHealth()],
  ["GET /api/meta/current", () => handleMetaCurrent()],
  ["GET /api/filters", ({ url }) => handleFilters(url)],
  ["GET /api/summary/strategies", ({ url }) => handleStrategySummary(url)],
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

    const payload = handler({ request, response, url });
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
