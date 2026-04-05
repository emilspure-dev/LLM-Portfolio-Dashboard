import {
  getFactorStyleSummary,
  getFilters,
  getPeriods,
  getRunQuality,
  getRunResults,
  getStrategySummary,
} from "./api-client";
import type {
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
) {
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

  return weightTotal > 0 ? weightedSum / weightTotal : Number.NaN;
}

function sortSummaryRows(rows: StrategyRow[]) {
  return [...rows].sort((left, right) => {
    const leftIsGpt = left.strategy_key.startsWith("gpt_");
    const rightIsGpt = right.strategy_key.startsWith("gpt_");

    if (leftIsGpt !== rightIsGpt) {
      return leftIsGpt ? -1 : 1;
    }

    return (right.mean_sharpe ?? 0) - (left.mean_sharpe ?? 0);
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
    const key = `${row.strategy_key}::${row.source_type}`;
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
  const [filters, summaryRows, factorStyleRows, runQuality, periods, runs] = await Promise.all([
    getFilters({ experiment_id: experimentId }),
    getStrategySummary({ experiment_id: experimentId }),
    getFactorStyleSummary({ experiment_id: experimentId }).catch((): FactorStyleSummaryRow[] => []),
    getRunQuality({ experiment_id: experimentId }),
    getPeriods({ experiment_id: experimentId }),
    fetchAllRunResults(experimentId),
  ]);

  return {
    meta,
    filters,
    active_experiment_id: experimentId,
    summary_rows: summaryRows,
    summary: buildStrategySummaryView(summaryRows),
    factor_style_rows: factorStyleRows,
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
