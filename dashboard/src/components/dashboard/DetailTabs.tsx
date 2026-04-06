import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, ChevronLeft, ChevronRight, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDailyHoldings, getEquityChart, getFactorExposureChart, getRegimeChart } from "@/lib/api-client";
import {
  buildStrategySummaryWithRunSharpe,
  collectPathIdsForStrategyMarket,
} from "@/lib/data-loader";
import { CHART_COLORS, COLORS, MARKET_LABELS, getStrategyColor, sharpeColor } from "@/lib/constants";
import type {
  FactorExposureRow,
  HoldingDailyRow,
  RegimeRow,
  StrategyDailyRow,
} from "@/lib/api-types";
import type { BehaviorRow, EvaluationData, RunRow, StrategyRow } from "@/lib/types";
import { KpiCard } from "./KpiCard";
import { SectionHeader, SoftHr } from "./SectionHeader";

interface BaseTabProps {
  data: EvaluationData;
  runs: RunRow[];
  marketFilter: string;
}

interface SelectionState {
  selectedMarket: string;
  setSelectedMarket: (value: string) => void;
  strategyOptions: StrategySelectOption[];
  selectedStrategyKey: string;
  setSelectedStrategyKey: (value: string) => void;
  marketOptions: string[];
}

interface StrategySelectOption {
  strategy_key: string;
  strategy: string;
  source_type: string;
}

interface StrategyStatsRow {
  strategyKey: string;
  strategy: string;
  n: number;
  meanSharpe: number | null;
  sharpeStdDev: number | null;
  sharpeCi95: number | null;
  meanReturn: number | null;
  returnStdDev: number | null;
  returnCi95: number | null;
  deltaVsIndex: number | null;
  effectSizeVsIndex: number | null;
}

const DAILY_STRATEGY_ORDER = [
  "index",
  "equal_weight",
  "sixty_forty",
  "mean_variance",
  "fama_french",
  "gpt_retail",
  "gpt_advanced",
] as const;

const DEFAULT_PAGE_SIZE = 15;

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "rgba(255, 255, 252, 0.96)",
    border: "1px solid rgba(232, 224, 217, 0.96)",
    borderRadius: 14,
    boxShadow: "0 12px 24px rgba(121, 101, 79, 0.08)",
    fontSize: 11,
    color: "#6f6762",
  },
  labelStyle: {
    color: "#9b938b",
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  itemStyle: { color: "#6f6762" },
};

function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`dashboard-panel-strong rounded-[20px] p-4 md:p-5 ${className}`}>
      {children}
    </div>
  );
}

function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <Panel className="flex min-h-[260px] items-center justify-center">
      <div className="max-w-lg text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.7)]">
          <AlertCircle className="h-5 w-5 text-[#b39a91]" />
        </div>
        <p className="mt-4 text-[14px] font-semibold tracking-[-0.03em] text-[#625c58]">
          {title}
        </p>
        <p className="mt-2 text-[12px] leading-5 text-[#9c948c]">{body}</p>
      </div>
    </Panel>
  );
}

function LoadingState({
  title,
}: {
  title: string;
}) {
  return (
    <Panel className="flex min-h-[260px] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.7)]">
          <Database className="h-5 w-5 text-[#b39a91]" />
        </div>
        <p className="mt-4 text-[14px] font-semibold tracking-[-0.03em] text-[#625c58]">
          {title}
        </p>
        <p className="mt-2 text-[12px] leading-5 text-[#9c948c]">
          Fetching live data from the read-only API.
        </p>
      </div>
    </Panel>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="min-w-[150px] flex-1">
      <span className="dashboard-label mb-2 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-[14px] border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.72)] px-3 py-2.5 text-[12px] font-medium text-[#6f6863] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] outline-none disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatStrategyLabel(label: string) {
  return label
    .replace("GPT (", "")
    .replace(")", "")
    .replace("prompting", "Prompt")
    .replace("Advanced Prompting", "Advanced")
    .replace("Advanced prompting", "Advanced")
    .replace("Retail prompt", "Retail")
    .replace(" (market-matched)", "")
    .replace(" proxy", "")
    .trim();
}

function formatPctFromRatio(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return `${(value * 100).toFixed(digits)}%`;
}

function formatPctFromNumber(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }

  return `${value.toFixed(digits)}%`;
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getRunExplorerKey(run: RunRow): string {
  if (run.path_id != null && String(run.path_id).length > 0) {
    return `path:${String(run.path_id)}`;
  }
  if (run.run_id != null && String(run.run_id).length > 0) {
    return `run:${String(run.run_id)}:${run.strategy_key ?? ""}:${run.market ?? ""}:${run.period ?? ""}:${run.model ?? ""}`;
  }
  return `row:${run.strategy_key ?? ""}-${run.market ?? ""}-${run.period ?? ""}-${run.model ?? ""}-${run.prompt_type ?? ""}`;
}

function singlePathEquitySeries(rows: StrategyDailyRow[]) {
  const sorted = [...rows].sort((left, right) => left.date.localeCompare(right.date));
  const firstValue = sorted.find((row) => row.portfolio_value != null)?.portfolio_value ?? null;

  return sorted.map((row) => ({
    date: row.date,
    portfolioValue: row.portfolio_value,
    drawdown: row.drawdown,
    dailyReturn: row.daily_return,
    activeHoldings: row.active_holdings,
    indexBase100:
      firstValue != null && row.portfolio_value != null && firstValue !== 0
        ? (row.portfolio_value / firstValue) * 100
        : null,
  }));
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function stdDev(values: number[]) {
  if (values.length < 2) {
    return null;
  }

  const average = mean(values);
  if (average == null) {
    return null;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance);
}

/** GPT run-level Sharpe histogram (light-theme friendly blues / ambers) */
const SHARPE_HIST_COLORS = {
  gptRetail: "#3d6ea8",
  gptAdvanced: "#b5652b",
  equalWeight: "#4896a8",
  meanVariance: "#8b7cb5",
  index: "#b8964d",
} as const;

interface SharpeHistBin {
  lo: number;
  hi: number;
  name: string;
  mid: number;
  retail: number;
  advanced: number;
}

function filterRunsForMarketFilter(runs: RunRow[], marketFilter: string): RunRow[] {
  if (marketFilter === "All") return runs;
  return runs.filter((r) => r.market === marketFilter);
}

function runStrategySharpes(runs: RunRow[], strategyKey: string): number[] {
  return runs
    .filter((r) => r.strategy_key === strategyKey)
    .map((r) => asNumber(r.sharpe_ratio))
    .filter((v): v is number => v != null && Number.isFinite(v));
}

function buildSharpeHistogramBins(
  retail: number[],
  advanced: number[],
  binWidth: number,
  domainPad: [number, number] = [-2.25, 10],
): SharpeHistBin[] {
  const all = [...retail, ...advanced];
  if (all.length === 0) return [];
  let lo = Math.min(domainPad[0], ...all) - binWidth * 0.25;
  let hi = Math.max(domainPad[1], ...all) + binWidth * 0.25;
  lo = Math.min(lo, domainPad[0]);
  hi = Math.max(hi, domainPad[1]);
  lo = Math.floor(lo / binWidth) * binWidth;
  hi = Math.ceil(hi / binWidth) * binWidth;
  const out: SharpeHistBin[] = [];
  for (let x = lo; x < hi - 1e-12; x += binWidth) {
    const h = Math.min(x + binWidth, hi);
    const last = Math.abs(h - hi) < 1e-9;
    const inBin = (v: number) =>
      last ? v >= x && v <= h + 1e-12 : v >= x && v < h;
    out.push({
      lo: x,
      hi: h,
      mid: (x + h) / 2,
      name: `${x.toFixed(2)}–${h.toFixed(2)}`,
      retail: retail.filter(inBin).length,
      advanced: advanced.filter(inBin).length,
    });
  }
  return out;
}

function binNameForSharpeValue(bins: SharpeHistBin[], v: number): string | null {
  if (!bins.length) return null;
  const idx = bins.findIndex((bin, i) => {
    const last = i === bins.length - 1;
    return v >= bin.lo && (last ? v <= bin.hi + 1e-12 : v < bin.hi);
  });
  return idx >= 0 ? bins[idx]!.name : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value)))
  );
}

function normalizePathId(value: string | number | null | undefined): string | null {
  if (value == null || value === "") {
    return null;
  }

  return String(value);
}

function findRunForPortfolioPath(
  runs: RunRow[],
  pathId: string,
  market: string,
  strategyKey: string
): RunRow | null {
  if (!pathId) {
    return null;
  }

  const matchScoped = runs.find(
    (r) =>
      normalizePathId(r.path_id) === pathId &&
      r.market === market &&
      r.strategy_key === strategyKey
  );
  if (matchScoped) {
    return matchScoped;
  }

  return runs.find((r) => normalizePathId(r.path_id) === pathId) ?? null;
}

function optionalRunStringField(run: RunRow, keys: string[]): string | null {
  const row = run as Record<string, unknown>;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

const KNOWN_MARKET_ORDER = ["us", "germany", "japan"] as const;

function collectAllMarkets(data: EvaluationData): string[] {
  const set = new Set<string>();
  for (const m of data.filters?.markets ?? []) {
    if (m) set.add(m);
  }
  for (const m of data.meta?.available_markets ?? []) {
    if (m) set.add(m);
  }
  for (const run of data.runs ?? []) {
    if (run.market) set.add(run.market);
  }
  for (const row of data.summary_rows ?? []) {
    if (row.market) set.add(row.market);
  }
  for (const row of data.factor_style_rows ?? []) {
    if (row.market) set.add(row.market);
  }
  for (const p of data.periods ?? []) {
    if (p.market) set.add(p.market);
  }

  const list = Array.from(set);
  return list.sort((a, b) => {
    const ia = (KNOWN_MARKET_ORDER as readonly string[]).indexOf(a);
    const ib = (KNOWN_MARKET_ORDER as readonly string[]).indexOf(b);
    const aKnown = ia !== -1;
    const bKnown = ib !== -1;
    if (aKnown && bKnown) return ia - ib;
    if (aKnown) return -1;
    if (bKnown) return 1;
    return a.localeCompare(b);
  });
}

function getMarketOptions(data: EvaluationData, marketFilter: string) {
  const all = collectAllMarkets(data);
  if (all.length > 0) {
    return all;
  }
  return marketFilter !== "All" ? [marketFilter] : [];
}

function strategyOrder(key: string) {
  const index = DAILY_STRATEGY_ORDER.indexOf(
    key as (typeof DAILY_STRATEGY_ORDER)[number]
  );
  return index === -1 ? DAILY_STRATEGY_ORDER.length : index;
}

function getStrategyOptions(data: EvaluationData, market: string) {
  const options = new Map<string, StrategySelectOption>();

  for (const row of data.summary_rows) {
    if (market && row.market !== market) {
      continue;
    }

    if (!options.has(row.strategy_key)) {
      options.set(row.strategy_key, {
        strategy_key: row.strategy_key,
        strategy: row.strategy,
        source_type: row.source_type,
      });
    }
  }

  return Array.from(options.values()).sort((left, right) => {
    const byOrder = strategyOrder(left.strategy_key) - strategyOrder(right.strategy_key);
    if (byOrder !== 0) {
      return byOrder;
    }

    return left.strategy.localeCompare(right.strategy);
  });
}

function defaultStrategyKey(options: StrategySelectOption[]) {
  return (
    DAILY_STRATEGY_ORDER.find((key) =>
      options.some((option) => option.strategy_key === key)
    ) ?? options[0]?.strategy_key ?? ""
  );
}

function useDailySelection(data: EvaluationData, marketFilter: string): SelectionState {
  const marketOptions = useMemo(
    () => getMarketOptions(data, marketFilter),
    [data, marketFilter]
  );
  const [selectedMarket, setSelectedMarket] = useState("");
  const [selectedStrategyKey, setSelectedStrategyKey] = useState("");

  useEffect(() => {
    setSelectedMarket((current) => {
      if (marketFilter !== "All" && marketOptions.includes(marketFilter)) {
        return marketFilter;
      }
      if (marketOptions.includes(current)) {
        return current;
      }
      return marketOptions[0] ?? "";
    });
  }, [marketOptions, marketFilter]);

  const strategyOptions = useMemo(
    () => getStrategyOptions(data, selectedMarket),
    [data, selectedMarket]
  );

  useEffect(() => {
    setSelectedStrategyKey((current) =>
      strategyOptions.some((option) => option.strategy_key === current)
        ? current
        : defaultStrategyKey(strategyOptions)
    );
  }, [strategyOptions]);

  return {
    selectedMarket,
    setSelectedMarket,
    strategyOptions,
    selectedStrategyKey,
    setSelectedStrategyKey,
    marketOptions,
  };
}

function aggregateDailyRows(rows: StrategyDailyRow[]) {
  const grouped = new Map<
    string,
    {
      date: string;
      values: number[];
      drawdowns: number[];
      activeHoldings: number[];
      pathIds: Set<string>;
    }
  >();

  for (const row of rows) {
    const bucket =
      grouped.get(row.date) ??
      {
        date: row.date,
        values: [],
        drawdowns: [],
        activeHoldings: [],
        pathIds: new Set<string>(),
      };

    if (row.portfolio_value != null) {
      bucket.values.push(row.portfolio_value);
    }
    if (row.drawdown != null) {
      bucket.drawdowns.push(row.drawdown);
    }
    if (row.active_holdings != null) {
      bucket.activeHoldings.push(row.active_holdings);
    }
    bucket.pathIds.add(row.path_id);
    grouped.set(row.date, bucket);
  }

  return Array.from(grouped.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bucket) => ({
      date: bucket.date,
      portfolioValue: mean(bucket.values),
      drawdown: mean(bucket.drawdowns),
      activeHoldings: mean(bucket.activeHoldings),
      pathCount: bucket.pathIds.size,
    }));
}

