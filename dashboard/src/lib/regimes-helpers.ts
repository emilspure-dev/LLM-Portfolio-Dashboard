import { normalizePromptType } from "./data-loader";
import { parseRunHoldingsEntries } from "./holdings-fallback";
import type { RunRow } from "./types";

export const REGIMES_FIXED_MODELS = [
  "gpt-3.5-turbo-0125",
  "gpt-4-turbo-2024-04-09",
  "gpt-5-2025-08-07",
] as const;

export const REGIMES_FIXED_PROMPTS = ["simple", "advanced"] as const;

export const REGIMES_EQUITY_LABELS = ["Bear", "Flat", "Bull"] as const;
export const REGIMES_VOL_LABELS = ["Low", "Elevated", "High"] as const;

/**
 * Minimum number of distinct (market, period) observations required before a regime
 * cell is considered well-supported. Cells with fewer are rendered as omitted (bars)
 * or hatched (heatmap) so we don't ship single-observation summaries.
 */
export const REGIMES_MIN_PERIODS = 3;

export type RegimesEquityLabel = (typeof REGIMES_EQUITY_LABELS)[number];
export type RegimesVolLabel = (typeof REGIMES_VOL_LABELS)[number];
export type RegimesVolBucket = RegimesVolLabel | "Overall";
export type RegimesPromptLabel = (typeof REGIMES_FIXED_PROMPTS)[number];

export type RegimesMarketFilter = "All" | string;
export type RegimesModelFilter = "All" | string;
export type RegimesPromptFilter = "All" | RegimesPromptLabel;

export interface RegimesFilterSet {
  market: RegimesMarketFilter;
  model: RegimesModelFilter;
  prompt: RegimesPromptFilter;
}

export interface RegimesHeatmapCell {
  model: string;
  prompt: RegimesPromptLabel;
  equity: RegimesEquityLabel;
  vol: RegimesVolBucket;
  meanExcessPp: number | null;
  nRuns: number;
  nPeriods: number;
  nMarkets: number;
}

export interface RegimesBehaviouralRow {
  model: string;
  prompt: RegimesPromptLabel;
  equity: RegimesEquityLabel;
  feature: "equity_share" | "hhi";
  mean: number | null;
  sem: number | null;
  nRuns: number;
  nPeriods: number;
  nMarkets: number;
}

export function regimesNormalizeEquityRegimeLabel(label: unknown): RegimesEquityLabel | null {
  const raw = String(label ?? "").trim();
  if (!raw) return null;
  if (raw === "Bear" || raw === "Flat" || raw === "Bull") return raw;
  return null;
}

export function regimesNormalizeVolLabel(label: unknown): RegimesVolLabel | null {
  const raw = String(label ?? "").trim();
  if (!raw) return null;
  if (raw === "Low" || raw === "Elevated" || raw === "High") return raw;
  return null;
}

export function regimesIsValidPrompt(value: string): value is RegimesPromptLabel {
  return value === "simple" || value === "advanced";
}

export function regimesPeriodKey(
  market: string | null | undefined,
  period: string | null | undefined
) {
  return `${String(market ?? "").trim()}::${String(period ?? "").trim()}`;
}

