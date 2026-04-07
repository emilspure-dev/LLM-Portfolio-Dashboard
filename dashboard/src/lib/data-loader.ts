import {
  getFactorExposureChart,
  getFactorStyleSummary,
  getFilters,
  getPeriods,
  getRunQuality,
  getRunResults,
  getStrategySummary,
} from "./api-client";
import type {
  FactorExposureRow,
  FactorStyleSummaryRow,
  MetaCurrentResponse,
  RunResultRow,
  StrategySummaryApiRow,
} from "./api-types";
import type {
  BehaviorRow,
  EvaluationData,
  RunRow,
  StrategyRow,
} from "./types";

/** Mirrors backend GET /summary/factor-style when that route is missing (older Node deploy). */
export function buildFactorStyleSummaryFromExposureRows(
  rows: FactorExposureRow[]
): FactorStyleSummaryRow[] {
  if (rows.length === 0) return [];

  type PathAgg = {
    strategy_key: string;
    strategy: string;
    prompt_type: string | null;
    market: string;
    mean_size: number | null;
    mean_value: number | null;
    mean_momentum: number | null;
    mean_low_risk: number | null;
    mean_quality: number | null;
  };

  const byPath = new Map<string, FactorExposureRow[]>();
  for (const r of rows) {
    const k = `${r.experiment_id}::${r.path_id}`;
    const g = byPath.get(k);
    if (g) g.push(r);
    else byPath.set(k, [r]);
  }

  const meanCol = (
    group: FactorExposureRow[],
    pick: (row: FactorExposureRow) => number | null | undefined
  ): number | null => {
    const vals = group
      .map(pick)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const pathAggs: PathAgg[] = [];
  for (const group of byPath.values()) {
    const first = group[0];
    const ptRaw = first.prompt_type?.trim() ?? "";
    const prompt_type = ptRaw === "" ? null : ptRaw;
    pathAggs.push({
      strategy_key: first.strategy_key,
      strategy: first.strategy,
      prompt_type,
      market: first.market,
      mean_size: meanCol(group, (r) => r.portfolio_size_exposure),
      mean_value: meanCol(group, (r) => r.portfolio_value_exposure),
      mean_momentum: meanCol(group, (r) => r.portfolio_momentum_exposure),
      mean_low_risk: meanCol(group, (r) => r.portfolio_low_risk_exposure),
      mean_quality: meanCol(group, (r) => r.portfolio_quality_exposure),
    });
  }

  const cellKey = (p: PathAgg) =>
    `${p.strategy_key}\0${p.strategy}\0${p.prompt_type ?? ""}\0${p.market}`;
  const cells = new Map<string, PathAgg[]>();
  for (const p of pathAggs) {
    const k = cellKey(p);
    const g = cells.get(k);
    if (g) g.push(p);
    else cells.set(k, [p]);
  }

  const out: FactorStyleSummaryRow[] = [];
  for (const paths of cells.values()) {
    const p0 = paths[0];
    const avg = (fn: (p: PathAgg) => number | null) => {
      const vals = paths.map(fn).filter((v): v is number => v != null && Number.isFinite(v));
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    out.push({
      strategy_key: p0.strategy_key,
      strategy: p0.strategy,
      prompt_type: p0.prompt_type,
      market: p0.market,
      path_count: paths.length,
      mean_size_exposure: avg((p) => p.mean_size),
      mean_value_exposure: avg((p) => p.mean_value),
      mean_momentum_exposure: avg((p) => p.mean_momentum),
      mean_low_risk_exposure: avg((p) => p.mean_low_risk),
      mean_quality_exposure: avg((p) => p.mean_quality),
    });
  }

  out.sort((a, b) => {
    const ka = `${a.strategy_key}|${a.prompt_type ?? ""}|${a.market}`;
    const kb = `${b.strategy_key}|${b.prompt_type ?? ""}|${b.market}`;
    return ka.localeCompare(kb);
  });
  return out;
}

function factorStyleRouteLikelyMissing(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return (
    /\b404\b/.test(m) ||
    m.includes("No route matches") ||
    /not_found/i.test(m)
  );
}

function getReturnCol(row: RunRow): number | null {
  return row.period_return ?? row.net_return ?? row.period_return_net ?? null;
}

function computeBehavior(runs: RunRow[]): BehaviorRow[] {
  const gptRuns = runs.filter(
    (r) => r.prompt_type === "retail" || r.prompt_type === "advanced"
  );
  const result: BehaviorRow[] = [];

  for (const pt of ["retail", "advanced"] as const) {
    const sub = gptRuns.filter((r) => r.prompt_type === pt);
    if (sub.length === 0) continue;

    const mean = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const median = (arr: number[]) => {
      if (!arr.length) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    };

    const hhis = sub
      .map((r) => r.hhi)
      .filter((value): value is number => value != null && !Number.isNaN(value));
    const effectiveN = sub
      .map((r) => r.effective_n_holdings)
      .filter((value): value is number => value != null && !Number.isNaN(value));
    const turnovers = sub
      .map((r) => r.turnover)
      .filter((value): value is number => value != null && !Number.isNaN(value));
    const realizedReturns = sub
      .map((r) => getReturnCol(r))
      .filter((value): value is number => value != null && !Number.isNaN(value));
    const expectedReturns = sub
      .map((r) => r.expected_portfolio_return_6m)
      .filter((value): value is number => value != null && !Number.isNaN(value));
    const forecastBias = sub
      .map((r) => r.forecast_bias)
      .filter((value): value is number => value != null && !Number.isNaN(value));
    const forecastAbsError = sub
      .map((r) => r.forecast_abs_error)
      .filter((value): value is number => value != null && !Number.isNaN(value));

    result.push({
      prompt_type: pt,
      mean_hhi: mean(hhis),
      mean_effective_n_holdings: mean(effectiveN),
      mean_turnover: mean(turnovers),
      median_turnover: median(turnovers),
      mean_expected_portfolio_return_6m: mean(expectedReturns),
      mean_realized_net_return: mean(realizedReturns),
      mean_forecast_bias: mean(forecastBias),
      mean_forecast_abs_error: mean(forecastAbsError),
    });
  }

  return result;
}

function weightedAverage(
  rows: StrategySummaryApiRow[],
  selector: (row: StrategySummaryApiRow) => number | null
): number | null {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const row of rows) {
    const value = selector(row);
    if (value == null || Number.isNaN(value)) {
      continue;
    }

    const weight = row.observations > 0 ? row.observations : 1;
    weightedSum += value * weight;
    weightTotal += weight;
  }

  return weightTotal > 0 ? weightedSum / weightTotal : null;
}

function sortSummaryRows(rows: StrategyRow[]) {
  return [...rows].sort((left, right) => {
    const leftIsGpt = left.strategy_key.startsWith("gpt_");
    const rightIsGpt = right.strategy_key.startsWith("gpt_");

    if (leftIsGpt !== rightIsGpt) {
      return leftIsGpt ? -1 : 1;
    }

    // Group same strategy_key together (e.g. all "index" rows together)
    if (left.strategy_key !== right.strategy_key) {
      const lb = left.mean_sharpe != null && Number.isFinite(left.mean_sharpe);
      const rb = right.mean_sharpe != null && Number.isFinite(right.mean_sharpe);
      if (lb && rb) return right.mean_sharpe! - left.mean_sharpe!;
      if (lb) return -1;
      if (rb) return 1;
      return 0;
    }

    // Same strategy_key: sort by market label so S&P / DAX / Nikkei appear in stable order
    const lm = (left.markets?.[0] ?? left.Strategy).toLowerCase();
    const rm = (right.markets?.[0] ?? right.Strategy).toLowerCase();
    return lm.localeCompare(rm);
  });
}

export function buildStrategySummaryView(
  rows: StrategySummaryApiRow[],
  marketFilter = "All"
): StrategyRow[] {
  const filteredRows =
    marketFilter === "All"
      ? rows
      : rows.filter((row) => row.market === marketFilter);

  const grouped = new Map<string, StrategySummaryApiRow[]>();

  for (const row of filteredRows) {
    // GPT strategies are evaluated across all markets and should be aggregated into one row.
    // Benchmark strategies are market-specific assets (S&P 500 index ≠ DAX 40 index) and
    // must be kept separate per market so they show individually in charts and tables.
    const isGpt = row.strategy_key.startsWith("gpt_");
    const key = isGpt
      ? `${row.strategy_key}::${row.source_type}`
      : `${row.strategy_key}::${row.source_type}::${row.market}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  const summaryRows = Array.from(grouped.values()).map((group) => {
    const representative = group[0];

    return {
      Strategy: representative.strategy,
      strategy_key: representative.strategy_key,
      source_type: representative.source_type,
      mean_sharpe: weightedAverage(group, (row) => row.mean_sharpe),
      net_return_mean: weightedAverage(group, (row) => row.mean_return),
      n_observations: group.reduce(
        (count, row) => count + (row.observations ?? 0),
        0
      ),
      pct_runs_beating_index_sharpe: weightedAverage(
        group,
        (row) => row.pct_runs_beating_index_sharpe
      ),
      pct_runs_beating_sixty_forty_sharpe: weightedAverage(
        group,
        (row) => row.pct_runs_beating_sixty_forty_sharpe
      ),
      mean_annualized_return: weightedAverage(
        group,
        (row) => row.mean_annualized_return
      ),
      mean_volatility: weightedAverage(group, (row) => row.mean_volatility),
      mean_historical_var_95: weightedAverage(
        group,
        (row) => row.mean_historical_var_95
      ),
      mean_turnover: weightedAverage(group, (row) => row.mean_turnover),
      markets: Array.from(new Set(group.map((row) => row.market))),
      prompt_types: Array.from(
        new Set(
          group
            .map((row) => row.prompt_type)
            .filter((value): value is string => Boolean(value))
        )
      ),
    };
  });

  return sortSummaryRows(summaryRows);
}

function canonicalStrategyKey(key: string | null | undefined): string {
  return String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

/**
 * Distinct path_ids from runs for a market + strategy, for chart APIs when filtering by
 * strategy_key alone returns no rows (some DB builds only join daily series by path).
 */
export function collectPathIdsForStrategyMarket(
  runs: RunRow[],
  market: string,
  strategyKey: string,
  maxPaths = 48
): string[] {
  const target = canonicalStrategyKey(strategyKey);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const r of runs) {
    if (r.valid === false) {
      continue;
    }
    if (r.market !== market) {
      continue;
    }
    if (canonicalStrategyKey(r.strategy_key) !== target) {
      continue;
    }
    const pid = r.path_id;
    if (pid == null || !String(pid).trim()) {
      continue;
    }
    const s = String(pid);
    if (seen.has(s)) {
      continue;
    }
    seen.add(s);
    ordered.push(s);
    if (ordered.length >= maxPaths) {
      break;
    }
  }
  return ordered;
}

/**
 * When strategy summary rows omit mean_sharpe (common for some benchmarks), fill from
 * run-level sharpe_ratio so heatmaps and KPIs stay aligned with the loaded run metrics.
 */
export function backfillSummarySharpeFromRuns(
  summary: StrategyRow[],
  runs: RunRow[],
  marketFilter: string
): StrategyRow[] {
  const runsScoped = runs.filter((r) => {
    if (r.valid === false) {
      return false;
    }
    if (marketFilter !== "All" && r.market !== marketFilter) {
      return false;
    }
    return true;
  });

  return summary.map((row) => {
    if (row.mean_sharpe != null && Number.isFinite(row.mean_sharpe)) {
      return row;
    }
    const rowCanon = canonicalStrategyKey(row.strategy_key);
    const sharpeVals = runsScoped
      .filter(
        (r) => canonicalStrategyKey(r.strategy_key) === rowCanon
      )
      .map((r) => r.sharpe_ratio)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (sharpeVals.length === 0) {
      return row;
    }
    const meanFromRuns =
      sharpeVals.reduce((sum, v) => sum + v, 0) / sharpeVals.length;
    return { ...row, mean_sharpe: meanFromRuns };
  });
}

export function buildStrategySummaryWithRunSharpe(
  rows: StrategySummaryApiRow[],
  marketFilter: string,
  runs: RunRow[]
): StrategyRow[] {
  const base = buildStrategySummaryView(rows, marketFilter);
  const filled = backfillSummarySharpeFromRuns(base, runs, marketFilter);
  return sortSummaryRows(filled);
}

async function fetchAllRunResults(experimentId: string): Promise<RunRow[]> {
  const firstPage = await getRunResults({
    experiment_id: experimentId,
    page: 1,
    page_size: 500,
  });

  const remainingRequests: Promise<{ items: RunResultRow[] }>[] = [];
  for (let page = 2; page <= firstPage.total_pages; page += 1) {
    remainingRequests.push(
      getRunResults({
        experiment_id: experimentId,
        page,
        page_size: firstPage.page_size,
      })
    );
  }

  const remainingPages = await Promise.all(remainingRequests);
  return [firstPage, ...remainingPages].flatMap((page) => page.items as RunRow[]);
}

interface FetchEvaluationDataArgs {
  experimentId: string;
  meta: MetaCurrentResponse;
}

export async function fetchEvaluationData({
  experimentId,
  meta,
}: FetchEvaluationDataArgs): Promise<EvaluationData> {
  const [filters, summaryRows, runQuality, periods, runs] = await Promise.all([
    getFilters({ experiment_id: experimentId }),
    getStrategySummary({ experiment_id: experimentId }),
    getRunQuality({ experiment_id: experimentId }),
    getPeriods({ experiment_id: experimentId }),
    fetchAllRunResults(experimentId),
  ]);

  let factorStyleRows: FactorStyleSummaryRow[] = [];
  let factorStyleError: string | null = null;
  let factorStyleFromExposureFallback = false;
  try {
    factorStyleRows = await getFactorStyleSummary({ experiment_id: experimentId });
  } catch (e) {
    if (factorStyleRouteLikelyMissing(e)) {
      try {
        const exposureRows = await getFactorExposureChart({ experiment_id: experimentId });
        factorStyleRows = buildFactorStyleSummaryFromExposureRows(exposureRows);
        factorStyleFromExposureFallback = true;
      } catch {
        factorStyleError = e instanceof Error ? e.message : String(e);
      }
    } else {
      factorStyleError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    meta,
    filters,
    active_experiment_id: experimentId,
    summary_rows: summaryRows,
    summary: buildStrategySummaryWithRunSharpe(summaryRows, "All", runs),
    factor_style_rows: factorStyleRows,
    factor_style_error: factorStyleError,
    factor_style_from_exposure_fallback: factorStyleFromExposureFallback,
    runs,
    behavior: computeBehavior(runs),
    run_quality: runQuality,
    periods,
    stats: [],
    postloss: [],
    gpt_cells: [],
    gpt_drawdowns: [],
    strategy_paths: [],
    strategy_cells: [],
    periods_data: [],
    benchmarks: [],
    data_quality: [],
    holdings: [],
    runs_long: [],
  };
}
