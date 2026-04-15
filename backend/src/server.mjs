import http from "node:http";
import { execFileSync } from "node:child_process";
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
import {
  buildBehaviorHoldingsSummary,
  buildFactorSelectionSummary,
  getFactorLabelField,
} from "./summary-builders.mjs";

function json(response, statusCode, payload, extraHeaders = {}) {
  if (response.writableEnded || response.destroyed) {
    return;
  }

  const body = JSON.stringify(payload);
  if (response.writableEnded || response.destroyed) {
    return;
  }

  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
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
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
}

function readJsonBody(request, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(createHttpError(413, "Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          resolve(null);
          return;
        }
        resolve(JSON.parse(raw));
      } catch (e) {
        if (e instanceof SyntaxError) {
          reject(createHttpError(400, "Invalid JSON body"));
        } else {
          reject(e);
        }
      }
    });
    request.on("error", (err) => reject(err));
  });
}

function normalizePromptTypeValue(value) {
  const normalized = cleanString(value)?.toLowerCase() ?? null;
  if (normalized == null) {
    return null;
  }
  return normalized === "retail" ? "simple" : normalized;
}

function normalizeStrategyKeyValue(value) {
  const normalized = cleanString(value)?.toLowerCase().replace(/-/g, "_") ?? null;
  if (normalized == null) {
    return null;
  }
  return normalized === "gpt_retail" ? "gpt_simple" : normalized;
}

function normalizedPromptTypeSql(columnExpression) {
  return `CASE
    WHEN LOWER(TRIM(COALESCE(${columnExpression}, ''))) = 'retail' THEN 'simple'
    ELSE NULLIF(LOWER(TRIM(COALESCE(${columnExpression}, ''))), '')
  END`;
}

function normalizedStrategyKeySql(columnExpression) {
  return `CASE
    WHEN LOWER(TRIM(COALESCE(${columnExpression}, ''))) = 'gpt_retail' THEN 'gpt_simple'
    ELSE NULLIF(LOWER(TRIM(COALESCE(${columnExpression}, ''))), '')
  END`;
}

function gptPromptTypeFilterSql(columnExpression) {
  return `${normalizedPromptTypeSql(columnExpression)} IN ('simple', 'advanced')`;
}

function gptStrategyKeyFilterSql(columnExpression) {
  return `${normalizedStrategyKeySql(columnExpression)} IN ('gpt_simple', 'gpt_advanced')`;
}

const TIME_SERIES_CACHE_TTL_MS = 10 * 60 * 1000;
const timeSeriesCache = new Map();