function aggregateFactorRows(rows: FactorExposureRow[]) {
  const grouped = new Map<
    string,
    {
      date: string;
      size: number[];
      value: number[];
      momentum: number[];
      lowRisk: number[];
      quality: number[];
    }
  >();

  for (const row of rows) {
    const bucket =
      grouped.get(row.date) ??
      {
        date: row.date,
        size: [],
        value: [],
        momentum: [],
        lowRisk: [],
        quality: [],
      };

    if (row.portfolio_size_exposure != null) bucket.size.push(row.portfolio_size_exposure);
    if (row.portfolio_value_exposure != null) bucket.value.push(row.portfolio_value_exposure);
    if (row.portfolio_momentum_exposure != null) bucket.momentum.push(row.portfolio_momentum_exposure);
    if (row.portfolio_low_risk_exposure != null) bucket.lowRisk.push(row.portfolio_low_risk_exposure);
    if (row.portfolio_quality_exposure != null) bucket.quality.push(row.portfolio_quality_exposure);

    grouped.set(row.date, bucket);
  }

  return Array.from(grouped.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bucket) => ({
      date: bucket.date,
      size: mean(bucket.size),
      value: mean(bucket.value),
      momentum: mean(bucket.momentum),
      lowRisk: mean(bucket.lowRisk),
      quality: mean(bucket.quality),
    }));
}

function aggregateRegimeRows(rows: RegimeRow[]) {
  const grouped = new Map<
    string,
    {
      date: string;
      drawdowns: number[];
      dailyReturns: number[];
      regimeChanges: number[];
      marketRegimeLabel: string | null;
    }
  >();

  for (const row of rows) {
    const bucket =
      grouped.get(row.date) ??
      {
        date: row.date,
        drawdowns: [],
        dailyReturns: [],
        regimeChanges: [],
        marketRegimeLabel: row.market_regime_label,
      };

    if (row.drawdown != null) bucket.drawdowns.push(row.drawdown);
    if (row.daily_return != null) bucket.dailyReturns.push(row.daily_return);
    if (row.any_regime_changed != null) bucket.regimeChanges.push(row.any_regime_changed);
    if (!bucket.marketRegimeLabel) bucket.marketRegimeLabel = row.market_regime_label;

    grouped.set(row.date, bucket);
  }

  return Array.from(grouped.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bucket) => ({
      date: bucket.date,
      drawdown: mean(bucket.drawdowns),
      dailyReturn: mean(bucket.dailyReturns),
      regimeChangeRate: mean(bucket.regimeChanges),
      marketRegimeLabel: bucket.marketRegimeLabel,
    }));
}

function modeString(labels: string[]): string | null {
  if (!labels.length) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  let best = labels[0];
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }

  return best;
}

/** Same shape as aggregateRegimeRows; used when vw_regime_daily has no rows but vw_strategy_daily does (e.g. GPT paths). */
function aggregateStrategyDailyForDrawdown(rows: StrategyDailyRow[]) {
  const grouped = new Map<
    string,
    {
      date: string;
      drawdowns: number[];
      dailyReturns: number[];
      regimeLabels: string[];
    }
  >();

  for (const row of rows) {
    const bucket =
      grouped.get(row.date) ??
      {
        date: row.date,
        drawdowns: [],
        dailyReturns: [],
        regimeLabels: [],
      };

    if (row.drawdown != null) {
      bucket.drawdowns.push(row.drawdown);
    }
    if (row.daily_return != null) {
      bucket.dailyReturns.push(row.daily_return);
    }
    const label = row.market_regime_label?.trim();
    if (label) {
      bucket.regimeLabels.push(label);
    }
    grouped.set(row.date, bucket);
  }

  const sorted = Array.from(grouped.values()).sort((left, right) =>
    left.date.localeCompare(right.date)
  );

  let prevConsensus: string | null = null;
  return sorted.map((bucket) => {
    const marketRegimeLabel = modeString(bucket.regimeLabels);
    let regimeChangeRate = 0;
    if (
      prevConsensus != null &&
      marketRegimeLabel != null &&
      prevConsensus !== marketRegimeLabel
    ) {
      regimeChangeRate = 1;
    }
    if (marketRegimeLabel != null) {
      prevConsensus = marketRegimeLabel;
    }

    return {
      date: bucket.date,
      drawdown: mean(bucket.drawdowns),
      dailyReturn: mean(bucket.dailyReturns),
      regimeChangeRate,
      marketRegimeLabel,
    };
  });
}

function buildStrategyStats(runs: RunRow[]) {
  const groups = new Map<string, { strategy: string; values: RunRow[] }>();

  for (const run of runs) {
    const strategyKey = run.strategy_key ?? "unknown";
    const strategy = run.strategy ?? strategyKey;
    const bucket = groups.get(strategyKey) ?? { strategy, values: [] };
    bucket.values.push(run);
    groups.set(strategyKey, bucket);
  }

  const rows: StrategyStatsRow[] = Array.from(groups.entries()).map(([strategyKey, group]) => {
    const sharpeValues = group.values
      .map((run) => asNumber(run.sharpe_ratio))
      .filter((value): value is number => value != null);
    const returnValues = group.values
      .map((run) => asNumber(run.period_return ?? run.net_return ?? run.period_return_net))
      .filter((value): value is number => value != null);

    const meanSharpe = mean(sharpeValues);
    const sharpeSd = stdDev(sharpeValues);
    const meanReturn = mean(returnValues);
    const returnSd = stdDev(returnValues);

    return {
      strategyKey,
      strategy: group.strategy,
      n: group.values.length,
      meanSharpe,
      sharpeStdDev: sharpeSd,
      sharpeCi95:
        sharpeSd != null && sharpeValues.length > 1
          ? (1.96 * sharpeSd) / Math.sqrt(sharpeValues.length)
          : null,
      meanReturn,
      returnStdDev: returnSd,
      returnCi95:
        returnSd != null && returnValues.length > 1
          ? (1.96 * returnSd) / Math.sqrt(returnValues.length)
          : null,
      deltaVsIndex: null,
      effectSizeVsIndex: null,
    };
  });

  const indexRow = rows.find((row) => row.strategyKey === "index");

  return rows
    .map((row) => {
      if (!indexRow || row.strategyKey === "index" || row.meanSharpe == null || indexRow.meanSharpe == null) {
        return row;
      }

      const pooledSdValues = [row.sharpeStdDev, indexRow.sharpeStdDev].filter(
        (value): value is number => value != null
      );
      const pooledSd = pooledSdValues.length ? mean(pooledSdValues) : null;

      return {
        ...row,
        deltaVsIndex: row.meanSharpe - indexRow.meanSharpe,
        effectSizeVsIndex:
          pooledSd != null && pooledSd > 0
            ? (row.meanSharpe - indexRow.meanSharpe) / pooledSd
            : null,
      };
    })
    .sort((left, right) => (right.meanSharpe ?? -Infinity) - (left.meanSharpe ?? -Infinity));
}

