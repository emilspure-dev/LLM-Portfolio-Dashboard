import type {
  HoldingsConcentrationRow,
  RunResultRow,
  StrategyDailyRow,
} from "./api-types";

export interface FallbackHoldingSnapshotRow {
  ticker: string;
  weight: number;
  rank: number;
  path_id: string | null;
  run_id: string | null;
  period: string | null;
  market: string | null;
  prompt_type: string | null;
  model: string | null;
  strategy_key: string | null;
  strategy: string | null;
}

export interface FallbackHoldingSnapshot {
  rows: FallbackHoldingSnapshotRow[];
  hhi: number | null;
  effectiveN: number | null;
  weightGini: number | null;
  top1Weight: number | null;
  top3Share: number | null;
  top5Share: number | null;
  top10Share: number | null;
}

export interface FallbackDailyMetricsSnapshot {
  date: string;
  activeHoldings: number | null;
  driftedHhi: number | null;
  driftedEffectiveN: number | null;
  top1Weight: number | null;
  top3Weight: number | null;
}

export type HoldingsViewMode = "full" | "reduced" | "unavailable";

export type WeightEntry = { ticker: string; weight: number };

export const RUN_HOLDINGS_KEYS = [
  "portfolio_json",
  "holdings",
  "weights",
  "portfolio_weights",
  "allocations",
] as const;
const CONTAINER_KEYS = ["holdings", "weights", "portfolio", "positions", "allocations"] as const;
const TICKER_KEYS = ["ticker", "symbol", "asset", "security"] as const;
const WEIGHT_KEYS = ["weight", "target_weight", "portfolio_weight", "weight_pct", "percent", "allocation"] as const;

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/%/g, "").replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export function parseRawPortfolioJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      const normalized = trimmed
        .replace(/\bNone\b/g, "null")
        .replace(/\bTrue\b/g, "true")
        .replace(/\bFalse\b/g, "false")
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, content: string) =>
          JSON.stringify(content)
        );
      try {
        return JSON.parse(normalized);
      } catch {
        return null;
      }
    }
  }
  return typeof raw === "object" ? raw : null;
}

