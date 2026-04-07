import type { StrategyDailyRow } from "./api-types";

export const REGRESSION_FACTOR_KEYS = [
  "size",
  "value",
  "momentum",
  "lowRisk",
  "quality",
] as const;

export type RegressionFactorKey = (typeof REGRESSION_FACTOR_KEYS)[number];

export interface RegressionObservation {
  dailyReturn: number;
  size: number;
  value: number;
  momentum: number;
  lowRisk: number;
  quality: number;
}

export interface FactorRegressionResult {
  sampleSize: number;
  meanDailyReturn: number;
  intercept: number;
  coefficients: Record<RegressionFactorKey, number>;
  rSquared: number;
  strongestFactor: RegressionFactorKey | null;
  strongestFactorAbs: number | null;
}

function asFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildRegressionObservations(rows: StrategyDailyRow[]): RegressionObservation[] {
  return rows
    .map((row) => {
      const dailyReturn = asFinite(row.daily_return);
      const size = asFinite(row.portfolio_size_exposure);
      const value = asFinite(row.portfolio_value_exposure);
      const momentum = asFinite(row.portfolio_momentum_exposure);
      const lowRisk = asFinite(row.portfolio_low_risk_exposure);
      const quality = asFinite(row.portfolio_quality_exposure);
      if (
        dailyReturn == null ||
        size == null ||
        value == null ||
        momentum == null ||
        lowRisk == null ||
        quality == null
      ) {
        return null;
      }
      return { dailyReturn, size, value, momentum, lowRisk, quality };
    })
    .filter((row): row is RegressionObservation => row != null);
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][col]) < 1e-10) {
      return null;
    }

    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
    }

    const pivotValue = a[col][col];
    for (let j = col; j <= n; j += 1) {
      a[col][j] /= pivotValue;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j += 1) {
        a[row][j] -= factor * a[col][j];
      }
    }
  }

  return a.map((row) => row[n]);
}

export function computeFactorRegression(rows: StrategyDailyRow[]): FactorRegressionResult | null {
  const observations = buildRegressionObservations(rows);
  if (observations.length < 12) {
    return null;
  }

  const predictors = observations.map((row) => [
    1,
    row.size,
    row.value,
    row.momentum,
    row.lowRisk,
    row.quality,
  ]);
  const target = observations.map((row) => row.dailyReturn);

  const p = predictors[0]?.length ?? 0;
  const xtx = Array.from({ length: p }, () => Array.from({ length: p }, () => 0));
  const xty = Array.from({ length: p }, () => 0);

  for (let i = 0; i < observations.length; i += 1) {
    const x = predictors[i];
    const y = target[i];
    for (let row = 0; row < p; row += 1) {
      xty[row] += x[row] * y;
      for (let col = 0; col < p; col += 1) {
        xtx[row][col] += x[row] * x[col];
      }
    }
  }

  const beta = solveLinearSystem(xtx, xty);
  if (!beta) {
    return null;
  }

  const meanDailyReturn = target.reduce((sum, value) => sum + value, 0) / target.length;
  let residualSumSquares = 0;
  let totalSumSquares = 0;
  for (let i = 0; i < observations.length; i += 1) {
    const fitted = predictors[i].reduce((sum, value, index) => sum + value * beta[index], 0);
    const residual = target[i] - fitted;
    residualSumSquares += residual * residual;
    const centered = target[i] - meanDailyReturn;
    totalSumSquares += centered * centered;
  }

  const coefficients: Record<RegressionFactorKey, number> = {
    size: beta[1] ?? 0,
    value: beta[2] ?? 0,
    momentum: beta[3] ?? 0,
    lowRisk: beta[4] ?? 0,
    quality: beta[5] ?? 0,
  };

  const strongestEntry = REGRESSION_FACTOR_KEYS
    .map((key) => ({ key, absValue: Math.abs(coefficients[key]) }))
    .sort((left, right) => right.absValue - left.absValue)[0];

  return {
    sampleSize: observations.length,
    meanDailyReturn,
    intercept: beta[0] ?? 0,
    coefficients,
    rSquared: totalSumSquares > 0 ? 1 - residualSumSquares / totalSumSquares : 0,
    strongestFactor: strongestEntry?.key ?? null,
    strongestFactorAbs: strongestEntry?.absValue ?? null,
  };
}