export function SharpeReturnsTab({ data, runs, marketFilter }: BaseTabProps) {
  const summary = data.summary;

  const sharpeHistogramModel = useMemo(() => {
    const scoped = filterRunsForMarketFilter(runs, marketFilter);
    const retail = runStrategySharpes(scoped, "gpt_retail");
    const advanced = runStrategySharpes(scoped, "gpt_advanced");
    let binWidth = 0.42;
    let bins = buildSharpeHistogramBins(retail, advanced, binWidth);
    while (bins.length > 42 && binWidth < 2.5) {
      binWidth += 0.14;
      bins = buildSharpeHistogramBins(retail, advanced, binWidth);
    }
    const retailMean = retail.length ? mean(retail) : null;
    const advancedMean = advanced.length ? mean(advanced) : null;
    const ewMean = mean(runStrategySharpes(scoped, "equal_weight"));
    const mvMean = mean(runStrategySharpes(scoped, "mean_variance"));
    const ixMean = mean(runStrategySharpes(scoped, "index"));
    return {
      retail,
      advanced,
      bins,
      retailMean,
      advancedMean,
      ewMean,
      mvMean,
      ixMean,
    };
  }, [runs, marketFilter]);

  const {
    retail: retailSharpes,
    advanced: advancedSharpes,
    bins: sharpeBins,
    retailMean,
    advancedMean,
    ewMean,
    mvMean,
    ixMean,
  } = sharpeHistogramModel;

  const sharpeMeanMarkers = useMemo(
    () =>
      [
        {
          key: "adv",
          value: advancedMean,
          label: "Mean GPT (Advanced)",
          color: SHARPE_HIST_COLORS.gptAdvanced,
          dashed: true,
        },
        {
          key: "ret",
          value: retailMean,
          label: "Mean GPT (Retail)",
          color: SHARPE_HIST_COLORS.gptRetail,
          dashed: true,
        },
        {
          key: "ew",
          value: ewMean,
          label: "Equal weight μ",
          color: SHARPE_HIST_COLORS.equalWeight,
          dashed: false,
        },
        {
          key: "mv",
          value: mvMean,
          label: "Mean-variance μ",
          color: SHARPE_HIST_COLORS.meanVariance,
          dashed: false,
        },
        {
          key: "ix",
          value: ixMean,
          label: "Market index μ",
          color: SHARPE_HIST_COLORS.index,
          dashed: false,
        },
      ].filter((m) => m.value != null && Number.isFinite(m.value)) as Array<{
        key: string;
        value: number;
        label: string;
        color: string;
        dashed: boolean;
      }>,
    [advancedMean, ewMean, ixMean, mvMean, retailMean],
  );

  const topSharpe = summary[0];
  const bestReturn = [...summary].sort(
    (left, right) =>
      (right.mean_annualized_return ?? -Infinity) - (left.mean_annualized_return ?? -Infinity)
  )[0];
  const lowestVolatility = [...summary]
    .filter((row) => row.mean_volatility != null)
    .sort((left, right) => (left.mean_volatility ?? Infinity) - (right.mean_volatility ?? Infinity))[0];
  const bestBeatRate = [...summary]
    .filter((row) => row.pct_runs_beating_index_sharpe != null)
    .sort(
      (left, right) =>
        (right.pct_runs_beating_index_sharpe ?? -Infinity) -
        (left.pct_runs_beating_index_sharpe ?? -Infinity)
    )[0];

  const scatterData = summary.map((row) => ({
    name: formatStrategyLabel(row.Strategy),
    strategyKey: row.strategy_key,
    volatilityPct: row.mean_volatility != null ? row.mean_volatility * 100 : null,
    annualizedReturnPct:
      row.mean_annualized_return != null ? row.mean_annualized_return * 100 : null,
    meanSharpe: row.mean_sharpe,
    color: getStrategyColor(row.strategy_key),
  }));

  return (
    <div className="space-y-4 pb-1">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Top Sharpe"
          value={topSharpe?.mean_sharpe?.toFixed(2) ?? "—"}
          color={sharpeColor(topSharpe?.mean_sharpe)}
          sub={topSharpe ? formatStrategyLabel(topSharpe.Strategy) : "No strategy data"}
        />
        <KpiCard
          label="Top Annualized Return"
          value={formatPctFromRatio(bestReturn?.mean_annualized_return, 1)}
          color={COLORS.accent}
          sub={bestReturn ? formatStrategyLabel(bestReturn.Strategy) : "No strategy data"}
        />
        <KpiCard
          label="Lowest Volatility"
          value={formatPctFromRatio(lowestVolatility?.mean_volatility, 1)}
          color={COLORS.cyan}
          sub={lowestVolatility ? formatStrategyLabel(lowestVolatility.Strategy) : "No strategy data"}
        />
        <KpiCard
          label="Best Index Beat Rate"
          value={formatPctFromNumber(bestBeatRate?.pct_runs_beating_index_sharpe, 0)}
          color={COLORS.green}
          sub={bestBeatRate ? formatStrategyLabel(bestBeatRate.Strategy) : "No strategy data"}
        />
      </div>

      <SoftHr />

      <SectionHeader>Sharpe Distribution</SectionHeader>
      {retailSharpes.length > 0 || advancedSharpes.length > 0 ? (
        <Panel>
          <p className="dashboard-label mb-2">Distribution of period Sharpe ratios</p>
          <p className="mb-3 text-[11px] leading-5 text-[#8a827a]">
            Overlapping run-level Sharpe counts for GPT portfolios (current market filter).{" "}
            <span className="font-medium text-[#6f6863]">Dashed</span> lines: mean Sharpe for GPT
            (Advanced) and GPT (Retail).{" "}
            <span className="font-medium text-[#6f6863]">Dotted</span>: mean Sharpe across runs for
            equal weight, mean-variance, and market index.
          </p>
          {sharpeMeanMarkers.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 border-b border-[rgba(232,224,217,0.65)] pb-3 text-[10px] font-semibold tracking-tight">
              {sharpeMeanMarkers.map((m) => (
                <span key={m.key} style={{ color: m.color }}>
                  {m.label}: {m.value.toFixed(2)}
                </span>
              ))}
            </div>
          )}
          <ResponsiveContainer width="100%" height={328}>
            <BarChart
              data={sharpeBins}
              margin={{ top: 10, right: 8, left: 4, bottom: 56 }}
              barCategoryGap={0}
              barGap={0}
              barSize={999}
            >
              <CartesianGrid stroke="rgba(200, 192, 184, 0.55)" vertical={false} strokeDasharray="3 6" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 9, fill: "#7a726c" }}
                interval="preserveStartEnd"
                angle={-32}
                textAnchor="end"
                height={54}
                axisLine={{ stroke: "rgba(180, 172, 164, 0.65)" }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10, fill: "#8f8780" }}
                axisLine={false}
                tickLine={false}
                width={36}
                label={{
                  value: "Count",
                  angle: -90,
                  position: "insideLeft",
                  offset: 4,
                  style: { fill: "#9b938b", fontSize: 10, fontWeight: 600 },
                }}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number | undefined, name: string) => [
                  `${value ?? 0} run${value === 1 ? "" : "s"}`,
                  name,
                ]}
                labelFormatter={(label) => `Sharpe bin ${label}`}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#5d5754", paddingTop: 6 }} />
              <Bar
                name="GPT (Retail)"
                dataKey="retail"
                fill={SHARPE_HIST_COLORS.gptRetail}
                fillOpacity={0.55}
                radius={0}
              />
              <Bar
                name="GPT (Advanced)"
                dataKey="advanced"
                fill={SHARPE_HIST_COLORS.gptAdvanced}
                fillOpacity={0.50}
                radius={0}
              />
              {[...sharpeMeanMarkers]
                .sort((a, b) => Number(a.dashed) - Number(b.dashed))
                .map((m) => {
                  const xn = binNameForSharpeValue(sharpeBins, m.value);
                  if (!xn) return null;
                  return (
                    <ReferenceLine
                      key={m.key}
                      x={xn}
                      stroke={m.color}
                      strokeWidth={1.35}
                      strokeDasharray={m.dashed ? "6 5" : "2 4"}
                      strokeOpacity={0.92}
                    />
                  );
                })}
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[10px] text-[#a39b93]">
            X-axis: Sharpe ratio bins (half-open intervals except the right edge of the last bin). Y-axis: number of
            runs in each bin.
          </p>
        </Panel>
      ) : (
        <Panel>
          <p className="text-[12px] leading-5 text-[#8a827a]">
            No GPT run-level Sharpe observations for this market filter. The histogram uses runs with{" "}
            <span className="font-mono text-[11px]">strategy_key</span>{" "}
            <span className="font-mono">gpt_retail</span> or <span className="font-mono">gpt_advanced</span> and a
            numeric <span className="font-mono">sharpe_ratio</span>.
          </p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel>
          <p className="dashboard-label mb-4">Mean Sharpe by strategy</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={summary} margin={{ top: 6, right: 12, left: 12, bottom: 30 }}>
              <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
              <XAxis
                dataKey="Strategy"
                tickFormatter={(value) => formatStrategyLabel(String(value))}
                angle={-18}
                textAnchor="end"
                interval={0}
                height={60}
                tick={{ fontSize: 10, fill: "#8f8780" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number | undefined) =>
                  value != null && Number.isFinite(value) ? value.toFixed(2) : "—"
                }
                labelFormatter={(value) => formatStrategyLabel(String(value))}
              />
              <ReferenceLine y={0} stroke="rgba(192, 180, 170, 0.9)" strokeDasharray="3 6" />
              <Bar dataKey="mean_sharpe" radius={[10, 10, 0, 0]}>
                {summary.map((row) => (
                  <Cell key={row.strategy_key} fill={getStrategyColor(row.strategy_key)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel>
          <p className="dashboard-label mb-4">Risk / return map</p>
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 12, left: 12, bottom: 20 }}>
              <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" strokeDasharray="3 6" />
              <XAxis
                type="number"
                dataKey="volatilityPct"
                name="Volatility"
                unit="%"
                tick={{ fontSize: 10, fill: "#aca49d" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="number"
                dataKey="annualizedReturnPct"
                name="Annualized return"
                unit="%"
                tick={{ fontSize: 10, fill: "#aca49d" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number, _name, item) => {
                  if (item.dataKey === "meanSharpe") {
                    return value?.toFixed(2) ?? "—";
                  }
                  return `${value?.toFixed(1)}%`;
                }}
                cursor={{ strokeDasharray: "3 6" }}
              />
              <Scatter data={scatterData} fill={COLORS.accent}>
                {scatterData.map((row) => (
                  <Cell key={row.strategyKey} fill={row.color} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div className="mt-3 space-y-1 text-[11px] text-[#9a928b]">
            {scatterData.map((row) => (
              <div key={row.strategyKey} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                  {row.name}
                </span>
                <span>
                  Sharpe{" "}
                  {row.meanSharpe != null && Number.isFinite(row.meanSharpe)
                    ? row.meanSharpe.toFixed(2)
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <SectionHeader>Performance Table</SectionHeader>
      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-[11px]">
          <thead>
            <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Strategy</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Sharpe</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Annualized return</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Volatility</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Beat index</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Turnover</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Obs.</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.strategy_key} className="border-b border-[rgba(227,220,214,0.8)] last:border-0">
                <td className="px-3 py-2.5 font-medium text-[#5e5955]">{row.Strategy}</td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums" style={{ color: sharpeColor(row.mean_sharpe) }}>
                  {row.mean_sharpe != null && Number.isFinite(row.mean_sharpe)
                    ? row.mean_sharpe.toFixed(2)
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-right text-[#9f978f]">{formatPctFromRatio(row.mean_annualized_return, 1)}</td>
                <td className="px-3 py-2.5 text-right text-[#9f978f]">{formatPctFromRatio(row.mean_volatility, 1)}</td>
                <td className="px-3 py-2.5 text-right text-[#9f978f]">{formatPctFromNumber(row.pct_runs_beating_index_sharpe, 0)}</td>
                <td className="px-3 py-2.5 text-right text-[#9f978f]">{formatPctFromRatio(row.mean_turnover, 1)}</td>
                <td className="px-3 py-2.5 text-right text-[#9f978f]">{row.n_observations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

const EQUITY_PATH_BATCH = 12;

async function fetchEquitySeriesWithPathFallback(
  experimentId: string,
  market: string,
  strategyKey: string,
  runs: RunRow[]
): Promise<StrategyDailyRow[]> {
  const direct = await getEquityChart({
    experiment_id: experimentId,
    market,
    strategy_key: strategyKey,
  });
  if (direct.length > 0) {
    return direct;
  }

  const pathIds = collectPathIdsForStrategyMarket(runs, market, strategyKey);
  if (pathIds.length === 0) {
    return [];
  }

  const merged: StrategyDailyRow[] = [];
  for (let i = 0; i < pathIds.length; i += EQUITY_PATH_BATCH) {
    const batch = pathIds.slice(i, i + EQUITY_PATH_BATCH);
    const results = await Promise.all(
      batch.map((path_id) =>
        getEquityChart({ experiment_id: experimentId, market, path_id })
      )
    );
    for (const chunk of results) {
      merged.push(...chunk);
    }
  }
  return merged;
}

async function fetchFactorExposuresWithPathFallback(
  experimentId: string,
  market: string,
  strategyKey: string,
  runs: RunRow[]
): Promise<FactorExposureRow[]> {
  const direct = await getFactorExposureChart({
    experiment_id: experimentId,
    market,
    strategy_key: strategyKey,
  });
  if (direct.length > 0) {
    return direct;
  }

  const pathIds = collectPathIdsForStrategyMarket(runs, market, strategyKey);
  if (pathIds.length === 0) {
    return [];
  }

  const merged: FactorExposureRow[] = [];
  for (let i = 0; i < pathIds.length; i += EQUITY_PATH_BATCH) {
    const batch = pathIds.slice(i, i + EQUITY_PATH_BATCH);
    const results = await Promise.all(
      batch.map((path_id) =>
        getFactorExposureChart({ experiment_id: experimentId, market, path_id })
      )
    );
    for (const chunk of results) {
      merged.push(...chunk);
    }
  }
  return merged;
}

export function EquityCurvesTab({ data, runs: _sidebarRuns, marketFilter }: BaseTabProps) {
  void _sidebarRuns;
  const selection = useDailySelection(data, marketFilter);
  const selectedStrategy = selection.strategyOptions.find(
    (option) => option.strategy_key === selection.selectedStrategyKey
  );

  const pathIdsCacheKey = useMemo(
    () =>
      collectPathIdsForStrategyMarket(
        data.runs,
        selection.selectedMarket,
        selection.selectedStrategyKey
      ).join("|"),
    [data.runs, selection.selectedMarket, selection.selectedStrategyKey]
  );

  const equityQuery = useQuery({
    queryKey: [
      "equity-curves",
      data.active_experiment_id,
      selection.selectedMarket,
      selection.selectedStrategyKey,
      pathIdsCacheKey,
    ],
    queryFn: () =>
      fetchEquitySeriesWithPathFallback(
        data.active_experiment_id,
        selection.selectedMarket,
        selection.selectedStrategyKey,
        data.runs
      ),
    enabled: Boolean(selection.selectedMarket && selection.selectedStrategyKey),
    staleTime: 60_000,
  });

  const factorsQuery = useQuery({
    queryKey: [
      "factor-exposures",
      data.active_experiment_id,
      selection.selectedMarket,
      selection.selectedStrategyKey,
      pathIdsCacheKey,
    ],
    queryFn: () =>
      fetchFactorExposuresWithPathFallback(
        data.active_experiment_id,
        selection.selectedMarket,
        selection.selectedStrategyKey,
        data.runs
      ),
    enabled: Boolean(selection.selectedMarket && selection.selectedStrategyKey),
    staleTime: 60_000,
  });

  const curveRows = useMemo(
    () => aggregateDailyRows(equityQuery.data ?? []),
    [equityQuery.data]
  );
  const factorRows = useMemo(
    () => aggregateFactorRows(factorsQuery.data ?? []),
    [factorsQuery.data]
  );

  const pathCount = new Set((equityQuery.data ?? []).map((row) => row.path_id)).size;
  const firstValue = curveRows[0]?.portfolioValue ?? null;
  const lastValue = curveRows[curveRows.length - 1]?.portfolioValue ?? null;
  const totalReturn =
    firstValue != null && lastValue != null && firstValue !== 0
      ? lastValue / firstValue - 1
      : null;
  const maxDrawdown = curveRows.reduce<number | null>((worst, row) => {
    if (row.drawdown == null) {
      return worst;
    }
    return worst == null ? row.drawdown : Math.max(worst, row.drawdown);
  }, null);
  const latestHoldings = curveRows[curveRows.length - 1]?.activeHoldings ?? null;
  const factorSeries = [
    { key: "size", label: "Size", color: CHART_COLORS[0] },
    { key: "value", label: "Value", color: CHART_COLORS[1] },
    { key: "momentum", label: "Momentum", color: CHART_COLORS[2] },
    { key: "lowRisk", label: "Low risk", color: CHART_COLORS[3] },
    { key: "quality", label: "Quality", color: CHART_COLORS[4] },
  ].filter((series) =>
    factorRows.some(
      (row) => asNumber(row[series.key as keyof typeof row]) != null
    )
  );

  return (
    <div className="space-y-4 pb-1">
      <Panel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterSelect
            label="Market"
            value={selection.selectedMarket}
            onChange={selection.setSelectedMarket}
            disabled={selection.marketOptions.length <= 1}
            options={selection.marketOptions.map((market) => ({
              value: market,
              label: MARKET_LABELS[market] ?? market,
            }))}
          />
          <FilterSelect
            label="Strategy"
            value={selection.selectedStrategyKey}
            onChange={selection.setSelectedStrategyKey}
            options={selection.strategyOptions.map((option) => ({
              value: option.strategy_key,
              label: formatStrategyLabel(option.strategy),
            }))}
          />
          <div className="rounded-[16px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.62)] px-4 py-3">
            <p className="dashboard-label">Series source</p>
            <p className="mt-2 text-[13px] font-semibold text-[#5f5955]">
              {selectedStrategy?.source_type === "benchmark" ? "Benchmark daily view" : "Strategy daily view"}
            </p>
            <p className="mt-1 text-[11px] text-[#9b938b]">
              Uses `vw_strategy_daily` (and factor view). If strategy_key returns no rows, paths
              from loaded runs are queried by `path_id` (up to 48 paths, batched).
            </p>
          </div>
          <div className="rounded-[16px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.62)] px-4 py-3">
            <p className="dashboard-label">Loaded rows</p>
            <p className="mt-2 text-[13px] font-semibold text-[#5f5955]">
              {equityQuery.data?.length ?? 0}
            </p>
            <p className="mt-1 text-[11px] text-[#9b938b]">
              {pathCount > 0 ? `${pathCount} path${pathCount === 1 ? "" : "s"} in series` : "Awaiting data"}
            </p>
          </div>
        </div>
      </Panel>

      {equityQuery.isLoading || factorsQuery.isLoading ? (
        <LoadingState title="Loading equity and exposure series" />
      ) : equityQuery.isError ? (
        <EmptyState
          title="Could not load equity series"
          body={String((equityQuery.error as Error)?.message ?? equityQuery.error)}
        />
      ) : curveRows.length === 0 ? (
        <EmptyState
          title="No daily series for this selection"
          body="The API returned no rows for this market and strategy, and no path_id on loaded runs matched (or path-level requests were also empty). Confirm run_results include path_id for GPT runs and that vw_strategy_daily has rows for those paths. Benchmarks often work with strategy_key alone; LLM curves may require populated daily series per path."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard
              label="Total Return"
              value={formatPctFromRatio(totalReturn, 1)}
              color={totalReturn != null && totalReturn >= 0 ? COLORS.green : COLORS.red}
              sub={curveRows.length > 0 ? `${curveRows.length} daily observations` : "—"}
            />
            <KpiCard
              label="Worst Drawdown"
              value={formatPctFromRatio(maxDrawdown, 1)}
              color={COLORS.red}
              sub="Average path drawdown"
            />
            <KpiCard
              label="Live Paths"
              value={String(pathCount)}
              color={COLORS.cyan}
              sub={selectedStrategy ? formatStrategyLabel(selectedStrategy.strategy) : "—"}
            />
            <KpiCard
              label="Active Holdings"
              value={latestHoldings != null ? latestHoldings.toFixed(1) : "—"}
              color={COLORS.amber}
              sub={curveRows[curveRows.length - 1] ? formatDateLabel(curveRows[curveRows.length - 1].date) : "—"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel>
              <p className="dashboard-label mb-4">Average equity curve</p>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={curveRows} margin={{ top: 10, right: 18, left: 6, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateLabel}
                    minTickGap={28}
                    tick={{ fontSize: 10, fill: "#aca49d" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    {...tooltipStyle}
                    labelFormatter={(value) => formatDateLabel(String(value))}
                    formatter={(value: number | null) => (value != null ? value.toFixed(3) : "—")}
                  />
                  <Line
                    type="monotone"
                    dataKey="portfolioValue"
                    stroke={getStrategyColor(selection.selectedStrategyKey)}
                    strokeWidth={2.5}
                    dot={false}
                    name="Portfolio value"
                  />
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            <Panel>
              <p className="dashboard-label mb-4">Latest checkpoints</p>
              <div className="space-y-3">
                {curveRows.slice(-6).reverse().map((row) => (
                  <div
                    key={row.date}
                    className="flex items-center justify-between rounded-[14px] border border-[rgba(232,224,217,0.9)] bg-[rgba(255,255,252,0.56)] px-4 py-3"
                  >
                    <div>
                      <p className="text-[11px] font-semibold text-[#67615d]">{formatDateLabel(row.date)}</p>
                      <p className="mt-1 text-[10px] text-[#9b938b]">
                        Drawdown {formatPctFromRatio(row.drawdown, 1)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-semibold text-[#5f5955]">
                        {row.portfolioValue?.toFixed(3) ?? "—"}
                      </p>
                      <p className="mt-1 text-[10px] text-[#9b938b]">
                        {row.activeHoldings != null ? `${row.activeHoldings.toFixed(1)} holdings` : "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {factorSeries.length > 0 && (
            <>
              <SectionHeader>Factor Exposures</SectionHeader>
              <Panel>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={factorRows} margin={{ top: 10, right: 18, left: 6, bottom: 8 }}>
                    <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDateLabel}
                      minTickGap={28}
                      tick={{ fontSize: 10, fill: "#aca49d" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      {...tooltipStyle}
                      labelFormatter={(value) => formatDateLabel(String(value))}
                      formatter={(value: number | null) => (value != null ? value.toFixed(2) : "—")}
                    />
                    <Legend />
                    {factorSeries.map((series) => (
                      <Line
                        key={series.key}
                        type="monotone"
                        dataKey={series.key}
                        stroke={series.color}
                        strokeWidth={2}
                        dot={false}
                        name={series.label}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function PortfoliosTab({ data, runs: _sidebarFilteredRuns, marketFilter }: BaseTabProps) {
  void _sidebarFilteredRuns;
  const selection = useDailySelection(data, marketFilter);
  const [selectedPathId, setSelectedPathId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [page, setPage] = useState(1);

  const pathOptions = useMemo(() => {
    const seen = new Map<string, { value: string; label: string }>();

    for (const run of data.runs) {
      if (run.market !== selection.selectedMarket || run.strategy_key !== selection.selectedStrategyKey) {
        continue;
      }

      const pid = normalizePathId(run.path_id);
      if (!pid) {
        continue;
      }

      if (!seen.has(pid)) {
        const runLabel =
          run.run_id != null ? `Run ${run.run_id}` : String(run.trajectory_id ?? pid);
        seen.set(pid, { value: pid, label: String(runLabel) });
      }
    }

    return Array.from(seen.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [data.runs, selection.selectedMarket, selection.selectedStrategyKey]);

  useEffect(() => {
    setSelectedPathId((current) =>
      pathOptions.some((option) => option.value === String(current))
        ? String(current)
        : pathOptions[0]?.value ?? ""
    );
  }, [pathOptions]);

  useEffect(() => {
    setSelectedDate("");
    setPage(1);
  }, [selection.selectedMarket, selection.selectedStrategyKey, selectedPathId]);

  const holdingsQuery = useQuery({
    queryKey: [
      "daily-holdings",
      data.active_experiment_id,
      selection.selectedMarket,
      selection.selectedStrategyKey,
      selectedPathId,
      selectedDate,
      page,
    ],
    queryFn: () => {
      const pathId = selectedPathId ? String(selectedPathId) : "";
      const base = {
        experiment_id: data.active_experiment_id,
        date: selectedDate || undefined,
        page,
        page_size: DEFAULT_PAGE_SIZE,
      };
      if (pathId) {
        return getDailyHoldings({
          ...base,
          path_id: pathId,
        });
      }

      return getDailyHoldings({
        ...base,
        market: selection.selectedMarket,
        strategy_key: selection.selectedStrategyKey,
      });
    },
    enabled: Boolean(
      selection.selectedMarket &&
        selection.selectedStrategyKey &&
        (pathOptions.length === 0 || Boolean(selectedPathId))
    ),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (selectedDate || !holdingsQuery.data?.items.length) {
      return;
    }

    const latest = holdingsQuery.data.items
      .map((item) => item.date)
      .sort((left, right) => left.localeCompare(right))
      .at(-1);

    if (latest) {
      setSelectedDate(latest);
      setPage(1);
    }
  }, [holdingsQuery.data, selectedDate]);

  const holdings = holdingsQuery.data?.items ?? [];
  const selectedRun = useMemo(
    () =>
      findRunForPortfolioPath(
        data.runs,
        selectedPathId,
        selection.selectedMarket,
        selection.selectedStrategyKey
      ),
    [data.runs, selectedPathId, selection.selectedMarket, selection.selectedStrategyKey]
  );

  const promptSnippet = useMemo(() => {
    if (!selectedRun) {
      return null;
    }

    return optionalRunStringField(selectedRun, [
      "user_prompt",
      "system_prompt",
      "prompt_body",
      "prompt_text",
      "prompt",
      "messages",
    ]);
  }, [selectedRun]);

  const selectedStrategy = selection.strategyOptions.find(
    (option) => option.strategy_key === selection.selectedStrategyKey
  );
  const topWeight = holdings.reduce<number | null>((current, holding) => {
    if (holding.drifted_weight == null) {
      return current;
    }
    return current == null ? holding.drifted_weight : Math.max(current, holding.drifted_weight);
  }, null);
  const concentration = holdings
    .map((holding) => holding.drifted_weight ?? holding.target_weight)
    .filter((value): value is number => value != null)
    .reduce((sum, value) => sum + value ** 2, 0);
  const sectors = uniqueStrings(holdings.map((holding) => holding.sector));

  return (
    <div className="space-y-4 pb-1">
      <Panel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterSelect
            label="Market"
            value={selection.selectedMarket}
            onChange={selection.setSelectedMarket}
            disabled={selection.marketOptions.length <= 1}
            options={selection.marketOptions.map((market) => ({
              value: market,
              label: MARKET_LABELS[market] ?? market,
            }))}
          />
          <FilterSelect
            label="Strategy"
            value={selection.selectedStrategyKey}
            onChange={selection.setSelectedStrategyKey}
            options={selection.strategyOptions.map((option) => ({
              value: option.strategy_key,
              label: formatStrategyLabel(option.strategy),
            }))}
          />
          <FilterSelect
            label="Path"
            value={selectedPathId}
            onChange={setSelectedPathId}
            disabled={pathOptions.length === 0}
            options={
              pathOptions.length > 0
                ? pathOptions
                : [{ value: "", label: "Benchmark / aggregate path" }]
            }
          />
          <div className="rounded-[16px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.62)] px-4 py-3">
            <p className="dashboard-label">Snapshot date</p>
            <p className="mt-2 text-[13px] font-semibold text-[#5f5955]">
              {selectedDate || "Auto-selecting latest"}
            </p>
            <p className="mt-1 text-[11px] text-[#9b938b]">
              The table pages through `vw_holdings_daily`.
            </p>
          </div>
        </div>
      </Panel>

      {selectedPathId && (
        <Panel>
          <p className="dashboard-label mb-3">Run and prompt context</p>
          {selectedRun ? (
            <>
              <div className="grid gap-2 text-[11px] leading-5 text-[#6f6863] md:grid-cols-2">
                <p>
                  <span className="text-[#b4aca5]">Prompt type</span>{" "}
                  <span className="font-medium text-[#5e5955]">{selectedRun.prompt_type ?? "—"}</span>
                </p>
                <p>
                  <span className="text-[#b4aca5]">Model</span>{" "}
                  <span className="font-medium text-[#5e5955]">{selectedRun.model ?? "—"}</span>
                </p>
                <p>
                  <span className="text-[#b4aca5]">Period</span>{" "}
                  <span className="font-medium text-[#5e5955]">{selectedRun.period ?? "—"}</span>
                </p>
                <p>
                  <span className="text-[#b4aca5]">Run ID</span>{" "}
                  <span className="font-medium text-[#5e5955]">
                    {selectedRun.run_id != null ? String(selectedRun.run_id) : "—"}
                  </span>
                </p>
              </div>
              {promptSnippet ? (
                <div className="mt-4 rounded-[14px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.72)] p-3">
                  <p className="dashboard-label mb-2">Prompt excerpt (from run record)</p>
                  <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[#5e5955]">
                    {promptSnippet.length > 4000 ? `${promptSnippet.slice(0, 4000)}…` : promptSnippet}
                  </pre>
                </div>
              ) : (
                <p className="mt-3 text-[10px] leading-5 text-[#aaa29a]">
                  Full prompt text is not in the run-results payload; it lives in the experiment bundle (
                  <code className="rounded bg-[rgba(0,0,0,0.04)] px-1">llm_runs/*.json</code>) on the server.
                  Holdings below load by <strong>path_id</strong> so retail/advanced portfolios match the equity charts.
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] leading-5 text-[#9d958d]">
              Path <span className="font-mono text-[#5e5955]">{selectedPathId}</span> — no matching run in the
              current filtered run list; holdings still load by path_id only.
            </p>
          )}
        </Panel>
      )}

      {holdingsQuery.isLoading ? (
        <LoadingState title="Loading holdings snapshot" />
      ) : holdings.length === 0 ? (
        <EmptyState
          title="No holdings available"
          body="There is no row in daily_holdings for this path. Holdings are loaded by path_id (same as Equity curves). If this persists, the DB may not export holdings for LLM paths yet—check daily_holdings / vw_holdings_daily for this experiment. You can still verify prompt type and model above when a run matches the path."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard
              label="Positions"
              value={String(holdings.length)}
              color={COLORS.accent}
              sub={selectedStrategy ? formatStrategyLabel(selectedStrategy.strategy) : "—"}
            />
            <KpiCard
              label="Top Weight"
              value={formatPctFromRatio(topWeight, 1)}
              color={COLORS.amber}
              sub={holdings[0] ? formatDateLabel(holdings[0].date) : "—"}
            />
            <KpiCard
              label="Concentration (HHI)"
              value={concentration ? concentration.toFixed(3) : "—"}
              color={concentration > 0.15 ? COLORS.red : COLORS.green}
              sub="From current weights"
            />
            <KpiCard
              label="Sector Breadth"
              value={String(sectors.length)}
              color={COLORS.cyan}
              sub={sectors.slice(0, 2).join(", ") || "No sector tags"}
            />
          </div>

          <Panel className="overflow-x-auto p-0">
            <table className="w-full min-w-[980px] text-[11px]">
              <thead>
                <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Ticker</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Name</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Sector</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Drifted wt</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Target wt</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Contribution</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Price rel.</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Factor labels</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((holding) => (
                  <tr key={`${holding.date}-${holding.ticker}`} className="border-b border-[rgba(227,220,214,0.8)] last:border-0">
                    <td className="px-3 py-2.5 font-medium text-[#5e5955]">{holding.ticker}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">{holding.name ?? "—"}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">{holding.sector ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromRatio(holding.drifted_weight, 1)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromRatio(holding.target_weight, 1)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromRatio(holding.value_contribution_pct, 1)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{holding.price_relative?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">
                      {[holding.size_label, holding.value_label, holding.momentum_label, holding.low_risk_label, holding.quality_label]
                        .filter(Boolean)
                        .join(" / ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <div className="flex items-center justify-between rounded-[18px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.54)] px-4 py-3">
            <div className="text-[11px] text-[#9c948c]">
              Page {holdingsQuery.data?.page ?? 1} of {holdingsQuery.data?.total_pages ?? 1}
              {selectedDate && <span className="ml-2">Latest snapshot: {selectedDate}</span>}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={(holdingsQuery.data?.page ?? 1) <= 1}
                className="rounded-full"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft className="mr-1 h-3 w-3" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(holdingsQuery.data?.page ?? 1) >= (holdingsQuery.data?.total_pages ?? 1)}
                className="rounded-full"
                onClick={() =>
                  setPage((current) =>
                    Math.min(holdingsQuery.data?.total_pages ?? current, current + 1)
                  )
                }
              >
                Next
                <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function RunExplorerTab({ data, runs }: BaseTabProps) {
  const strategyOptions = useMemo(
    () => uniqueStrings(runs.map((run) => run.strategy)).sort(),
    [runs]
  );
  const promptOptions = useMemo(
    () => uniqueStrings(runs.map((run) => run.prompt_type)).sort(),
    [runs]
  );
  const modelOptions = useMemo(
    () => uniqueStrings(runs.map((run) => run.model)).sort(),
    [runs]
  );
  const periodOptions = useMemo(
    () => uniqueStrings(runs.map((run) => run.period)).sort(),
    [runs]
  );

  const [strategyFilter, setStrategyFilter] = useState("All");
  const [promptFilter, setPromptFilter] = useState("All");
  const [modelFilter, setModelFilter] = useState("All");
  const [periodFilter, setPeriodFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [strategyFilter, promptFilter, modelFilter, periodFilter, runs]);

  const filteredRuns = useMemo(() => {
    return runs
      .filter((run) => strategyFilter === "All" || run.strategy === strategyFilter)
      .filter((run) => promptFilter === "All" || run.prompt_type === promptFilter)
      .filter((run) => modelFilter === "All" || run.model === modelFilter)
      .filter((run) => periodFilter === "All" || run.period === periodFilter)
      .sort((left, right) => (asNumber(right.sharpe_ratio) ?? -Infinity) - (asNumber(left.sharpe_ratio) ?? -Infinity));
  }, [runs, strategyFilter, promptFilter, modelFilter, periodFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / 12));
  const pageRows = useMemo(
    () => filteredRuns.slice((page - 1) * 12, page * 12),
    [filteredRuns, page]
  );

  useEffect(() => {
    if (filteredRuns.length === 0) {
      setSelectedRunKey(null);
      return;
    }
    setSelectedRunKey((previous) => {
      if (previous != null && filteredRuns.some((row) => getRunExplorerKey(row) === previous)) {
        return previous;
      }
      const defaultRow = pageRows[0] ?? filteredRuns[0];
      return getRunExplorerKey(defaultRow);
    });
  }, [filteredRuns, pageRows]);

  const selectedRun = useMemo(() => {
    if (!selectedRunKey) {
      return null;
    }
    return filteredRuns.find((row) => getRunExplorerKey(row) === selectedRunKey) ?? null;
  }, [filteredRuns, selectedRunKey]);

  const pathIdForCharts =
    selectedRun?.path_id != null && String(selectedRun.path_id).length > 0
      ? String(selectedRun.path_id)
      : null;

  const runEquityQuery = useQuery({
    queryKey: ["run-explorer-equity", data.active_experiment_id, pathIdForCharts],
    queryFn: () =>
      getEquityChart({
        experiment_id: data.active_experiment_id,
        path_id: pathIdForCharts ?? undefined,
      }),
    enabled: Boolean(data.active_experiment_id && pathIdForCharts),
    staleTime: 60_000,
  });

  const runFactorsQuery = useQuery({
    queryKey: ["run-explorer-factors", data.active_experiment_id, pathIdForCharts],
    queryFn: () =>
      getFactorExposureChart({
        experiment_id: data.active_experiment_id,
        path_id: pathIdForCharts ?? undefined,
      }),
    enabled: Boolean(data.active_experiment_id && pathIdForCharts),
    staleTime: 60_000,
  });

  const runCurveRows = useMemo(
    () => singlePathEquitySeries(runEquityQuery.data ?? []),
    [runEquityQuery.data]
  );

  const runFactorRows = useMemo(
    () => aggregateFactorRows(runFactorsQuery.data ?? []),
    [runFactorsQuery.data]
  );

  const pageComparisonData = useMemo(
    () =>
      pageRows.map((run, index) => ({
        key: getRunExplorerKey(run),
        label:
          run.run_id != null
            ? `#${run.run_id}`
            : `${(page - 1) * 12 + index + 1}`,
        sharpe: asNumber(run.sharpe_ratio),
        periodReturn: asNumber(run.period_return ?? run.net_return ?? run.period_return_net),
        strategyKey: run.strategy_key ?? "",
      })),
    [pageRows, page]
  );

  const runFactorSeries = [
    { key: "size", label: "Size", color: CHART_COLORS[0] },
    { key: "value", label: "Value", color: CHART_COLORS[1] },
    { key: "momentum", label: "Momentum", color: CHART_COLORS[2] },
    { key: "lowRisk", label: "Low risk", color: CHART_COLORS[3] },
    { key: "quality", label: "Quality", color: CHART_COLORS[4] },
  ].filter((series) =>
    runFactorRows.some((row) => asNumber(row[series.key as keyof typeof row]) != null)
  );

  const drawdownGradientId = useId().replace(/:/g, "");

  const validShare =
    filteredRuns.length > 0
      ? (filteredRuns.filter((run) => run.valid !== false && run.valid !== 0).length /
          filteredRuns.length) *
        100
      : null;
  const avgSharpe = mean(
    filteredRuns
      .map((run) => asNumber(run.sharpe_ratio))
      .filter((value): value is number => value != null)
  );
  const avgReturn = mean(
    filteredRuns
      .map((run) => asNumber(run.period_return ?? run.net_return ?? run.period_return_net))
      .filter((value): value is number => value != null)
  );

  return (
    <div className="space-y-4 pb-1">
      <Panel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterSelect
            label="Strategy"
            value={strategyFilter}
            onChange={setStrategyFilter}
            options={[{ value: "All", label: "All strategies" }, ...strategyOptions.map((value) => ({ value, label: formatStrategyLabel(value) }))]}
          />
          <FilterSelect
            label="Prompt"
            value={promptFilter}
            onChange={setPromptFilter}
            options={[{ value: "All", label: "All prompts" }, ...promptOptions.map((value) => ({ value, label: value }))]}
          />
          <FilterSelect
            label="Model"
            value={modelFilter}
            onChange={setModelFilter}
            options={[{ value: "All", label: "All models" }, ...modelOptions.map((value) => ({ value, label: value }))]}
          />
          <FilterSelect
            label="Period"
            value={periodFilter}
            onChange={setPeriodFilter}
            options={[{ value: "All", label: "All periods" }, ...periodOptions.map((value) => ({ value, label: value }))]}
          />
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Visible Runs" value={String(filteredRuns.length)} color={COLORS.accent} sub={`${data.active_experiment_id}`} />
        <KpiCard label="Valid Share" value={formatPctFromNumber(validShare, 0)} color={COLORS.green} sub="Post-validation" />
        <KpiCard label="Avg Sharpe" value={avgSharpe?.toFixed(2) ?? "—"} color={sharpeColor(avgSharpe)} sub="Across current filters" />
        <KpiCard label="Avg Return" value={formatPctFromRatio(avgReturn, 1)} color={avgReturn != null && avgReturn >= 0 ? COLORS.green : COLORS.red} sub="Net period return" />
      </div>

      {pageRows.length === 0 ? (
        <EmptyState title="No runs match the current filters" body="Try widening the prompt, model, or period filters to inspect the full experiment run set." />
      ) : (
        <>
          <SectionHeader>Performance charts</SectionHeader>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <p className="dashboard-label mb-4">This page — Sharpe by run</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={pageComparisonData} margin={{ top: 6, right: 12, left: 12, bottom: 36 }}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#8f8780" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | null) => (value != null ? value.toFixed(2) : "—")}
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload as (typeof pageComparisonData)[0] | undefined;
                      return row ? `Run ${row.label}` : "";
                    }}
                  />
                  <ReferenceLine y={0} stroke="rgba(192, 180, 170, 0.9)" strokeDasharray="3 6" />
                  <Bar dataKey="sharpe" radius={[8, 8, 0, 0]}>
                    {pageComparisonData.map((row) => (
                      <Cell key={row.key} fill={getStrategyColor(row.strategyKey)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-2 text-[10px] text-[#aaa29a]">Runs on the current table page; color follows strategy.</p>
            </Panel>
            <Panel>
              <p className="dashboard-label mb-4">This page — Net period return</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={pageComparisonData} margin={{ top: 6, right: 12, left: 12, bottom: 36 }}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#8f8780" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#aca49d" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number | null) => formatPctFromRatio(value, 2)}
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload as (typeof pageComparisonData)[0] | undefined;
                      return row ? `Run ${row.label}` : "";
                    }}
                  />
                  <ReferenceLine y={0} stroke="rgba(192, 180, 170, 0.9)" strokeDasharray="3 6" />
                  <Bar dataKey="periodReturn" radius={[8, 8, 0, 0]}>
                    {pageComparisonData.map((row) => (
                      <Cell
                        key={row.key}
                        fill={
                          row.periodReturn != null && row.periodReturn >= 0 ? COLORS.green : COLORS.red
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <SectionHeader>Selected run — daily path</SectionHeader>
          {selectedRun && (
            <Panel className="rounded-[20px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.72)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="dashboard-label">Selected</p>
                  <p className="mt-1 text-[13px] font-semibold text-[#5f5955]">
                    {formatStrategyLabel(selectedRun.strategy ?? selectedRun.strategy_key ?? "—")} ·{" "}
                    {MARKET_LABELS[selectedRun.market ?? ""] ?? selectedRun.market ?? "—"}
                  </p>
                  <p className="mt-1 text-[11px] text-[#9b938b]">
                    {selectedRun.period ?? "—"} · {selectedRun.prompt_type ?? "—"} · {selectedRun.model ?? "—"}
                    {selectedRun.run_id != null && <span className="ml-1">· run {selectedRun.run_id}</span>}
                    {pathIdForCharts && <span className="ml-1 font-mono text-[10px]">· path {pathIdForCharts}</span>}
                  </p>
                </div>
                <div className="grid min-w-0 grid-cols-2 gap-2 sm:max-w-md">
                  <KpiCard
                    label="Sharpe"
                    value={selectedRun.sharpe_ratio != null ? selectedRun.sharpe_ratio.toFixed(2) : "—"}
                    color={sharpeColor(selectedRun.sharpe_ratio)}
                    sub="From run_results"
                  />
                  <KpiCard
                    label="Return"
                    value={formatPctFromRatio(
                      asNumber(selectedRun.period_return ?? selectedRun.net_return ?? selectedRun.period_return_net),
                      1
                    )}
                    color={
                      asNumber(selectedRun.period_return ?? selectedRun.net_return ?? selectedRun.period_return_net) !=
                        null &&
                      (asNumber(selectedRun.period_return ?? selectedRun.net_return ?? selectedRun.period_return_net) ??
                        0) >= 0
                        ? COLORS.green
                        : COLORS.red
                    }
                    sub="Net period"
                  />
                </div>
              </div>
            </Panel>
          )}

          {!pathIdForCharts ? (
            <EmptyState
              title="Daily charts need a path id"
              body="This run has no path_id in run_results, so equity and factor series cannot be loaded. Other rows may still have charts."
            />
          ) : runEquityQuery.isLoading ? (
            <LoadingState title="Loading daily series for selected run" />
          ) : runCurveRows.length === 0 ? (
            <EmptyState
              title="No daily series for this path"
              body="The strategy_daily view has no rows for this path. Benchmark and some strategy paths usually have series; check the Equity Curves tab for coverage."
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <Panel>
                  <p className="dashboard-label mb-4">Portfolio value (indexed to 100 at start)</p>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={runCurveRows} margin={{ top: 10, right: 18, left: 6, bottom: 8 }}>
                      <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDateLabel}
                        minTickGap={28}
                        tick={{ fontSize: 10, fill: "#aca49d" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        {...tooltipStyle}
                        labelFormatter={(value) => formatDateLabel(String(value))}
                        formatter={(value: number | null) => (value != null ? value.toFixed(2) : "—")}
                      />
                      <Line
                        type="monotone"
                        dataKey="indexBase100"
                        stroke={getStrategyColor(selectedRun?.strategy_key ?? "")}
                        strokeWidth={2.5}
                        dot={false}
                        name="Index (start = 100)"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Panel>
                <Panel>
                  <p className="dashboard-label mb-4">Drawdown</p>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={runCurveRows} margin={{ top: 10, right: 18, left: 6, bottom: 8 }}>
                      <defs>
                        <linearGradient id={drawdownGradientId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.red} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={COLORS.red} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDateLabel}
                        minTickGap={28}
                        tick={{ fontSize: 10, fill: "#aca49d" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#aca49d" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        labelFormatter={(value) => formatDateLabel(String(value))}
                        formatter={(value: number | null) => formatPctFromRatio(value, 2)}
                      />
                      <Area
                        type="monotone"
                        dataKey="drawdown"
                        stroke={COLORS.red}
                        strokeWidth={1.5}
                        fill={`url(#${drawdownGradientId})`}
                        name="Drawdown"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </Panel>
              </div>

              {runFactorsQuery.isLoading ? (
                <LoadingState title="Loading factor exposures" />
              ) : (
                runFactorSeries.length > 0 && (
                  <Panel>
                    <p className="dashboard-label mb-4">Factor exposures (daily)</p>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={runFactorRows} margin={{ top: 10, right: 18, left: 6, bottom: 8 }}>
                        <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDateLabel}
                          minTickGap={28}
                          tick={{ fontSize: 10, fill: "#aca49d" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                        <Tooltip
                          {...tooltipStyle}
                          labelFormatter={(value) => formatDateLabel(String(value))}
                          formatter={(value: number | null) => (value != null ? value.toFixed(2) : "—")}
                        />
                        <Legend />
                        {runFactorSeries.map((series) => (
                          <Line
                            key={series.key}
                            type="monotone"
                            dataKey={series.key}
                            stroke={series.color}
                            strokeWidth={2}
                            dot={false}
                            name={series.label}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </Panel>
                )
              )}
            </>
          )}

          <SectionHeader>Run table</SectionHeader>
          <Panel className="overflow-x-auto p-0">
            <table className="w-full min-w-[1120px] text-[11px]">
              <thead>
                <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Strategy</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Market / period</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Prompt / model</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Sharpe</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Return</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Holdings</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Regime</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Summary</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((run) => {
                  const rowKey = getRunExplorerKey(run);
                  const isSelected = selectedRunKey === rowKey;
                  return (
                  <tr
                    key={rowKey}
                    className={`cursor-pointer border-b border-[rgba(227,220,214,0.8)] align-top transition-colors last:border-0 hover:bg-[rgba(250,247,243,0.72)] ${
                      isSelected ? "bg-[rgba(244,236,228,0.92)]" : ""
                    }`}
                    onClick={() => setSelectedRunKey(rowKey)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedRunKey(rowKey);
                      }
                    }}
                    tabIndex={0}
                    role="row"
                  >
                    <td className="px-3 py-2.5 font-medium text-[#5e5955]">{formatStrategyLabel(run.strategy ?? run.strategy_key ?? "—")}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">
                      <div>{MARKET_LABELS[run.market ?? ""] ?? run.market ?? "—"}</div>
                      <div className="mt-1 text-[10px] text-[#aaa29a]">{run.period ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2.5 text-[#8d857f]">
                      <div>{run.prompt_type ?? "benchmark"}</div>
                      <div className="mt-1 text-[10px] text-[#aaa29a]">{run.model ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums" style={{ color: sharpeColor(run.sharpe_ratio) }}>
                      {run.sharpe_ratio != null ? run.sharpe_ratio.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">
                      {formatPctFromRatio(run.period_return ?? run.net_return ?? run.period_return_net, 1)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{run.n_holdings ?? "—"}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">{run.market_regime_label ?? "—"}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">
                      <div className="max-w-[320px] whitespace-normal leading-5">
                        {asString(run.reasoning_summary).slice(0, 160) || "No reasoning summary stored"}
                        {asString(run.reasoning_summary).length > 160 ? "..." : ""}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <div className="flex items-center justify-between rounded-[18px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.54)] px-4 py-3">
            <div className="text-[11px] text-[#9c948c]">
              Page {page} of {totalPages}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} className="rounded-full" onClick={() => setPage((current) => Math.max(1, current - 1))}>
                <ChevronLeft className="mr-1 h-3 w-3" />
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} className="rounded-full" onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                Next
                <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ByMarketTab({ data, marketFilter }: BaseTabProps) {
  const markets = getMarketOptions(data, marketFilter);
  const perMarketSummary = markets.map((market) => ({
    market,
    summary: buildStrategySummaryWithRunSharpe(
      data.summary_rows,
      market,
      data.runs
    ),
  }));

  const strategyKeys = Array.from(
    new Set(
      perMarketSummary.flatMap((entry) =>
        entry.summary.map((row) => `${row.strategy_key}::${row.Strategy}`)
      )
    )
  );

  const bestRows = perMarketSummary
    .map((entry) => ({
      market: entry.market,
      row: [...entry.summary].sort((left, right) => (right.mean_sharpe ?? -Infinity) - (left.mean_sharpe ?? -Infinity))[0],
    }))
    .filter((entry) => entry.row);

  return (
    <div className="space-y-4 pb-1">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {bestRows.map(({ market, row }) => (
          <KpiCard
            key={market}
            label={MARKET_LABELS[market] ?? market}
            value={
              row?.mean_sharpe != null && Number.isFinite(row.mean_sharpe)
                ? row.mean_sharpe.toFixed(2)
                : "—"
            }
            color={sharpeColor(row?.mean_sharpe)}
            sub={row ? `Top strategy: ${formatStrategyLabel(row.Strategy)}` : "No summary rows"}
          />
        ))}
      </div>

      <Panel>
        <p className="dashboard-label mb-4">Best strategy by market</p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={bestRows.map(({ market, row }) => ({
            market: MARKET_LABELS[market] ?? market,
            sharpe: row?.mean_sharpe ?? null,
            color: row ? getStrategyColor(row.strategy_key) : COLORS.slate,
          }))}>
            <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
            <XAxis dataKey="market" tick={{ fontSize: 10, fill: "#8f8780" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
            <Tooltip {...tooltipStyle} formatter={(value: number | null) => (value != null ? value.toFixed(2) : "—")} />
            <Bar dataKey="sharpe" radius={[10, 10, 0, 0]}>
              {bestRows.map(({ market, row }) => (
                <Cell key={market} fill={row ? getStrategyColor(row.strategy_key) : COLORS.slate} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <SectionHeader>Sharpe Heatmap</SectionHeader>
      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-[11px]">
          <thead>
            <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Strategy</th>
              {markets.map((market) => (
                <th key={market} className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                  {MARKET_LABELS[market] ?? market}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {strategyKeys.map((compoundKey) => {
              const [strategyKey, strategyLabel] = compoundKey.split("::");
              return (
                <tr key={compoundKey} className="border-b border-[rgba(227,220,214,0.8)] last:border-0">
                  <td className="px-3 py-2.5 font-medium text-[#5e5955]">{strategyLabel}</td>
                  {markets.map((market) => {
                    const row = perMarketSummary
                      .find((entry) => entry.market === market)
                      ?.summary.find((summaryRow) => summaryRow.strategy_key === strategyKey);
                    const sharpeRaw = row?.mean_sharpe;
                    const sharpe =
                      sharpeRaw != null && Number.isFinite(sharpeRaw)
                        ? sharpeRaw
                        : null;
                    const background =
                      sharpe == null
                        ? "transparent"
                        : sharpe > 1
                          ? "rgba(156, 199, 164, 0.2)"
                          : sharpe > 0.5
                            ? "rgba(216, 182, 146, 0.18)"
                            : "rgba(212, 151, 144, 0.18)";

                    return (
                      <td key={market} className="px-3 py-2.5 text-center">
                        <div
                          className="rounded-[12px] px-3 py-2"
                          style={{ backgroundColor: background }}
                        >
                          <div className="font-semibold" style={{ color: sharpeColor(sharpe) }}>
                            {sharpe != null ? sharpe.toFixed(2) : "—"}
                          </div>
                          <div className="mt-1 text-[10px] text-[#9d958d]">
                            {formatPctFromRatio(row?.net_return_mean, 1)}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

export function StatisticalTestsTab({ runs }: BaseTabProps) {
  const statsRows = useMemo(() => buildStrategyStats(runs), [runs]);
  const strongestEdge = statsRows
    .filter((row) => row.deltaVsIndex != null)
    .sort((left, right) => (right.deltaVsIndex ?? -Infinity) - (left.deltaVsIndex ?? -Infinity))[0];
  const mostStable = [...statsRows]
    .filter((row) => row.sharpeCi95 != null)
    .sort((left, right) => (left.sharpeCi95 ?? Infinity) - (right.sharpeCi95 ?? Infinity))[0];
  const largestSample = [...statsRows].sort((left, right) => right.n - left.n)[0];

  return (
    <div className="space-y-4 pb-1">
      <Panel className="border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.62)]">
        <p className="text-[12px] leading-5 text-[#8f8780]">
          These statistics are derived from run-level dispersion in the current filter set.
          The confidence intervals are approximate 95% intervals around the mean, not formal paired hypothesis tests.
        </p>
      </Panel>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Most Stable Sharpe"
          value={mostStable?.sharpeCi95 != null ? `±${mostStable.sharpeCi95.toFixed(2)}` : "—"}
          color={COLORS.green}
          sub={mostStable ? formatStrategyLabel(mostStable.strategy) : "No estimate"}
        />
        <KpiCard
          label="Largest Edge vs Index"
          value={strongestEdge?.deltaVsIndex != null ? strongestEdge.deltaVsIndex.toFixed(2) : "—"}
          color={strongestEdge?.deltaVsIndex != null && strongestEdge.deltaVsIndex >= 0 ? COLORS.green : COLORS.red}
          sub={strongestEdge ? formatStrategyLabel(strongestEdge.strategy) : "No comparison"}
        />
        <KpiCard
          label="Largest Sample"
          value={largestSample ? String(largestSample.n) : "—"}
          color={COLORS.cyan}
          sub={largestSample ? formatStrategyLabel(largestSample.strategy) : "No estimate"}
        />
        <KpiCard
          label="Strategies Compared"
          value={String(statsRows.length)}
          color={COLORS.accent}
          sub="Current sidebar filters"
        />
      </div>

      {statsRows.length === 0 ? (
        <EmptyState title="No run-level statistics available" body="The current market filter does not include any run rows with statistical estimates." />
      ) : (
        <>
          <Panel>
            <p className="dashboard-label mb-4">Mean Sharpe with approximate confidence band</p>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={statsRows} margin={{ top: 8, right: 16, left: 8, bottom: 36 }}>
                <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                <XAxis
                  dataKey="strategy"
                  tickFormatter={(value) => formatStrategyLabel(String(value))}
                  angle={-18}
                  textAnchor="end"
                  interval={0}
                  height={60}
                  tick={{ fontSize: 10, fill: "#8f8780" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                <Tooltip
                  {...tooltipStyle}
                  labelFormatter={(value) => formatStrategyLabel(String(value))}
                  formatter={(value: number | null, name: string, payload) => {
                    if (name === "Sharpe CI") {
                      return payload.payload.sharpeCi95 != null
                        ? `±${payload.payload.sharpeCi95.toFixed(2)}`
                        : "—";
                    }
                    return value != null ? value.toFixed(2) : "—";
                  }}
                />
                <Bar dataKey="meanSharpe" radius={[10, 10, 0, 0]}>
                  {statsRows.map((row) => (
                    <Cell key={row.strategyKey} fill={getStrategyColor(row.strategyKey)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel className="overflow-x-auto p-0">
            <table className="w-full min-w-[880px] text-[11px]">
              <thead>
                <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Strategy</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">N</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Mean Sharpe</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">95% CI</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Mean Return</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Delta vs Index</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Effect Size</th>
                </tr>
              </thead>
              <tbody>
                {statsRows.map((row) => (
                  <tr key={row.strategyKey} className="border-b border-[rgba(227,220,214,0.8)] last:border-0">
                    <td className="px-3 py-2.5 font-medium text-[#5e5955]">{formatStrategyLabel(row.strategy)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{row.n}</td>
                    <td className="px-3 py-2.5 text-right" style={{ color: sharpeColor(row.meanSharpe) }}>
                      {row.meanSharpe?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">
                      {row.sharpeCi95 != null ? `±${row.sharpeCi95.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromRatio(row.meanReturn, 1)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">
                      {row.deltaVsIndex != null ? row.deltaVsIndex.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">
                      {row.effectSizeVsIndex != null ? row.effectSizeVsIndex.toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}

export function BehaviorTab({ data }: BaseTabProps) {
  const rows = data.behavior;
  const chartData = rows.map((row) => ({
    prompt: row.prompt_type,
    hhi: row.mean_hhi,
    effectiveHoldings: row.mean_effective_n_holdings,
    turnoverPct: row.mean_turnover * 100,
    forecastAbsErrorPct: row.mean_forecast_abs_error * 100,
    realizedReturnPct: row.mean_realized_net_return * 100,
  }));

  return (
    <div className="space-y-4 pb-1">
      {rows.length === 0 ? (
        <EmptyState title="No behavior metrics available" body="The current run set does not include GPT prompt-level behavior metrics." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {rows.map((row) => (
              <KpiCard
                key={row.prompt_type}
                label={row.prompt_type === "advanced" ? "Advanced prompt" : "Retail prompt"}
                value={row.mean_effective_n_holdings.toFixed(1)}
                color={COLORS.accent}
                sub={`Eff. holdings | HHI ${row.mean_hhi.toFixed(3)}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel>
              <p className="dashboard-label mb-4">Diversification and turnover</p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                  <XAxis dataKey="prompt" tick={{ fontSize: 10, fill: "#8f8780" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Legend />
                  <Bar dataKey="effectiveHoldings" fill={COLORS.cyan} radius={[8, 8, 0, 0]} name="Effective holdings" />
                  <Bar dataKey="hhi" fill={COLORS.red} radius={[8, 8, 0, 0]} name="HHI" />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel>
              <p className="dashboard-label mb-4">Forecast error and realized return</p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                  <XAxis dataKey="prompt" tick={{ fontSize: 10, fill: "#8f8780" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => `${value.toFixed(1)}%`} />
                  <Legend />
                  <Bar dataKey="turnoverPct" fill={COLORS.amber} radius={[8, 8, 0, 0]} name="Turnover %" />
                  <Bar dataKey="forecastAbsErrorPct" fill={COLORS.purple} radius={[8, 8, 0, 0]} name="Forecast abs. error %" />
                  <Bar dataKey="realizedReturnPct" fill={COLORS.green} radius={[8, 8, 0, 0]} name="Realized return %" />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <Panel className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-[11px]">
              <thead>
                <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Prompt</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Mean HHI</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Effective holdings</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Mean turnover</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Forecast abs. error</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Realized return</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: BehaviorRow) => (
                  <tr key={row.prompt_type} className="border-b border-[rgba(227,220,214,0.8)] last:border-0">
                    <td className="px-3 py-2.5 font-medium text-[#5e5955]">{row.prompt_type}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{row.mean_hhi.toFixed(3)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{row.mean_effective_n_holdings.toFixed(1)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromRatio(row.mean_turnover, 1)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromRatio(row.mean_forecast_abs_error, 1)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromRatio(row.mean_realized_net_return, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}

type DrawdownSeriesPayload =
  | { source: "vw_regime_daily"; rows: RegimeRow[] }
  | { source: "vw_strategy_daily"; rows: StrategyDailyRow[] };

export function DrawdownsTab({ data, marketFilter }: BaseTabProps) {
  const selection = useDailySelection(data, marketFilter);

  const drawdownSeriesQuery = useQuery({
    queryKey: [
      "drawdown-series",
      data.active_experiment_id,
      selection.selectedMarket,
      selection.selectedStrategyKey,
    ],
    queryFn: async (): Promise<DrawdownSeriesPayload> => {
      const base = {
        experiment_id: data.active_experiment_id,
        market: selection.selectedMarket,
        strategy_key: selection.selectedStrategyKey,
      };
      const regimes = await getRegimeChart(base);
      if (regimes.length > 0) {
        return { source: "vw_regime_daily", rows: regimes };
      }
      const equity = await getEquityChart(base);
      return { source: "vw_strategy_daily", rows: equity };
    },
    enabled: Boolean(selection.selectedMarket && selection.selectedStrategyKey),
    staleTime: 60_000,
  });

  const chartRows = useMemo(() => {
    const payload = drawdownSeriesQuery.data;
    if (!payload) {
      return [];
    }
    if (payload.source === "vw_regime_daily") {
      return aggregateRegimeRows(payload.rows);
    }
    return aggregateStrategyDailyForDrawdown(payload.rows);
  }, [drawdownSeriesQuery.data]);

  const rawRowCount = drawdownSeriesQuery.data?.rows.length ?? 0;
  const dataSourceLabel = drawdownSeriesQuery.data?.source ?? "—";

  const maxDrawdown = chartRows.reduce<number | null>((worst, row) => {
    if (row.drawdown == null) {
      return worst;
    }
    return worst == null ? row.drawdown : Math.max(worst, row.drawdown);
  }, null);
  const daysInDrawdown = chartRows.filter((row) => (row.drawdown ?? 0) > 0).length;
  const regimeShifts = chartRows.reduce(
    (sum, row) => sum + ((row.regimeChangeRate ?? 0) > 0 ? 1 : 0),
    0
  );
  const worstDailyReturn = chartRows.reduce<number | null>((worst, row) => {
    if (row.dailyReturn == null) {
      return worst;
    }
    return worst == null ? row.dailyReturn : Math.min(worst, row.dailyReturn);
  }, null);
  const regimeCounts = Array.from(
    chartRows.reduce((map, row) => {
      const key = row.marketRegimeLabel ?? "Unknown";
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  ).map(([regime, count]) => ({ regime, count }));

  return (
    <div className="space-y-4 pb-1">
      <Panel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterSelect
            label="Market"
            value={selection.selectedMarket}
            onChange={selection.setSelectedMarket}
            disabled={selection.marketOptions.length <= 1}
            options={selection.marketOptions.map((market) => ({
              value: market,
              label: MARKET_LABELS[market] ?? market,
            }))}
          />
          <FilterSelect
            label="Strategy"
            value={selection.selectedStrategyKey}
            onChange={selection.setSelectedStrategyKey}
            options={selection.strategyOptions.map((option) => ({
              value: option.strategy_key,
              label: formatStrategyLabel(option.strategy),
            }))}
          />
          <div className="rounded-[16px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.62)] px-4 py-3">
            <p className="dashboard-label">Source</p>
            <p className="mt-2 text-[13px] font-semibold text-[#5f5955]">{dataSourceLabel}</p>
            <p className="mt-1 text-[11px] text-[#9b938b]">
              Regime view when present; otherwise daily strategy series (same as Equity Curves), averaged across paths.
            </p>
          </div>
          <div className="rounded-[16px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.62)] px-4 py-3">
            <p className="dashboard-label">Rows</p>
            <p className="mt-2 text-[13px] font-semibold text-[#5f5955]">{rawRowCount}</p>
            <p className="mt-1 text-[11px] text-[#9b938b]">Loaded from the live view</p>
          </div>
        </div>
      </Panel>

      {drawdownSeriesQuery.isLoading ? (
        <LoadingState title="Loading drawdown series" />
      ) : chartRows.length === 0 ? (
        <EmptyState
          title="No drawdown series for this selection"
          body="There are no daily rows in vw_regime_daily or vw_strategy_daily for this market and strategy. Try another strategy or confirm the experiment has equity paths loaded."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard label="Worst Drawdown" value={formatPctFromRatio(maxDrawdown, 1)} color={COLORS.red} sub="Average across paths" />
            <KpiCard label="Days Below Peak" value={String(daysInDrawdown)} color={COLORS.amber} sub={`${chartRows.length} daily points`} />
            <KpiCard label="Regime Shift Days" value={String(regimeShifts)} color={COLORS.cyan} sub="Any regime changed" />
            <KpiCard label="Worst Daily Return" value={formatPctFromRatio(worstDailyReturn, 1)} color={COLORS.red} sub="Average path daily return" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel>
              <p className="dashboard-label mb-4">Drawdown path</p>
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={chartRows} margin={{ top: 10, right: 18, left: 6, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateLabel}
                    minTickGap={28}
                    tick={{ fontSize: 10, fill: "#aca49d" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#aca49d" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${value.toFixed(0)}%`}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    labelFormatter={(value) => formatDateLabel(String(value))}
                    formatter={(value: number | null) => (value != null ? `${value.toFixed(1)}%` : "—")}
                  />
                  <Area
                    type="monotone"
                    dataKey={(row: { drawdown: number | null }) =>
                      row.drawdown != null ? row.drawdown * 100 : null
                    }
                    stroke={COLORS.red}
                    fill="rgba(212, 151, 144, 0.3)"
                    strokeWidth={2}
                    name="Drawdown"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Panel>

            <Panel>
              <p className="dashboard-label mb-4">Market regime distribution</p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={regimeCounts}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                  <XAxis dataKey="regime" tick={{ fontSize: 10, fill: "#8f8780" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" fill={COLORS.cyan} radius={[10, 10, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <Panel className="overflow-x-auto p-0">
            <table className="w-full min-w-[620px] text-[11px]">
              <thead>
                <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Date</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Drawdown</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Daily return</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Regime</th>
                </tr>
              </thead>
              <tbody>
                {[...chartRows]
                  .sort((left, right) => (right.drawdown ?? -Infinity) - (left.drawdown ?? -Infinity))
                  .slice(0, 8)
                  .map((row) => (
                    <tr key={row.date} className="border-b border-[rgba(227,220,214,0.8)] last:border-0">
                      <td className="px-3 py-2.5 font-medium text-[#5e5955]">{formatDateLabel(row.date)}</td>
                      <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromRatio(row.drawdown, 1)}</td>
                      <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromRatio(row.dailyReturn, 1)}</td>
                      <td className="px-3 py-2.5 text-[#8d857f]">{row.marketRegimeLabel ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}

export function DataQualityTab({ data, marketFilter }: BaseTabProps) {
  const rows = useMemo(
    () =>
      marketFilter === "All"
        ? data.run_quality
        : data.run_quality.filter((row) => row.market === marketFilter),
    [data.run_quality, marketFilter]
  );

  const totalRows = rows.reduce((sum, row) => sum + row.row_count, 0);
  const totalValid = rows.reduce((sum, row) => sum + row.valid_rows, 0);
  const totalRepaired = rows.reduce((sum, row) => sum + row.repaired_rows, 0);
  const weightedRepairAttempts = rows.reduce(
    (sum, row) => sum + (row.avg_repair_attempts ?? 0) * row.row_count,
    0
  );
  const avgRepairAttempts = totalRows > 0 ? weightedRepairAttempts / totalRows : null;

  const byPrompt = Array.from(
    rows.reduce((map, row) => {
      const key = row.prompt_type || "unknown";
      const bucket =
        map.get(key) ?? {
          prompt: key,
          rowCount: 0,
          validRows: 0,
          repairedRows: 0,
        };
      bucket.rowCount += row.row_count;
      bucket.validRows += row.valid_rows;
      bucket.repairedRows += row.repaired_rows;
      map.set(key, bucket);
      return map;
    }, new Map<string, { prompt: string; rowCount: number; validRows: number; repairedRows: number }>())
  ).map(([, value]) => value);

  const byFailureType = Array.from(
    rows.reduce((map, row) => {
      if (!row.failure_type) {
        return map;
      }

      map.set(row.failure_type, (map.get(row.failure_type) ?? 0) + row.row_count);
      return map;
    }, new Map<string, number>())
  ).map(([failureType, count]) => ({ failureType, count }));

  return (
    <div className="space-y-4 pb-1">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Rows Audited" value={String(totalRows)} color={COLORS.accent} sub="Across run-quality slices" />
        <KpiCard label="Valid Rows" value={formatPctFromNumber(totalRows > 0 ? (totalValid / totalRows) * 100 : null, 0)} color={COLORS.green} sub={`${totalValid} valid`} />
        <KpiCard label="Repaired Rows" value={formatPctFromNumber(totalRows > 0 ? (totalRepaired / totalRows) * 100 : null, 0)} color={COLORS.amber} sub={`${totalRepaired} repaired`} />
        <KpiCard label="Avg Repair Attempts" value={avgRepairAttempts != null ? avgRepairAttempts.toFixed(2) : "—"} color={COLORS.cyan} sub="Weighted by row count" />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No data quality rows available" body="The current market filter does not include any run-quality records." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Panel>
              <p className="dashboard-label mb-4">Validation / repair by prompt type</p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={byPrompt} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                  <XAxis dataKey="prompt" tick={{ fontSize: 10, fill: "#8f8780" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Legend />
                  <Bar dataKey="validRows" fill={COLORS.green} radius={[8, 8, 0, 0]} name="Valid rows" />
                  <Bar dataKey="repairedRows" fill={COLORS.amber} radius={[8, 8, 0, 0]} name="Repaired rows" />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel>
              <p className="dashboard-label mb-4">Failure type volume</p>
              {byFailureType.length === 0 ? (
                <div className="flex h-[300px] items-center justify-center text-center text-[12px] text-[#9b938b]">
                  No explicit failure types recorded for the current slice.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={byFailureType}>
                    <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                    <XAxis dataKey="failureType" tick={{ fontSize: 10, fill: "#8f8780" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="count" fill={COLORS.red} radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <Panel className="overflow-x-auto p-0">
            <table className="w-full min-w-[940px] text-[11px]">
              <thead>
                <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Market</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Period</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Prompt</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Model</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Failure type</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Valid %</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Repaired %</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Avg attempts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.market}-${row.period}-${row.prompt_type}-${row.model}-${row.failure_type ?? "ok"}`} className="border-b border-[rgba(227,220,214,0.8)] last:border-0">
                    <td className="px-3 py-2.5 font-medium text-[#5e5955]">{MARKET_LABELS[row.market] ?? row.market}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">{row.period}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">{row.prompt_type}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">{row.model}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">{row.failure_type ?? "none"}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromNumber((row.valid_rows / row.row_count) * 100, 0)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromNumber((row.repaired_rows / row.row_count) * 100, 0)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{row.avg_repair_attempts != null ? row.avg_repair_attempts.toFixed(2) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}

export { FactorStyleTab } from "./FactorStyleTab";
export { StrategiesTab } from "./StrategiesTab";
