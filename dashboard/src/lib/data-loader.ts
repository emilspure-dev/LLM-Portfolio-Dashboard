import {
  getBehaviorSummary,
  getFactorExposureChart,
  getFactorStyleSummary,
  getFilters,
  getOverviewSummary,
  getPeriods,
  getRunQuality,
  getRunResults,
  getStrategySummary,
} from "./api-client";
import type {
  FactorExposureRow,
  FactorStyleSummaryRow,
  MetaCurrentResponse,
  StrategyDailyRow,
  RunResultRow,
  StrategySummaryApiRow,
} from "./api-types";
import type {
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

export function apiRouteLikelyMissing(err: unknown): boolean {
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

export function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values);
  if (avg == null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function isValidRun(run: RunRow): boolean {
  return run.valid !== false && run.valid !== 0;
}

export function normalizePromptType(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase() || "unknown";
}

export function normalizeModelLabel(value: string | null | undefined): string {
  return String(value ?? "").trim() || "unknown";
}

function parsePeriodSortValue(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;

  let match = /^(\d{4})H([12])$/.exec(raw);
  if (match) {
    return Number(match[1]) * 2 + (Number(match[2]) - 1);
  }

  match = /^H([12])\s*(\d{4})$/.exec(raw);
  if (match) {
    return Number(match[2]) * 2 + (Number(match[1]) - 1);
  }

  return null;
}

function comparePeriodLabels(
  left: string | null | undefined,
  right: string | null | undefined
): number {
  const leftSort = parsePeriodSortValue(left);
  const rightSort = parsePeriodSortValue(right);
  if (leftSort != null && rightSort != null && leftSort !== rightSort) {
    return leftSort - rightSort;
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
}

export function getRunModelGroupKey(
  run: Pick<
    RunRow,
    | "trajectory_id"
    | "run_id"
    | "path_id"
    | "strategy_key"
    | "market"
    | "prompt_type"
    | "execution_mode"
  >
): string {
  const runId =
    run.run_id != null && String(run.run_id).trim()
      ? String(run.run_id).trim()
      : null;
  if (runId) return `run:${runId}`;

  const pathId =
    run.path_id != null && String(run.path_id).trim()
      ? String(run.path_id).trim()
      : null;
  if (pathId) return `path:${pathId}`;

  const trajectoryId =
    run.trajectory_id != null && String(run.trajectory_id).trim()
      ? String(run.trajectory_id).trim()
      : null;
  if (trajectoryId) return `trajectory:${trajectoryId}`;

  return [
    "fallback",
    String(run.strategy_key ?? ""),
    String(run.market ?? ""),
    String(run.prompt_type ?? ""),
    String(run.execution_mode ?? ""),
  ].join("::");
}

export function getRunModelFallbackKey(
  run: Pick<RunRow, "strategy_key" | "market" | "period" | "prompt_type">
) {
  return [
    String(run.strategy_key ?? ""),
    String(run.market ?? ""),
    String(run.period ?? ""),
    String(run.prompt_type ?? ""),
  ].join("::");
}

export function buildRunModelMetadata(runs: RunRow[]) {
  const periodModelByGroupAndPeriod = new Map<string, string>();
  const periodModelByFallbackKey = new Map<string, string>();
  const fullRunPeriods = new Map<string, Array<{ period: string; model: string }>>();

  for (const run of runs) {
    const model = normalizeModelLabel(run.model);
    if (model === "unknown") continue;

    const period = String(run.period ?? "").trim() || "unknown";
    const groupKey = getRunModelGroupKey(run);
    periodModelByGroupAndPeriod.set(`${groupKey}::${period}`, model);

    const fallbackKey = getRunModelFallbackKey({
      strategy_key: run.strategy_key,
      market: run.market,
      period,
      prompt_type: run.prompt_type,
    });
    periodModelByFallbackKey.set(fallbackKey, model);

    const bucket = fullRunPeriods.get(groupKey) ?? [];
    bucket.push({ period, model });
    fullRunPeriods.set(groupKey, bucket);
  }

  const fullRunModelByGroupKey = new Map<string, string>();
  for (const [groupKey, periods] of fullRunPeriods) {
    const ordered = [...periods].sort((left, right) =>
      comparePeriodLabels(left.period, right.period)
    );
    const modelStack: string[] = [];
    const seen = new Set<string>();
    for (const entry of ordered) {
      if (!seen.has(entry.model)) {
        seen.add(entry.model);
        modelStack.push(entry.model);
      }
    }
    fullRunModelByGroupKey.set(
      groupKey,
      modelStack.length > 0 ? modelStack.join(" -> ") : "unknown"
    );
  }

  return {
    periodModelByGroupAndPeriod,
    periodModelByFallbackKey,
    fullRunModelByGroupKey,
  };
}

export function formatRunKey(run: Pick<RunRow, "run_id" | "path_id" | "strategy_key" | "market" | "period" | "model" | "prompt_type">): string {
  const runId = run.run_id != null && String(run.run_id).trim() ? String(run.run_id) : null;
  if (runId) return runId;
  const pathId = run.path_id != null && String(run.path_id).trim() ? String(run.path_id) : null;
  if (pathId) return pathId;
  return [
    run.strategy_key ?? "",
    run.market ?? "",
    run.period ?? "",
    run.model ?? "",
    run.prompt_type ?? "",
  ].join("::");
}

export function excludeJapan25H2Runs(runs: RunRow[]) {
  return runs.filter((run) => !(run.market === "japan" && run.period === "H2 2025"));
}

export function wilsonInterval(successes: number, total: number, z = 1.96) {
  if (total <= 0) return { low: null, high: null, center: null };
  const phat = successes / total;
  const denom = 1 + (z ** 2) / total;
  const center = (phat + (z ** 2) / (2 * total)) / denom;
  const margin =
    (z / denom) *
    Math.sqrt((phat * (1 - phat)) / total + (z ** 2) / (4 * total ** 2));
  return {
    center,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

export function rollingMetricSeries(
  rows: StrategyDailyRow[],
  windowSize = 21
): Array<{
  date: string;
  rollingSharpe: number | null;
  rollingSortino: number | null;
  rollingVolatility: number | null;
  rollingMeanReturn: number | null;
}> {
  const ordered = [...rows]
    .filter((row) => asFiniteNumber(row.daily_return) != null)
    .sort((left, right) => left.date.localeCompare(right.date));
  const result: Array<{
    date: string;
    rollingSharpe: number | null;
    rollingSortino: number | null;
    rollingVolatility: number | null;
    rollingMeanReturn: number | null;
  }> = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const window = ordered
      .slice(Math.max(0, index - windowSize + 1), index + 1)
      .map((row) => row.daily_return)
      .filter((value): value is number => asFiniteNumber(value) != null);
    if (window.length < Math.max(5, Math.floor(windowSize / 2))) {
      result.push({
        date: ordered[index].date,
        rollingSharpe: null,
        rollingSortino: null,
        rollingVolatility: null,
        rollingMeanReturn: null,
      });
      continue;
    }
    const avg = mean(window);
    const vol = stdDev(window);
    const downside = stdDev(window.filter((value) => value < 0));
    result.push({
      date: ordered[index].date,
      rollingMeanReturn: avg,
      rollingVolatility: vol,
      rollingSharpe: avg != null && vol != null && vol > 0 ? (avg / vol) * Math.sqrt(252) : null,
      rollingSortino:
        avg != null && downside != null && downside > 0 ? (avg / downside) * Math.sqrt(252) : null,
    });
  }

  return result;
}

export function computeAutocorrelation(values: number[], lag = 1): number | null {
  if (values.length <= lag + 1) return null;
  const avg = mean(values);
  if (avg == null) return null;
  let numerator = 0;
  let denominator = 0;
  for (let index = lag; index < values.length; index += 1) {
    numerator += (values[index] - avg) * (values[index - lag] - avg);
  }
  for (const value of values) {
    denominator += (value - avg) ** 2;
  }
  return denominator > 0 ? numerator / denominator : null;
}

export function ljungBoxStatistic(values: number[], lags = 5): number | null {
  if (values.length <= lags + 1) return null;
  let sum = 0;
  for (let lag = 1; lag <= lags; lag += 1) {
    const acf = computeAutocorrelation(values, lag);
    if (acf == null) continue;
    sum += (acf ** 2) / (values.length - lag);
  }
  return values.length * (values.length + 2) * sum;
}

export function buildCoverageRows(runs: RunRow[]) {
  const grouped = new Map<string, {
    model: string;
    market: string;
    period: string;
    promptType: string;
    runCount: number;
    validCount: number;
  }>();
  for (const run of runs) {
    const model = normalizeModelLabel(run.model);
    const market = String(run.market ?? "unknown");
    const period = String(run.period ?? "unknown");
    const promptType = normalizePromptType(run.prompt_type);
    const key = `${model}::${market}::${period}::${promptType}`;
    const bucket = grouped.get(key) ?? { model, market, period, promptType, runCount: 0, validCount: 0 };
    bucket.runCount += 1;
    if (isValidRun(run)) bucket.validCount += 1;
    grouped.set(key, bucket);
  }
  return Array.from(grouped.values()).sort((left, right) =>
    `${left.model}|${left.market}|${left.period}|${left.promptType}`.localeCompare(
      `${right.model}|${right.market}|${right.period}|${right.promptType}`
    )
  );
}

export function buildRunFailureSummary(runs: RunRow[]) {
  const totalRuns = runs.length;
  const failedRuns = runs.filter((run) => !isValidRun(run) || normalizeModelLabel(run.failure_type) !== "unknown");
  const byFailureType = Array.from(
    failedRuns.reduce((map, run) => {
      const key = String(run.failure_type ?? "invalid_without_type");
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  ).map(([failureType, count]) => ({ failureType, count }));
  return {
    totalRuns,
    failedRuns: failedRuns.length,
    failureRate: totalRuns > 0 ? failedRuns.length / totalRuns : null,
    byFailureType,
  };
}

export function buildBenchmarkComparisonRows(runs: RunRow[]) {
  const benchmarks = ["fama_french", "mean_variance", "equal_weight", "index", "sixty_forty"] as const;
  const output: Array<{
    strategyKey: string;
    strategyLabel: string;
    benchmarkKey: string;
    wins: number;
    total: number;
    winRate: number | null;
    ciLow: number | null;
    ciHigh: number | null;
    meanDelta: number | null;
  }> = [];

  const validRuns = runs.filter(isValidRun);
  const gptKeys = Array.from(new Set(validRuns.map((run) => run.strategy_key).filter((key): key is string => key === "gpt_retail" || key === "gpt_advanced")));
  for (const strategyKey of gptKeys) {
    for (const benchmarkKey of benchmarks) {
      const benchmarkMap = new Map<string, number>();
      for (const run of validRuns) {
        if (run.strategy_key !== benchmarkKey) continue;
        const sharpe = asFiniteNumber(run.sharpe_ratio);
        if (sharpe == null) continue;
        benchmarkMap.set(`${run.market ?? ""}::${run.period ?? ""}`, sharpe);
      }
      let wins = 0;
      let total = 0;
      const deltas: number[] = [];
      for (const run of validRuns) {
        if (run.strategy_key !== strategyKey) continue;
        const sharpe = asFiniteNumber(run.sharpe_ratio);
        const benchmarkSharpe = benchmarkMap.get(`${run.market ?? ""}::${run.period ?? ""}`);
        if (sharpe == null || benchmarkSharpe == null) continue;
        total += 1;
        if (sharpe > benchmarkSharpe) wins += 1;
        deltas.push(sharpe - benchmarkSharpe);
      }
      const ci = wilsonInterval(wins, total);
      output.push({
        strategyKey,
        strategyLabel: strategyKey,
        benchmarkKey,
        wins,
        total,
        winRate: total > 0 ? wins / total : null,
        ciLow: ci.low,
        ciHigh: ci.high,
        meanDelta: mean(deltas),
      });
    }
  }
  return output;
}

export function buildRegimePerformanceRows(runs: RunRow[]) {
  const modelMetadata = buildRunModelMetadata(runs);
  const grouped = new Map<string, {
    regimeCode: string;
    market: string;
    marketRegimeLabel: string | null;
    volRegimeLabel: string | null;
    rateRegimeLabel: string | null;
    model: string;
    promptType: string;
    sharpeValues: number[];
    returnValues: number[];
    count: number;
  }>();
  for (const run of runs.filter(isValidRun)) {
    const regimeCode = String(run.regime_code ?? "unknown");
    const model =
      modelMetadata.fullRunModelByGroupKey.get(getRunModelGroupKey(run)) ??
      normalizeModelLabel(run.model);
    const promptType = normalizePromptType(run.prompt_type);
    const market = String(run.market ?? "unknown");
    const key = `${regimeCode}::${market}::${model}::${promptType}`;
    const bucket = grouped.get(key) ?? {
      regimeCode,
      market,
      marketRegimeLabel: run.market_regime_label ?? null,
      volRegimeLabel: run.vol_regime_label ?? null,
      rateRegimeLabel: run.rate_regime_label ?? null,
      model,
      promptType,
      sharpeValues: [],
      returnValues: [],
      count: 0,
    };
    const sharpe = asFiniteNumber(run.sharpe_ratio);
    const periodReturn = asFiniteNumber(getReturnCol(run));
    if (sharpe != null) bucket.sharpeValues.push(sharpe);
    if (periodReturn != null) bucket.returnValues.push(periodReturn);
    bucket.count += 1;
    grouped.set(key, bucket);
  }
  return Array.from(grouped.values()).map((row) => ({
    ...row,
    meanSharpe: mean(row.sharpeValues),
    meanReturn: mean(row.returnValues),
  }));
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < n; pivot += 1) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row;
      }
    }
    if (Math.abs(augmented[maxRow][pivot]) < 1e-10) return null;
    [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];
    const pivotValue = augmented[pivot][pivot];
    for (let col = pivot; col <= n; col += 1) augmented[pivot][col] /= pivotValue;
    for (let row = 0; row < n; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let col = pivot; col <= n; col += 1) {
        augmented[row][col] -= factor * augmented[pivot][col];
      }
    }
  }
  return augmented.map((row) => row[n]);
}

export function buildFeatureRegression(
  runs: RunRow[],
  target: "sharpe_ratio" | "annualized_return"
): {
  coefficients: Array<{ feature: string; coefficient: number }>;
  sampleSize: number;
  rSquared: number | null;
} | null {
  const rows = runs
    .filter(isValidRun)
    .map((run) => ({
      y: asFiniteNumber(run[target]),
      nHoldings: asFiniteNumber(run.n_holdings),
      hhi: asFiniteNumber(run.hhi),
      expectedReturn: asFiniteNumber(run.expected_portfolio_return_6m),
      turnover: asFiniteNumber(run.turnover),
    }))
    .filter(
      (row): row is { y: number; nHoldings: number; hhi: number; expectedReturn: number; turnover: number } =>
        row.y != null &&
        row.nHoldings != null &&
        row.hhi != null &&
        row.expectedReturn != null &&
        row.turnover != null
    );

  if (rows.length < 12) return null;
  const X = rows.map((row) => [1, row.nHoldings, row.hhi, row.expectedReturn, row.turnover]);
  const y = rows.map((row) => row.y);
  const xtx = X[0].map((_, i) =>
    X[0].map((__, j) => X.reduce((sum, row) => sum + row[i] * row[j], 0))
  );
  const xty = X[0].map((_, i) => X.reduce((sum, row, index) => sum + row[i] * y[index], 0));
  const solution = solveLinearSystem(xtx, xty);
  if (!solution) return null;
  const yMean = mean(y);
  const predictions = X.map((row) => row.reduce((sum, value, index) => sum + value * solution[index], 0));
  const ssRes = y.reduce((sum, value, index) => sum + (value - predictions[index]) ** 2, 0);
  const ssTot = yMean != null ? y.reduce((sum, value) => sum + (value - yMean) ** 2, 0) : null;
  return {
    sampleSize: rows.length,
    rSquared: ssTot != null && ssTot > 0 ? 1 - ssRes / ssTot : null,
    coefficients: [
      { feature: "Intercept", coefficient: solution[0] },
      { feature: "Holdings", coefficient: solution[1] },
      { feature: "HHI", coefficient: solution[2] },
      { feature: "Expected return", coefficient: solution[3] },
      { feature: "Turnover", coefficient: solution[4] },
    ],
  };
}

export function computeBehavior(runs: RunRow[]) {
  const gptRuns = runs.filter(
    (r) => r.prompt_type === "retail" || r.prompt_type === "advanced"
  );
  const result = [];

  for (const pt of ["retail", "advanced"] as const) {
    const sub = gptRuns.filter((r) => r.prompt_type === pt);
    if (sub.length === 0) continue;

    const avg = (arr: number[]) =>
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
      mean_hhi: avg(hhis),
      mean_effective_n_holdings: avg(effectiveN),
      mean_turnover: avg(turnovers),
      median_turnover: median(turnovers),
      mean_expected_portfolio_return_6m: avg(expectedReturns),
      mean_realized_net_return: avg(realizedReturns),
      mean_forecast_bias: avg(forecastBias),
      mean_forecast_abs_error: avg(forecastAbsError),
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

export async function fetchAllRunResults(experimentId: string): Promise<RunRow[]> {
  const firstPage = await getRunResults({
    experiment_id: experimentId,
    page: 1,
    page_size: 500,
  });

  const remainingPages: Array<{ items: RunResultRow[] }> = [];
  const concurrency = 4;
  for (let page = 2; page <= firstPage.total_pages; page += concurrency) {
    const batch = [];
    for (
      let currentPage = page;
      currentPage < page + concurrency && currentPage <= firstPage.total_pages;
      currentPage += 1
    ) {
      batch.push(
        getRunResults({
          experiment_id: experimentId,
          page: currentPage,
          page_size: firstPage.page_size,
        })
      );
    }
    remainingPages.push(...(await Promise.all(batch)));
  }

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
  const [overviewSummary, filters, summaryRows, behaviorRows, runQuality, periods] = await Promise.all([
    getOverviewSummary({ experiment_id: experimentId }).catch((error) => {
      if (apiRouteLikelyMissing(error)) {
        return null;
      }
      throw error;
    }),
    getFilters({ experiment_id: experimentId }),
    getStrategySummary({ experiment_id: experimentId }),
    getBehaviorSummary({ experiment_id: experimentId }).catch((error) => {
      if (apiRouteLikelyMissing(error)) {
        return [];
      }
      throw error;
    }),
    getRunQuality({ experiment_id: experimentId }),
    getPeriods({ experiment_id: experimentId }),
  ]);

  let factorStyleRows: FactorStyleSummaryRow[] = [];
  let factorStyleError: string | null = null;
  let factorStyleFromExposureFallback = false;
  try {
    factorStyleRows = await getFactorStyleSummary({ experiment_id: experimentId });
  } catch (e) {
    if (apiRouteLikelyMissing(e)) {
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
    overview_summary: overviewSummary,
    summary_rows: summaryRows,
    summary: buildStrategySummaryView(summaryRows, "All"),
    factor_style_rows: factorStyleRows,
    factor_style_error: factorStyleError,
    factor_style_from_exposure_fallback: factorStyleFromExposureFallback,
    runs: [],
    behavior: behaviorRows,
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