export function pickRunHoldingsPayload(run: Pick<RunResultRow, keyof RunResultRow>): unknown {
  for (const key of RUN_HOLDINGS_KEYS) {
    const raw = run[key];
    if (raw == null) {
      continue;
    }
    const parsed = parseRawPortfolioJson(raw);
    if (extractWeightEntries(parsed).length > 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * Convenience: pick the first holdings-bearing field on a run row, parse it
 * (JSON + Python-literal recovery), and return the extracted weight entries.
 * Empty array means no readable weights were found.
 */
export function parseRunHoldingsEntries(
  run: Pick<RunResultRow, keyof RunResultRow>
): WeightEntry[] {
  return extractWeightEntries(pickRunHoldingsPayload(run));
}

export function extractWeightEntries(node: unknown, depth = 0): WeightEntry[] {
  if (depth > 4 || node == null) return [];

  if (Array.isArray(node)) {
    return node.flatMap((item) => {
      if (Array.isArray(item) && item.length >= 2) {
        const ticker = asString(item[0]);
        const weight = asFiniteNumber(item[1]);
        return ticker && weight != null ? [{ ticker, weight }] : [];
      }
      if (isPlainObject(item)) {
        const ticker = TICKER_KEYS.map((key) => asString(item[key])).find(Boolean) ?? null;
        const weight = WEIGHT_KEYS.map((key) => asFiniteNumber(item[key])).find((value) => value != null) ?? null;
        if (ticker && weight != null) return [{ ticker, weight }];
      }
      return extractWeightEntries(item, depth + 1);
    });
  }

  if (!isPlainObject(node)) return [];

  const entries = Object.entries(node);
  const directMap = entries.every(([key, value]) => Boolean(key.trim()) && asFiniteNumber(value) != null);
  if (directMap) {
    return entries.map(([ticker, value]) => ({
      ticker: ticker.trim(),
      weight: asFiniteNumber(value) ?? 0,
    }));
  }

  const nested = CONTAINER_KEYS.flatMap((key) => (key in node ? extractWeightEntries(node[key], depth + 1) : []));
  if (nested.length > 0) return nested;

  return entries.flatMap(([ticker, value]) => {
    if (!isPlainObject(value)) return [];
    const weight = WEIGHT_KEYS.map((key) => asFiniteNumber(value[key])).find((candidate) => candidate != null) ?? null;
    return ticker.trim() && weight != null ? [{ ticker: ticker.trim(), weight }] : [];
  });
}

function computeWeightGini(weights: number[]): number | null {
  if (weights.length < 2) return null;
  const sorted = [...weights].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  let weightedSum = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    weightedSum += (index + 1) * sorted[index];
  }
  return (2 * weightedSum) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function normalizePromptType(value: unknown): string | null {
  const normalized = asString(value)?.toLowerCase() ?? null;
  if (!normalized) return null;
  return normalized === "retail" ? "simple" : normalized;
}

function isGptStrategy(strategyKey: unknown): boolean {
  const normalized = asString(strategyKey)?.toLowerCase() ?? "";
  return normalized === "gpt_simple" || normalized === "gpt_advanced";
}

function buildWeightMetrics(weights: number[]) {
  const sorted = [...weights].sort((a, b) => b - a);
  const hhi = weights.length ? weights.reduce((sum, value) => sum + value ** 2, 0) : null;
  return {
    hhi,
    effectiveN: hhi != null && hhi > 0 ? 1 / hhi : null,
    weightGini: computeWeightGini(weights),
    top1Weight: sorted[0] ?? null,
    top3Share: sorted.slice(0, 3).reduce((sum, value) => sum + value, 0),
    top5Share: sorted.slice(0, 5).reduce((sum, value) => sum + value, 0),
    top10Share: sorted.slice(0, 10).reduce((sum, value) => sum + value, 0),
  };
}

export function buildFallbackHoldingSnapshot(
  run: Pick<
    RunResultRow,
    | "portfolio_json"
    | "holdings"
    | "weights"
    | "portfolio_weights"
    | "allocations"
    | "path_id"
    | "run_id"
    | "period"
    | "market"
    | "prompt_type"
    | "model"
    | "strategy_key"
    | "strategy"
  >
): FallbackHoldingSnapshot | null {
  const parsed = pickRunHoldingsPayload(run);
  const entries = extractWeightEntries(parsed);
  const totals = new Map<string, number>();

  for (const entry of entries) {
    const ticker = entry.ticker.trim().toUpperCase();
    if (!ticker || !(entry.weight > 0)) continue;
    totals.set(ticker, (totals.get(ticker) ?? 0) + entry.weight);
  }

  const totalWeight = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  if (!(totalWeight > 0)) return null;

  const rows = Array.from(totals.entries())
    .map(([ticker, weight]) => ({ ticker, weight: weight / totalWeight }))
    .sort((left, right) => right.weight - left.weight || left.ticker.localeCompare(right.ticker))
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      path_id: asString(run.path_id),
      run_id: asString(run.run_id),
      period: asString(run.period),
      market: asString(run.market),
      prompt_type: normalizePromptType(run.prompt_type),
      model: asString(run.model),
      strategy_key: asString(run.strategy_key),
      strategy: asString(run.strategy),
    }));

  const metrics = buildWeightMetrics(rows.map((row) => row.weight));
  return {
    rows,
    hhi: metrics.hhi,
    effectiveN: metrics.effectiveN,
    weightGini: metrics.weightGini,
    top1Weight: metrics.top1Weight,
    top3Share: metrics.top3Share,
    top5Share: metrics.top5Share,
    top10Share: metrics.top10Share,
  };
}