function toSqliteLiteral(value) {
  if (value == null) {
    return "NULL";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot inline non-finite SQLite numeric value: ${value}`);
    }
    return String(value);
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}

function inlineSqlParams(sql, params) {
  return sql.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      throw new Error(`Missing SQLite parameter: ${key}`);
    }
    return toSqliteLiteral(params[key]);
  });
}

function queryTimeSeriesRows(sql, params, valueField) {
  try {
    const output = execFileSync(
      process.env.SQLITE3_BIN?.trim() || "/usr/bin/sqlite3",
      ["-separator", "\t", SQLITE_DB_PATH, inlineSqlParams(sql, params)],
      {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 32 * 1024 * 1024,
      }
    );

    const trimmed = output.trim();
    if (!trimmed) {
      return [];
    }

    return trimmed.split("\n").map((line) => {
      const [date, strategy_key, strategyRaw, valueRaw, pathCountRaw] = line.split("\t");
      const value =
        valueRaw == null || valueRaw === ""
          ? null
          : Number(valueRaw);
      const pathCount = pathCountRaw == null || pathCountRaw === ""
        ? 0
        : Number(pathCountRaw);

      return {
        date,
        strategy_key,
        strategy: strategyRaw == null || strategyRaw === "" ? null : strategyRaw,
        [valueField]:
          value != null && Number.isFinite(value)
            ? value
            : null,
        path_count: Number.isFinite(pathCount) ? pathCount : 0,
      };
    });
  } catch {
    return queryAll(sql, params);
  }
}

async function handlePostFactorStyleAnalysis(request, response) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    json(response, 503, {
      error: "openai_not_configured",
      message:
        "Set OPENAI_API_KEY on this API server to enable factor-style AI analysis (see backend README).",
    });
    return;
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") {
    json(response, 400, { error: "bad_request", message: "Expected JSON body" });
    return;
  }

  const experimentId =
    typeof body.experiment_id === "string" ? body.experiment_id.trim() : "";
  const marketScope =
    typeof body.market_scope === "string" ? body.market_scope : "All";
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!experimentId || !rows || rows.length === 0) {
    json(response, 400, {
      error: "bad_request",
      message: "Body must include experiment_id and non-empty rows[]",
    });
    return;
  }

  const maxRows = 64;
  const slice = rows.slice(0, maxRows);

  const model =
    process.env.OPENAI_MODEL?.trim() ||
    process.env.FACTOR_ANALYSIS_MODEL?.trim() ||
    "gpt-4o";

  const glossary =
    body.glossary && typeof body.glossary === "object" ? body.glossary : {};
  const factorDefs =
    typeof body.factor_definitions === "string"
      ? body.factor_definitions
      : "Size, value, momentum, low risk, and quality are portfolio style exposures from the backtest pipeline (typically 0–1 scale).";

  const userPayload = {
    experiment_id: experimentId,
    market_scope: marketScope,
    rows: slice,
    strategy_glossary: glossary,
    factor_definitions: factorDefs,
  };

  const system = `You are helping interpret an academic empirical-finance backtest dashboard. Focus first on the GPT prompt portfolios (gpt_simple and gpt_advanced): explain what factor strategies they appear to be following, compare them with benchmarks, and discuss how much those tilts may plausibly explain return differences. Be explicit that this is suggestive interpretation, not causal attribution or investment advice. Use Markdown with ## headings and stay under 900 words.`;

  const user = `Analyze the following factor-exposure summary JSON. Use strategy_glossary to explain what each strategy_key represents, but prioritize the GPT prompt portfolios. Answer the question: "What factor strategies are the GPT models following, and how much might that explain their returns?" Distinguish clearly between plausible explanation and proven cause.\n\n${JSON.stringify(userPayload, null, 2)}`;

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 2200,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const rawText = await openaiRes.text();
  if (!openaiRes.ok) {
    let msg = `OpenAI request failed (${openaiRes.status})`;
    try {
      const err = JSON.parse(rawText);
      if (err.error?.message) {
        msg = err.error.message;
      }
    } catch {
      // ignore
    }
    json(response, 502, { error: "openai_error", message: msg });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    json(response, 502, { error: "openai_error", message: "Invalid JSON from OpenAI" });
    return;
  }

  const text = parsed.choices?.[0]?.message?.content?.trim();
  if (!text) {
    json(response, 502, { error: "openai_error", message: "Empty model response" });
    return;
  }

  json(response, 200, { analysis: text, model });
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

    let value = cleanString(url.searchParams.get(queryParam));
    if (queryParam === "prompt_type") {
      value = normalizePromptTypeValue(value);
    } else if (queryParam === "strategy_key") {
      value = normalizeStrategyKeyValue(value);
    }
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
        ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
        p.strategy,
        p.source_type,
        ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type
      FROM paths p
      WHERE p.experiment_id = :experiment_id
      ORDER BY p.source_type, strategy_key, p.strategy, prompt_type
    `, { experiment_id: experimentId }),
    available_prompt_types: rowsToValues(
      queryAll(`
        SELECT DISTINCT ${normalizedPromptTypeSql("prompt_type")} AS prompt_type
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
        SELECT DISTINCT ${normalizedStrategyKeySql("strategy_key")} AS strategy_key
        FROM paths
        WHERE experiment_id = :experiment_id
        ORDER BY strategy_key
      `, { experiment_id: experimentId }),
      "strategy_key"
    ),
    prompt_types: rowsToValues(
      queryAll(`
        SELECT DISTINCT ${normalizedPromptTypeSql("prompt_type")} AS prompt_type
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
    normalizeStrategyKeyValue(url.searchParams.get("strategy_key")),
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
    normalizePromptTypeValue(url.searchParams.get("prompt_type")),
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
        ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
        p.market,
        ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
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
        AND ${gptStrategyKeyFilterSql("p.strategy_key")}
      GROUP BY
        ppm.experiment_id,
        ${normalizedStrategyKeySql("p.strategy_key")},
        p.market,
        ${normalizedPromptTypeSql("p.prompt_type")}
    ),
    s AS (
      SELECT
        ppm.experiment_id,
        p.source_type,
        ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
        p.strategy,
        p.market,
        ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
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
        ${normalizedStrategyKeySql("p.strategy_key")},
        p.strategy,
        p.market,
        ${normalizedPromptTypeSql("p.prompt_type")}
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

function handleFactorStyleSummary(url) {
  const experimentId = resolveExperimentId(url);
  const clauses = ["dpm.experiment_id = :experiment_id"];
  const params = { experiment_id: experimentId };

  addEqualsFilter(clauses, params, "p.market", cleanString(url.searchParams.get("market")), "market");

  const whereClause = buildWhereClause(clauses);

  return queryAll(
    `
    WITH path_means AS (
      SELECT
        dpm.path_id,
        ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
        p.strategy,
        ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
        p.market,
        AVG(dpm.portfolio_size_exposure) AS avg_size,
        AVG(dpm.portfolio_value_exposure) AS avg_value,
        AVG(dpm.portfolio_momentum_exposure) AS avg_momentum,
        AVG(dpm.portfolio_low_risk_exposure) AS avg_low_risk,
        AVG(dpm.portfolio_quality_exposure) AS avg_quality
      FROM daily_path_metrics dpm
      JOIN paths p
        ON p.experiment_id = dpm.experiment_id
       AND p.path_id = dpm.path_id
      ${whereClause}
      GROUP BY dpm.path_id, strategy_key, p.strategy, prompt_type, p.market
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

function handleCumulativeReturnSummary(url) {
  const cacheKey = url.toString();
  const cached = timeSeriesCache.get(cacheKey);
  if (
    cached &&
    Date.now() - cached.createdAt <= TIME_SERIES_CACHE_TTL_MS
  ) {
    return cached.rows;
  }

  const clauses = ["vcr.experiment_id = :experiment_id"];
  const params = {
    experiment_id: resolveExperimentId(url),
  };

  addEqualsFilter(
    clauses,
    params,
    normalizedStrategyKeySql("vcr.strategy_key"),
    normalizeStrategyKeyValue(url.searchParams.get("strategy_key")),
    "strategy_key"
  );
  addEqualsFilter(
    clauses,
    params,
    "vcr.market",
    cleanString(url.searchParams.get("market")),
    "market"
  );
  addEqualsFilter(
    clauses,
    params,
    normalizedPromptTypeSql("vcr.prompt_type"),
    normalizePromptTypeValue(url.searchParams.get("prompt_type")),
    "prompt_type"
  );

  addDateRangeFilter(
    clauses,
    params,
    "vcr.date",
    cleanString(url.searchParams.get("date_from")),
    cleanString(url.searchParams.get("date_to"))
  );

  const whereClause = buildWhereClause(clauses);

  const sql = `
    SELECT
      vcr.date,
      ${normalizedStrategyKeySql("vcr.strategy_key")} AS strategy_key,
      MIN(NULLIF(TRIM(COALESCE(vcr.strategy, '')), '')) AS strategy,
      SUM(vcr.mean_cumulative_return * COALESCE(vcr.path_count, 0)) * 1.0
        / NULLIF(SUM(COALESCE(vcr.path_count, 0)), 0) AS mean_cumulative_return,
      SUM(COALESCE(vcr.path_count, 0)) AS path_count
    FROM vw_strategy_cumulative_return_daily vcr
    ${whereClause}
    GROUP BY
      vcr.date,
      ${normalizedStrategyKeySql("vcr.strategy_key")}
    ORDER BY
      vcr.date,
      strategy_key
  `;

  const rows = queryTimeSeriesRows(sql, params, "mean_cumulative_return");
  const result = rows.map((row) => ({
    date: row.date,
    strategy_key: normalizeStrategyKeyValue(row.strategy_key) ?? row.strategy_key,
    strategy: row.strategy ?? null,
    mean_cumulative_return:
      typeof row.mean_cumulative_return === "number" &&
      Number.isFinite(row.mean_cumulative_return)
        ? row.mean_cumulative_return
        : null,
    path_count:
      typeof row.path_count === "number" && Number.isFinite(row.path_count)
        ? row.path_count
        : 0,
  }));

  timeSeriesCache.set(cacheKey, {
    createdAt: Date.now(),
    rows: result,
  });

  return result;
}

function handleRunQuality(url) {
  const { clauses, params } = withExperimentFilters(url, {
    experimentId: "rr.experiment_id",
    market: "rr.market",
    period: "rr.period",
    prompt_type: normalizedPromptTypeSql("rr.prompt_type"),
    model: "rr.model",
    failure_type: "rr.failure_type",
    execution_mode: "rr.execution_mode",
  });

  return queryAll(`
    SELECT
      rr.experiment_id,
      rr.market,
      rr.period,
      ${normalizedPromptTypeSql("rr.prompt_type")} AS prompt_type,
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
      prompt_type,
      rr.model,
      rr.failure_type,
      rr.execution_mode
    ORDER BY rr.market, rr.period, prompt_type, rr.model, rr.failure_type, rr.execution_mode
  `, params);
}

function handleOverviewSummary(url) {
  const experimentId = resolveExperimentId(url);

  return (
    queryGet(
      `
      WITH benchmark_sharpes AS (
        SELECT
          p.market,
          AVG(ppm.sharpe_ratio) AS mean_sharpe
        FROM path_period_metrics ppm
        JOIN paths p
          ON p.experiment_id = ppm.experiment_id
         AND p.path_id = ppm.path_id
        WHERE ppm.experiment_id = :experiment_id
          AND p.strategy_key = 'index'
        GROUP BY p.market
      ),
      rr_dedup AS (
        SELECT
          experiment_id,
          path_id,
          period,
          MAX(valid) AS valid,
          AVG(hhi) AS hhi
        FROM llm_run_results
        WHERE experiment_id = :experiment_id
        GROUP BY experiment_id, path_id, period
      ),
      holdings AS (
        SELECT
          base.experiment_id,
          base.path_id,
          base.period,
          SUM(base.weight_basis * base.weight_basis) AS hhi
        FROM (
          SELECT
            experiment_id,
            path_id,
            period,
            COALESCE(target_weight, effective_weight_period_start, 0.0) AS weight_basis
          FROM decision_holdings
          WHERE experiment_id = :experiment_id
        ) base
        GROUP BY base.experiment_id, base.path_id, base.period
      )
      SELECT
        COUNT(*) AS total_runs,
        SUM(CASE WHEN COALESCE(rr.valid, 0) <> 0 THEN 1 ELSE 0 END) AS valid_runs,
        COUNT(DISTINCT p.market) AS market_count,
        COUNT(DISTINCT ppm.period) AS period_count,
        AVG(
          CASE
            WHEN ${gptPromptTypeFilterSql("p.prompt_type")}
              AND idx.mean_sharpe IS NOT NULL
              AND ppm.sharpe_ratio IS NOT NULL
            THEN CASE WHEN ppm.sharpe_ratio > idx.mean_sharpe THEN 100.0 ELSE 0.0 END
            ELSE NULL
          END
        ) AS gpt_beat_index_rate,
        AVG(
          CASE
            WHEN ${gptPromptTypeFilterSql("p.prompt_type")}
            THEN COALESCE(rr.hhi, holdings.hhi)
            ELSE NULL
          END
        ) AS mean_gpt_hhi
      FROM path_period_metrics ppm
      JOIN paths p
        ON p.experiment_id = ppm.experiment_id
       AND p.path_id = ppm.path_id
      LEFT JOIN rr_dedup rr
        ON rr.experiment_id = ppm.experiment_id
       AND rr.path_id = ppm.path_id
       AND rr.period = ppm.period
      LEFT JOIN holdings
        ON holdings.experiment_id = ppm.experiment_id
       AND holdings.path_id = ppm.path_id
       AND holdings.period = ppm.period
      LEFT JOIN benchmark_sharpes idx
        ON idx.market = p.market
      WHERE ppm.experiment_id = :experiment_id
    `,
      { experiment_id: experimentId }
    ) ?? {
      total_runs: 0,
      valid_runs: 0,
      market_count: 0,
      period_count: 0,
      gpt_beat_index_rate: null,
      mean_gpt_hhi: null,
    }
  );
}

function handleBehaviorSummary(url) {
  const experimentId = resolveExperimentId(url);
  const rows = queryAll(
    `
    WITH rr_dedup AS (
      SELECT
        experiment_id,
        path_id,
        period,
        MAX(valid) AS valid,
        AVG(hhi) AS hhi,
        AVG(effective_n_holdings) AS effective_n_holdings
      FROM llm_run_results
      WHERE experiment_id = :experiment_id
      GROUP BY experiment_id, path_id, period
    ),
    holdings AS (
      SELECT
        base.experiment_id,
        base.path_id,
        base.period,
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
        WHERE experiment_id = :experiment_id
      ) base
      GROUP BY base.experiment_id, base.path_id, base.period
    )
    SELECT
      ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
      COALESCE(rr_dedup.hhi, holdings.hhi) AS hhi,
      COALESCE(rr_dedup.effective_n_holdings, holdings.effective_n_holdings) AS effective_n_holdings,
      ppm.turnover,
      ppm.expected_portfolio_return_6m,
      ppm.period_return AS realized_return,
      ppm.forecast_bias,
      ppm.forecast_abs_error
    FROM path_period_metrics ppm
    JOIN paths p
      ON p.experiment_id = ppm.experiment_id
     AND p.path_id = ppm.path_id
    LEFT JOIN rr_dedup
      ON rr_dedup.experiment_id = ppm.experiment_id
     AND rr_dedup.path_id = ppm.path_id
     AND rr_dedup.period = ppm.period
    LEFT JOIN holdings
      ON holdings.experiment_id = ppm.experiment_id
     AND holdings.path_id = ppm.path_id
     AND holdings.period = ppm.period
    WHERE ppm.experiment_id = :experiment_id
      AND ${gptPromptTypeFilterSql("p.prompt_type")}
  `,
    { experiment_id: experimentId }
  );

  const mean = (values) =>
    values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  const median = (values) => {
    if (values.length === 0) {
      return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  return ["simple", "advanced"]
    .map((promptType) => {
      const promptRows = rows.filter((row) => row.prompt_type === promptType);
      if (promptRows.length === 0) {
        return null;
      }

      const hhi = promptRows
        .map((row) => row.hhi)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      const effectiveHoldings = promptRows
        .map((row) => row.effective_n_holdings)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      const turnover = promptRows
        .map((row) => row.turnover)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      const expectedReturn = promptRows
        .map((row) => row.expected_portfolio_return_6m)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      const realizedReturn = promptRows
        .map((row) => row.realized_return)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      const forecastBias = promptRows
        .map((row) => row.forecast_bias)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      const forecastAbsError = promptRows
        .map((row) => row.forecast_abs_error)
        .filter((value) => typeof value === "number" && Number.isFinite(value));

      return {
        prompt_type: promptType,
        mean_hhi: mean(hhi),
        mean_effective_n_holdings: mean(effectiveHoldings),
        mean_turnover: mean(turnover),
        median_turnover: median(turnover),
        mean_expected_portfolio_return_6m: mean(expectedReturn),
        mean_realized_net_return: mean(realizedReturn),
        mean_forecast_bias: mean(forecastBias),
        mean_forecast_abs_error: mean(forecastAbsError),
      };
    })
    .filter(Boolean);
}

function handleFactorSelectionSummary(url) {
  const experimentId = resolveExperimentId(url);
  const market = cleanString(url.searchParams.get("market"));
  const factorKey = cleanString(url.searchParams.get("factor_key")) ?? "value";
  const factorField = getFactorLabelField(factorKey);

  if (!factorField) {
    throw createHttpError(400, `Unsupported factor_key: ${factorKey}`);
  }

  const holdingClauses = [
    "dh.experiment_id = :experiment_id",
    gptStrategyKeyFilterSql("p.strategy_key"),
  ];
  const holdingParams = { experiment_id: experimentId };
  addEqualsFilter(holdingClauses, holdingParams, "p.market", market, "market");

  const runClauses = [
    "ppm.experiment_id = :experiment_id",
    gptStrategyKeyFilterSql("p.strategy_key"),
  ];
  const runParams = { experiment_id: experimentId };
  addEqualsFilter(runClauses, runParams, "p.market", market, "market");

  const holdingsRows = queryAll(
    `
    SELECT
      ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
      ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
      NULLIF(p.model, '') AS model,
      NULLIF(p.trajectory_id, '') AS trajectory_id,
      p.run_id,
      dh.path_id,
      p.market,
      dh.date,
      dh.period,
      dh.size_label,
      dh.value_label,
      dh.momentum_label,
      dh.low_risk_label,
      dh.quality_label
    FROM daily_holdings dh
    JOIN paths p
      ON p.experiment_id = dh.experiment_id
     AND p.path_id = dh.path_id
    ${buildWhereClause(holdingClauses)}
    ORDER BY p.strategy_key, dh.date, dh.path_id
  `,
    holdingParams
  );

  const outcomeRows = queryAll(
    `
    SELECT
      ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
      ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
      NULLIF(p.model, '') AS model,
      CASE
        WHEN p.run_id IS NOT NULL AND TRIM(CAST(p.run_id AS TEXT)) <> ''
          THEN 'run:' || CAST(p.run_id AS TEXT)
        WHEN ppm.path_id IS NOT NULL AND TRIM(CAST(ppm.path_id AS TEXT)) <> ''
          THEN 'path:' || CAST(ppm.path_id AS TEXT)
        WHEN NULLIF(p.trajectory_id, '') IS NOT NULL
          THEN 'trajectory:' || p.trajectory_id
        ELSE ${normalizedStrategyKeySql("p.strategy_key")} || '::' || p.market || '::' || COALESCE(${normalizedPromptTypeSql("p.prompt_type")}, 'unknown-prompt') || '::' || COALESCE(NULLIF(p.model, ''), 'unknown-model')
      END AS run_key,
      AVG(ppm.sharpe_ratio) AS mean_sharpe,
      AVG(ppm.period_return) AS mean_return
    FROM path_period_metrics ppm
    JOIN paths p
      ON p.experiment_id = ppm.experiment_id
     AND p.path_id = ppm.path_id
    ${buildWhereClause(runClauses)}
    GROUP BY
      strategy_key,
      prompt_type,
      NULLIF(p.model, ''),
      run_key
  `,
    runParams
  );

  const regimeRows = queryAll(
    `
    SELECT DISTINCT
      mp.market,
      mp.period,
      mp.period_start_date,
      mp.period_end_date,
      mp.market_regime_label,
      mp.vol_regime_label,
      mp.rate_regime_label
    FROM experiments e
    JOIN market_periods mp
      ON mp.data_snapshot_id = e.data_snapshot_id
    WHERE e.experiment_id = :experiment_id
      ${market ? "AND mp.market = :market" : ""}
    ORDER BY mp.period_start_date, mp.market, mp.period
  `,
    market ? { experiment_id: experimentId, market } : { experiment_id: experimentId }
  );

  return buildFactorSelectionSummary({
    holdingsRows,
    outcomeRows,
    regimeRows,
    factorKey,
  });
}

function handleBehaviorHoldingsSummary(url) {
  const experimentId = resolveExperimentId(url);
  const market = cleanString(url.searchParams.get("market"));
  const model = cleanString(url.searchParams.get("model"));

  const holdingClauses = [
    "dh.experiment_id = :experiment_id",
    gptPromptTypeFilterSql("p.prompt_type"),
  ];
  const holdingParams = { experiment_id: experimentId };
  addEqualsFilter(holdingClauses, holdingParams, "p.market", market, "market");
  addEqualsFilter(holdingClauses, holdingParams, "p.model", model, "model");

  const runClauses = [
    "ppm.experiment_id = :experiment_id",
    gptPromptTypeFilterSql("p.prompt_type"),
  ];
  const runParams = { experiment_id: experimentId };
  addEqualsFilter(runClauses, runParams, "p.market", market, "market");
  addEqualsFilter(runClauses, runParams, "p.model", model, "model");

  const holdingsRows = queryAll(
    `
    SELECT
      ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
      ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
      NULLIF(p.model, '') AS model,
      NULLIF(p.trajectory_id, '') AS trajectory_id,
      p.run_id,
      dh.path_id,
      p.market,
      dh.period,
      dh.ticker,
      ip.name,
      ip.sector
    FROM daily_holdings dh
    JOIN paths p
      ON p.experiment_id = dh.experiment_id
     AND p.path_id = dh.path_id
    JOIN experiments e
      ON e.experiment_id = dh.experiment_id
    LEFT JOIN instrument_periods ip
      ON ip.data_snapshot_id = e.data_snapshot_id
     AND ip.market = p.market
     AND ip.period = dh.period
     AND ip.ticker = dh.ticker
    ${buildWhereClause(holdingClauses)}
  `,
    holdingParams
  );

  const runRows = queryAll(
    `
    SELECT
      ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
      p.market,
      ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
      NULLIF(p.model, '') AS model,
      NULLIF(p.trajectory_id, '') AS trajectory_id,
      p.run_id,
      ppm.path_id,
      ppm.period
    FROM path_period_metrics ppm
    JOIN paths p
      ON p.experiment_id = ppm.experiment_id
     AND p.path_id = ppm.path_id
    ${buildWhereClause(runClauses)}
  `,
    runParams
  );

  return buildBehaviorHoldingsSummary({
    holdingsRows,
    runRows,
  });
}

function handleEquity(url) {
  const { clauses, params } = withExperimentFilters(url, {
    experimentId: "dpm.experiment_id",
    strategy_key: normalizedStrategyKeySql("p.strategy_key"),
    market: "p.market",
    prompt_type: normalizedPromptTypeSql("p.prompt_type"),
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
      ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
      p.strategy,
      p.market,
      ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
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
    strategy_key: normalizedStrategyKeySql("p.strategy_key"),
    market: "p.market",
    prompt_type: normalizedPromptTypeSql("p.prompt_type"),
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
      ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
      p.strategy,
      p.market,
      ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
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
    strategy_key: normalizedStrategyKeySql("p.strategy_key"),
    market: "p.market",
    prompt_type: normalizedPromptTypeSql("p.prompt_type"),
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
      ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
      p.strategy,
      p.market,
      ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
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

  addEqualsFilter(clauses, params, normalizedStrategyKeySql("p.strategy_key"), normalizeStrategyKeyValue(url.searchParams.get("strategy_key")), "strategy_key");
  addEqualsFilter(clauses, params, "p.market", cleanString(url.searchParams.get("market")), "market");
  addEqualsFilter(clauses, params, normalizedPromptTypeSql("p.prompt_type"), normalizePromptTypeValue(url.searchParams.get("prompt_type")), "prompt_type");
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
      ${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key,
      p.strategy,
      p.market,
      ${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type,
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
  const rrColumns = getTableColumns("llm_run_results");
  const rrColumnSet = new Set(rrColumns);
  const excluded = new Set([
    "experiment_id",
    "path_id",
    "period",
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

  const selectParts = buildAliasedSelectList("rr", rrColumns, excluded);
  const textColumn = (column, fallbackSql) =>
    rrColumnSet.has(column)
      ? `COALESCE(NULLIF(rr.${column}, ''), ${fallbackSql}) AS ${column}`
      : `${fallbackSql} AS ${column}`;
  const scalarColumn = (column, fallbackSql) =>
    rrColumnSet.has(column)
      ? `COALESCE(rr.${column}, ${fallbackSql}) AS ${column}`
      : `${fallbackSql} AS ${column}`;

  selectParts.push(
    "rr.experiment_id AS experiment_id",
    "rr.path_id AS path_id",
    "rr.period AS period",
    "p.source_type AS source_type",
    `${normalizedStrategyKeySql("p.strategy_key")} AS strategy_key`,
    "p.strategy AS strategy",
    textColumn("market", "p.market"),
    `${normalizedPromptTypeSql("p.prompt_type")} AS prompt_type`,
    textColumn("model", "NULLIF(p.model, '')"),
    textColumn("trajectory_id", "NULLIF(p.trajectory_id, '')"),
    rrColumnSet.has("run_id")
      ? "COALESCE(rr.run_id, p.run_id) AS run_id"
      : "p.run_id AS run_id",
    textColumn("market_regime_label", "mp.market_regime_label"),
    textColumn("vol_regime_label", "mp.vol_regime_label"),
    textColumn("rate_regime_label", "mp.rate_regime_label"),
    textColumn("regime_code", "mp.regime_code"),
    scalarColumn("n_holdings", "NULL"),
    scalarColumn("hhi", "NULL"),
    scalarColumn("effective_n_holdings", "NULL")
  );

  return selectParts.join(",\n      ");
}

function handleRunResults(url) {
  const rrColumnSet = new Set(getTableColumns("llm_run_results"));
  const { page, pageSize, limit, offset } = parsePagination(url.searchParams);
  const clauses = ["rr.experiment_id = :experiment_id"];
  const params = {
    experiment_id: resolveExperimentId(url),
  };

  const marketColumn = rrColumnSet.has("market") ? "rr.market" : "p.market";
  const promptTypeColumn = rrColumnSet.has("prompt_type")
    ? normalizedPromptTypeSql("rr.prompt_type")
    : normalizedPromptTypeSql("p.prompt_type");
  const modelColumn = rrColumnSet.has("model") ? "rr.model" : "p.model";
  const strategyKeyColumn = rrColumnSet.has("strategy_key")
    ? normalizedStrategyKeySql("rr.strategy_key")
    : normalizedStrategyKeySql("p.strategy_key");

  addEqualsFilter(clauses, params, marketColumn, cleanString(url.searchParams.get("market")), "market");
  addEqualsFilter(clauses, params, "rr.period", cleanString(url.searchParams.get("period")), "period");
  addEqualsFilter(clauses, params, promptTypeColumn, normalizePromptTypeValue(url.searchParams.get("prompt_type")), "prompt_type");
  addEqualsFilter(clauses, params, modelColumn, cleanString(url.searchParams.get("model")), "model");
  addEqualsFilter(clauses, params, strategyKeyColumn, normalizeStrategyKeyValue(url.searchParams.get("strategy_key")), "strategy_key");
  addEqualsFilter(clauses, params, "rr.failure_type", cleanString(url.searchParams.get("failure_type")), "failure_type");
  addEqualsFilter(clauses, params, "rr.execution_mode", cleanString(url.searchParams.get("execution_mode")), "execution_mode");

  const validFlag = cleanBooleanFlag(url.searchParams.get("valid"));
  addEqualsFilter(clauses, params, "rr.valid", validFlag, "valid");

  const fromClause = `
    FROM llm_run_results rr
    JOIN paths p
      ON p.experiment_id = rr.experiment_id
     AND p.path_id = rr.path_id
    JOIN experiments e
      ON e.experiment_id = rr.experiment_id
    LEFT JOIN market_periods mp
      ON mp.data_snapshot_id = e.data_snapshot_id
     AND mp.market = p.market
     AND mp.period = rr.period
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
    ORDER BY market, rr.period, prompt_type, model, run_id
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
  ["GET /api/summary/overview", ({ url }) => handleOverviewSummary(url)],
  ["GET /api/summary/daily-sharpe", ({ url }) => handleCumulativeReturnSummary(url)],
  ["GET /api/summary/cumulative-return", ({ url }) => handleCumulativeReturnSummary(url)],
  ["GET /api/summary/strategies", ({ url }) => handleStrategySummary(url)],
  ["GET /api/summary/factor-style", ({ url }) => handleFactorStyleSummary(url)],
  ["GET /api/summary/behavior", ({ url }) => handleBehaviorSummary(url)],
  ["GET /api/summary/factor-selections", ({ url }) =>
    handleFactorSelectionSummary(url)],
  ["GET /api/summary/behavior-holdings", ({ url }) =>
    handleBehaviorHoldingsSummary(url)],
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
  void (async () => {
    try {
      applyCors(request, response);

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (request.method === "POST" && url.pathname === "/api/ai/factor-style-analysis") {
        await handlePostFactorStyleAnalysis(request, response);
        return;
      }

      if (request.method !== "GET") {
        json(response, 405, {
          error: "method_not_allowed",
          message: `No handler for ${request.method} ${url.pathname}`,
        });
        return;
      }

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
            ai_factor_style: Boolean(process.env.OPENAI_API_KEY?.trim()),
          },
        };
      }
      json(response, 200, payload);
    } catch (error) {
      if (response.headersSent || response.writableEnded || response.destroyed) {
        if (!response.writableEnded && !response.destroyed) {
          response.end();
        }
        return;
      }

      const statusCode = error.statusCode ?? 500;
      json(response, statusCode, {
        error: statusCode >= 500 ? "internal_error" : "bad_request",
        message: error.message ?? "Unexpected error",
        details: error.details ?? null,
      });
    }
  })();
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