export function regimesRunReturn(run: RunRow): number | null {
  const candidates = [run.period_return, run.net_return, run.period_return_net];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function regimesRunHhi(run: RunRow): number | null {
  const value = run.hhi;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Stable identity for a RunRow used as a Map key when joining run-level derived data
 * (e.g. equity share) back to runs. Prefers any explicit run/path/trajectory id and
 * falls back to a tuple key so two distinct rows that genuinely lack ids still get
 * distinct (best-effort) keys instead of colliding on the same null.
 */
export function regimesRunIdentity(run: RunRow): string {
  const candidate = run.run_id ?? run.path_id ?? run.trajectory_id ?? null;
  if (candidate != null) return String(candidate);
  return [
    String(run.market ?? ""),
    String(run.period ?? ""),
    String(run.model ?? ""),
    String(run.prompt_type ?? ""),
    String(run.strategy_key ?? ""),
  ].join("::");
}

export function regimesRunMatchesFilters(
  run: RunRow,
  filters: RegimesFilterSet
): boolean {
  if (filters.market !== "All" && String(run.market ?? "") !== filters.market) return false;
  if (filters.model !== "All" && String(run.model ?? "") !== filters.model) return false;
  if (filters.prompt !== "All") {
    const normalized = normalizePromptType(run.prompt_type);
    if (normalized !== filters.prompt) return false;
  }
  return true;
}

/**
 * Builds a "market::period" -> mean index period_return lookup for excess-return
 * calculations.
 *
 * If multiple "index" runs land on the same (market, period) — typically because
 * sub-prompts (e.g. "index_simple", "index_advanced") all share strategy_key="index"
 * but record slightly different returns — we average them. First-wins would otherwise
 * make the excess number depend on row ordering, which is non-deterministic between
 * loads.
 */
export function buildIndexReturnLookup(runs: RunRow[]): Map<string, number> {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const run of runs) {
    if (String(run.strategy_key ?? "") !== "index") continue;
    const ret = regimesRunReturn(run);
    if (ret == null) continue;
    const key = regimesPeriodKey(run.market, run.period);
    const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += ret;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const lookup = new Map<string, number>();
  for (const [key, bucket] of buckets) {
    if (bucket.count > 0) lookup.set(key, bucket.sum / bucket.count);
  }
  return lookup;
}

/**
 * Computes the equity share of a run by parsing its portfolio_json (or fallback fields)
 * and dividing the weight of equity-classified tickers by the sum of weights of
 * *classified* tickers. Returns null when no weights can be parsed or when no parsed
 * tickers are present in the asset-class lookup.
 *
 * Policy notes:
 * - Tickers not present in `tickerToAssetClass` are excluded from both numerator and
 *   denominator. Including them in the denominator only would silently dilute equity
 *   share whenever the lookup is incomplete; excluding them entirely yields a ratio
 *   over the *known* portion of the portfolio, which is what the chart caption claims.
 * - Short positions (weight < 0) are still ignored, mirroring the rest of the
 *   holdings-share UI which assumes long-only weights.
 */
export function computeRunEquityShare(
  run: RunRow,
  tickerToAssetClass: Map<string, string> | null
): number | null {
  if (!tickerToAssetClass || tickerToAssetClass.size === 0) return null;

  const entries = parseRunHoldingsEntries(run);
  if (entries.length === 0) return null;

  let knownWeight = 0;
  let equityWeight = 0;
  for (const entry of entries) {
    const ticker = entry.ticker.trim().toUpperCase();
    if (!ticker || !(entry.weight > 0)) continue;
    const cls = tickerToAssetClass.get(ticker);
    if (!cls) continue;
    knownWeight += entry.weight;
    if (cls.toLowerCase() === "equity") {
      equityWeight += entry.weight;
    }
  }

  if (!(knownWeight > 0)) return null;
  return equityWeight / knownWeight;
}

/**
 * Excess-return heatmap cells: one cell per (model, prompt, equity, vol).
 * - 6 rows: 3 models x 2 prompts (simple/advanced)
 * - 9 (equity, vol) cells per row + 1 synthetic vol="Overall" column
 *
 * Returns one entry per cell, including cells with no runs (so the table can render hatched
 * cells consistently).
 */
export function buildExcessReturnHeatmapCells(
  runs: RunRow[],
  indexLookup: Map<string, number>,
  filters: RegimesFilterSet
): RegimesHeatmapCell[] {
  type CellAccumulator = {
    excess: number[];
    periods: Set<string>;
    markets: Set<string>;
  };
  const cells = new Map<string, CellAccumulator>();
  const cellKey = (
    model: string,
    prompt: RegimesPromptLabel,
    equity: RegimesEquityLabel,
    vol: RegimesVolBucket
  ) => `${model}::${prompt}::${equity}::${vol}`;

  for (const run of runs) {
    const strategyKey = String(run.strategy_key ?? "");
    if (strategyKey !== "gpt_simple" && strategyKey !== "gpt_advanced") continue;
    if (!regimesRunMatchesFilters(run, filters)) continue;

    const prompt = normalizePromptType(run.prompt_type);
    if (!regimesIsValidPrompt(prompt)) continue;
    if (filters.prompt !== "All" && prompt !== filters.prompt) continue;
    const model = String(run.model ?? "").trim();
    if (!model) continue;

    const equityLabel = regimesNormalizeEquityRegimeLabel(run.market_regime_label);
    const volLabel = regimesNormalizeVolLabel(run.vol_regime_label);
    if (!equityLabel) continue;

    const ret = regimesRunReturn(run);
    if (ret == null) continue;
    const indexReturn = indexLookup.get(regimesPeriodKey(run.market, run.period));
    if (indexReturn == null) continue;
    const excessPp = (ret - indexReturn) * 100;

    const market = String(run.market ?? "");
    const period = String(run.period ?? "");

    const targetVols: RegimesVolBucket[] = ["Overall"];
    if (volLabel) targetVols.push(volLabel);

    for (const targetVol of targetVols) {
      const key = cellKey(model, prompt, equityLabel, targetVol);
      const bucket =
        cells.get(key) ?? {
          excess: [],
          periods: new Set<string>(),
          markets: new Set<string>(),
        };
      bucket.excess.push(excessPp);
      if (period) bucket.periods.add(`${market}::${period}`);
      if (market) bucket.markets.add(market);
      cells.set(key, bucket);
    }
  }

  const ALL_VOL_BUCKETS = [...REGIMES_VOL_LABELS, "Overall"] as readonly RegimesVolBucket[];

  // Build a fixed grid so missing cells render as hatched/empty rather than disappearing.
  const result: RegimesHeatmapCell[] = [];
  for (const model of REGIMES_FIXED_MODELS) {
    for (const prompt of REGIMES_FIXED_PROMPTS) {
      for (const equity of REGIMES_EQUITY_LABELS) {
        for (const vol of ALL_VOL_BUCKETS) {
          const bucket = cells.get(cellKey(model, prompt, equity, vol));
          const nRuns = bucket?.excess.length ?? 0;
          result.push({
            model,
            prompt,
            equity,
            vol,
            meanExcessPp:
              nRuns > 0
                ? (bucket!.excess.reduce((sum, value) => sum + value, 0) / nRuns)
                : null,
            nRuns,
            nPeriods: bucket?.periods.size ?? 0,
            nMarkets: bucket?.markets.size ?? 0,
          });
        }
      }
    }
  }

  // Carry through any (model, prompt) combinations present in runs but not in the fixed list,
  // so e.g. a future model still surfaces. Only emit cells that actually have runs — we
  // don't fabricate empty rows for unknown models.
  const seenModels = new Set<string>(REGIMES_FIXED_MODELS as readonly string[]);
  for (const key of cells.keys()) {
    const [model] = key.split("::");
    if (!model || seenModels.has(model)) continue;
    seenModels.add(model);
    for (const prompt of REGIMES_FIXED_PROMPTS) {
      for (const equity of REGIMES_EQUITY_LABELS) {
        for (const vol of ALL_VOL_BUCKETS) {
          const bucket = cells.get(cellKey(model, prompt, equity, vol));
          if (!bucket || bucket.excess.length === 0) continue;
          const nRuns = bucket.excess.length;
          result.push({
            model,
            prompt,
            equity,
            vol,
            meanExcessPp:
              bucket.excess.reduce((sum, value) => sum + value, 0) / nRuns,
            nRuns,
            nPeriods: bucket.periods.size,
            nMarkets: bucket.markets.size,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Behavioural-response rows for the 3x2 grid: per (model, prompt, equity-regime), the mean and
 * standard error of equity_share and HHI across runs.
 */
export function buildBehaviouralResponseRows(
  runs: RunRow[],
  equityShareByRun: Map<string, number | null>,
  filters: RegimesFilterSet
): RegimesBehaviouralRow[] {
  type FeatureBucket = {
    values: number[];
    periods: Set<string>;
    markets: Set<string>;
  };
  type GroupBucket = {
    equity_share: FeatureBucket;
    hhi: FeatureBucket;
  };
  const groups = new Map<string, GroupBucket>();
  const groupKey = (model: string, prompt: RegimesPromptLabel, equity: RegimesEquityLabel) =>
    `${model}::${prompt}::${equity}`;

  for (const run of runs) {
    const strategyKey = String(run.strategy_key ?? "");
    if (strategyKey !== "gpt_simple" && strategyKey !== "gpt_advanced") continue;
    if (!regimesRunMatchesFilters(run, filters)) continue;

    const prompt = normalizePromptType(run.prompt_type);
    if (!regimesIsValidPrompt(prompt)) continue;
    // Filter at the row level too — otherwise a non-"All" prompt filter still leaks the
    // other prompt's runs into the bucket totals.
    if (filters.prompt !== "All" && prompt !== filters.prompt) continue;
    const model = String(run.model ?? "").trim();
    if (!model) continue;

    const equityLabel = regimesNormalizeEquityRegimeLabel(run.market_regime_label);
    if (!equityLabel) continue;

    const market = String(run.market ?? "");
    const period = String(run.period ?? "");
    const key = groupKey(model, prompt, equityLabel);
    const bucket =
      groups.get(key) ??
      ({
        equity_share: { values: [], periods: new Set<string>(), markets: new Set<string>() },
        hhi: { values: [], periods: new Set<string>(), markets: new Set<string>() },
      } as GroupBucket);

    const equityShare = equityShareByRun.get(regimesRunIdentity(run));
    if (typeof equityShare === "number" && Number.isFinite(equityShare)) {
      bucket.equity_share.values.push(equityShare);
      if (period) bucket.equity_share.periods.add(`${market}::${period}`);
      if (market) bucket.equity_share.markets.add(market);
    }
    const hhi = regimesRunHhi(run);
    if (hhi != null) {
      bucket.hhi.values.push(hhi);
      if (period) bucket.hhi.periods.add(`${market}::${period}`);
      if (market) bucket.hhi.markets.add(market);
    }

    groups.set(key, bucket);
  }

  const rows: RegimesBehaviouralRow[] = [];
  const summarize = (values: number[]): { mean: number | null; sem: number | null } => {
    if (values.length === 0) return { mean: null, sem: null };
    const m = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (values.length < 2) return { mean: m, sem: null };
    const variance =
      values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
    return { mean: m, sem: Math.sqrt(variance) / Math.sqrt(values.length) };
  };

  // Always emit the fixed grid (3 models x 2 prompts x 3 regimes x 2 features = 36 rows) so missing
  // cells appear as omitted bars rather than collapsing the layout.
  const knownModels = new Set<string>(REGIMES_FIXED_MODELS as readonly string[]);
  for (const key of groups.keys()) {
    knownModels.add(key.split("::")[0]);
  }

  for (const model of knownModels) {
    for (const prompt of REGIMES_FIXED_PROMPTS) {
      for (const equity of REGIMES_EQUITY_LABELS) {
        const bucket = groups.get(groupKey(model, prompt, equity));
        const equitySummary = summarize(bucket?.equity_share.values ?? []);
        const hhiSummary = summarize(bucket?.hhi.values ?? []);
        rows.push({
          model,
          prompt,
          equity,
          feature: "equity_share",
          mean: equitySummary.mean,
          sem: equitySummary.sem,
          nRuns: bucket?.equity_share.values.length ?? 0,
          nPeriods: bucket?.equity_share.periods.size ?? 0,
          nMarkets: bucket?.equity_share.markets.size ?? 0,
        });
        rows.push({
          model,
          prompt,
          equity,
          feature: "hhi",
          mean: hhiSummary.mean,
          sem: hhiSummary.sem,
          nRuns: bucket?.hhi.values.length ?? 0,
          nPeriods: bucket?.hhi.periods.size ?? 0,
          nMarkets: bucket?.hhi.markets.size ?? 0,
        });
      }
    }
  }

  return rows;
}