export function buildFallbackHoldingsConcentrationRows(
  runs: Array<Pick<RunResultRow, "portfolio_json" | "market" | "model" | "prompt_type" | "strategy_key">>,
  market?: string
): HoldingsConcentrationRow[] {
  const grouped = new Map<string, {
    model: string;
    prompt_type: string;
    portfolio_count: number;
    hhiValues: number[];
    effectiveNValues: number[];
    weightGiniValues: number[];
    top5ShareValues: number[];
    top10ShareValues: number[];
  }>();

  for (const run of runs) {
    if (market && run.market !== market) continue;
    if (!isGptStrategy(run.strategy_key)) continue;
    const snapshot = buildFallbackHoldingSnapshot(run);
    if (!snapshot) continue;

    const model = asString(run.model) ?? "unknown";
    const prompt_type = normalizePromptType(run.prompt_type) ?? "unknown";
    const key = `${model}::${prompt_type}`;
    const bucket = grouped.get(key) ?? {
      model,
      prompt_type,
      portfolio_count: 0,
      hhiValues: [],
      effectiveNValues: [],
      weightGiniValues: [],
      top5ShareValues: [],
      top10ShareValues: [],
    };

    bucket.portfolio_count += 1;
    if (snapshot.hhi != null) bucket.hhiValues.push(snapshot.hhi);
    if (snapshot.effectiveN != null) bucket.effectiveNValues.push(snapshot.effectiveN);
    if (snapshot.weightGini != null) bucket.weightGiniValues.push(snapshot.weightGini);
    if (snapshot.top5Share != null) bucket.top5ShareValues.push(snapshot.top5Share);
    if (snapshot.top10Share != null) bucket.top10ShareValues.push(snapshot.top10Share);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.values())
    .map((bucket) => ({
      model: bucket.model,
      prompt_type: bucket.prompt_type,
      portfolio_count: bucket.portfolio_count,
      mean_hhi: mean(bucket.hhiValues),
      mean_effective_n: mean(bucket.effectiveNValues),
      mean_weight_gini: mean(bucket.weightGiniValues),
      mean_top_5_share: mean(bucket.top5ShareValues),
      mean_top_10_share: mean(bucket.top10ShareValues),
    }))
    .sort((left, right) => left.model.localeCompare(right.model) || left.prompt_type.localeCompare(right.prompt_type));
}

export function getLatestFallbackDailyMetrics(rows: StrategyDailyRow[]): FallbackDailyMetricsSnapshot | null {
  const withMetrics = rows.filter((row) =>
    [row.active_holdings, row.drifted_hhi, row.drifted_effective_n_holdings, row.top1_weight, row.top3_weight]
      .some((value) => asFiniteNumber(value) != null)
  );
  if (withMetrics.length === 0) return null;

  const latestDate = withMetrics.map((row) => row.date).sort((a, b) => a.localeCompare(b)).at(-1);
  if (!latestDate) return null;

  const latestRows = withMetrics.filter((row) => row.date === latestDate);
  const pickNumbers = (
    values: Array<number | string | null | undefined>
  ) => values.map((value) => asFiniteNumber(value)).filter((value): value is number => value != null);
  return {
    date: latestDate,
    activeHoldings: mean(pickNumbers(latestRows.map((row) => row.active_holdings))),
    driftedHhi: mean(pickNumbers(latestRows.map((row) => row.drifted_hhi))),
    driftedEffectiveN: mean(pickNumbers(latestRows.map((row) => row.drifted_effective_n_holdings))),
    top1Weight: mean(pickNumbers(latestRows.map((row) => row.top1_weight))),
    top3Weight: mean(pickNumbers(latestRows.map((row) => row.top3_weight))),
  };
}

export function resolveHoldingsViewMode(args: {
  holdingsCapabilityUnavailable: boolean;
  fallbackSnapshot: FallbackHoldingSnapshot | null;
}): HoldingsViewMode {
  if (!args.holdingsCapabilityUnavailable) return "full";
  return args.fallbackSnapshot?.rows.length ? "reduced" : "unavailable";
}
