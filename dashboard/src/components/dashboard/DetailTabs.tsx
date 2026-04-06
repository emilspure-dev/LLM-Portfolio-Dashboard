import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
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
  ZAxis,
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

function TabMarketSelector({
  markets,
  value,
  onChange,
}: {
  markets: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (markets.length === 0) return null;
  return (
    <div className="dashboard-panel rounded-[18px] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="dashboard-label shrink-0">Market</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-[12px] border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.72)] px-3 py-1.5 text-[12px] font-medium text-[#6f6863] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] outline-none"
        >
          <option value="All">All markets</option>
          {markets.map((m) => (
            <option key={m} value={m}>
              {MARKET_LABELS[m] ?? m}
            </option>
          ))}
        </select>
      </div>
    </div>
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
  sixtyForty: "#7a7a7a",
  famaFrench: "#6366f1",
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

function getMarketOptions(data: EvaluationData) {
  return collectAllMarkets(data);
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

function useDailySelection(data: EvaluationData): SelectionState {
  const marketOptions = useMemo(
    () => getMarketOptions(data),
    [data]
  );
  const [selectedMarket, setSelectedMarket] = useState("");
  const [selectedStrategyKey, setSelectedStrategyKey] = useState("");

  useEffect(() => {
    setSelectedMarket((current) => {
      if (marketOptions.includes(current)) {
        return current;
      }
      return marketOptions[0] ?? "";
    });
  }, [marketOptions]);

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

export function SharpeReturnsTab({ data, runs }: BaseTabProps) {
  const allMarkets = useMemo(() => getMarketOptions(data), [data]);
  const [marketFilter, setMarketFilter] = useState("All");

  const localRuns = useMemo(
    () => filterRunsForMarketFilter(runs, marketFilter),
    [runs, marketFilter]
  );
  const summary = useMemo(
    () => buildStrategySummaryWithRunSharpe(data.summary_rows, marketFilter, runs),
    [data.summary_rows, marketFilter, runs]
  );

  const sharpeHistogramModel = useMemo(() => {
    const scoped = localRuns;
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
    const summaryMean = (key: string) => {
      const row = summary.find((s) => s.strategy_key === key);
      return row?.mean_sharpe != null && Number.isFinite(row.mean_sharpe)
        ? row.mean_sharpe
        : null;
    };
    const ewMean = summaryMean("equal_weight");
    const mvMean = summaryMean("mean_variance");
    const ixMean = summaryMean("index");
    const sfMean = summaryMean("sixty_forty");
    const ffMean = summaryMean("fama_french");
    return {
      retail,
      advanced,
      bins,
      retailMean,
      advancedMean,
      ewMean,
      mvMean,
      ixMean,
      sfMean,
      ffMean,
    };
  }, [localRuns, summary]);

  const {
    retail: retailSharpes,
    advanced: advancedSharpes,
    bins: sharpeBins,
    retailMean,
    advancedMean,
    ewMean,
    mvMean,
    ixMean,
    sfMean,
    ffMean,
  } = sharpeHistogramModel;

  const _allMeanCandidates = useMemo(
    () => [
      { key: "adv", value: advancedMean, label: "GPT Advanced μ", color: SHARPE_HIST_COLORS.gptAdvanced, dashed: true },
      { key: "ret", value: retailMean, label: "GPT Retail μ", color: SHARPE_HIST_COLORS.gptRetail, dashed: true },
      { key: "ew", value: ewMean, label: "Equal weight μ", color: SHARPE_HIST_COLORS.equalWeight, dashed: false },
      { key: "mv", value: mvMean, label: "MV μ", color: SHARPE_HIST_COLORS.meanVariance, dashed: false },
      { key: "ix", value: ixMean, label: "Index μ", color: SHARPE_HIST_COLORS.index, dashed: false },
      { key: "sf", value: sfMean, label: "60/40 μ", color: SHARPE_HIST_COLORS.sixtyForty, dashed: false },
      { key: "ff", value: ffMean, label: "Fama-French μ", color: SHARPE_HIST_COLORS.famaFrench, dashed: false },
    ],
    [advancedMean, ewMean, ffMean, ixMean, mvMean, retailMean, sfMean],
  );

  const sharpeMeanMarkers = useMemo(
    () =>
      _allMeanCandidates.filter(
        (m): m is typeof m & { value: number } =>
          m.value != null && Number.isFinite(m.value),
      ),
    [_allMeanCandidates],
  );

  useEffect(() => {
    if (sharpeBins.length > 0) {
      const diag = _allMeanCandidates.map((c) => ({
        key: c.key,
        label: c.label,
        rawValue: c.value,
        included: c.value != null && Number.isFinite(c.value),
      }));
      console.table(diag);
      console.log(
        `[SharpeHist] ${sharpeMeanMarkers.length}/${_allMeanCandidates.length} markers active`,
        sharpeMeanMarkers.map((m) => `${m.key}=${m.value.toFixed(3)}`),
      );
    }
  }, [_allMeanCandidates, sharpeMeanMarkers, sharpeBins]);

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
      <TabMarketSelector markets={allMarkets} value={marketFilter} onChange={setMarketFilter} />
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
            portfolios.{" "}
            <span className="font-medium text-[#6f6863]">Dotted</span>: benchmark strategy means
            (1/N, MV, 60/40, Fama-French, Index).
          </p>
          {sharpeMeanMarkers.length > 0 && (
            <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 border-b border-[rgba(232,224,217,0.65)] pb-3 text-[10px] sm:grid-cols-3 lg:grid-cols-4">
              {[...sharpeMeanMarkers]
                .sort((a, b) => a.value - b.value)
                .map((m) => (
                  <span key={m.key} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-[2px] w-4 shrink-0"
                      style={{
                        backgroundColor: m.color,
                        borderTop: m.dashed
                          ? `2px dashed ${m.color}`
                          : `2px dotted ${m.color}`,
                        height: 0,
                      }}
                    />
                    <span style={{ color: m.color }} className="font-semibold">
                      {m.label}: {m.value.toFixed(2)}
                    </span>
                  </span>
                ))}
            </div>
          )}
          {(() => {
            const markerXs = sharpeMeanMarkers.map((m) => m.value);
            const binMids = sharpeBins.map((b) => b.mid);
            const allXs = [...binMids, ...markerXs];
            const xMin = Math.floor((Math.min(...allXs) - 0.5) * 2) / 2;
            const xMax = Math.ceil((Math.max(...allXs) + 0.5) * 2) / 2;
            return (
              <ResponsiveContainer width="100%" height={340}>
                <AreaChart
                  data={sharpeBins}
                  margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                >
                  <CartesianGrid stroke="rgba(200, 192, 184, 0.55)" vertical={false} strokeDasharray="3 6" />
                  <XAxis
                    dataKey="mid"
                    type="number"
                    domain={[xMin, xMax]}
                    tickFormatter={(v: number) => v.toFixed(1)}
                    tick={{ fontSize: 10, fill: "#7a726c" }}
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
                    labelFormatter={(mid) =>
                      `Sharpe ≈ ${typeof mid === "number" ? mid.toFixed(2) : mid}`
                    }
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: 11, color: "#5d5754", paddingBottom: 4 }}
                  />
                  <Area
                    name="GPT (Retail)"
                    dataKey="retail"
                    type="stepAfter"
                    stroke={SHARPE_HIST_COLORS.gptRetail}
                    strokeWidth={1.5}
                    fill={SHARPE_HIST_COLORS.gptRetail}
                    fillOpacity={0.35}
                    isAnimationActive={false}
                    legendType="square"
                  />
                  <Area
                    name="GPT (Advanced)"
                    dataKey="advanced"
                    type="stepAfter"
                    stroke={SHARPE_HIST_COLORS.gptAdvanced}
                    strokeWidth={1.5}
                    fill={SHARPE_HIST_COLORS.gptAdvanced}
                    fillOpacity={0.35}
                    isAnimationActive={false}
                    legendType="square"
                  />
                  {sharpeMeanMarkers.map((m) => (
                    <ReferenceLine
                      key={m.key}
                      x={m.value}
                      stroke={m.color}
                      strokeWidth={2.2}
                      strokeDasharray={m.dashed ? "8 4" : "3 3"}
                      ifOverflow="extendDomain"
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            );
          })()}
          <p className="mt-2 text-[10px] text-[#a39b93]">
            X-axis: Sharpe ratio (numerical). Y-axis: number of runs in each bin.
          </p>
          {/* Diagnostic: shows which mean markers were resolved vs null */}
          <details className="mt-1 text-[9px] text-[#b0a8a0]">
            <summary className="cursor-pointer hover:text-[#8a827a]">
              Marker diagnostics ({sharpeMeanMarkers.length}/{_allMeanCandidates.length} active)
            </summary>
            <ul className="mt-1 ml-3 list-disc space-y-0.5">
              {_allMeanCandidates.map((c) => (
                <li key={c.key} style={{ color: c.value != null && Number.isFinite(c.value) ? "#5d8a5e" : "#c45a4a" }}>
                  {c.label}: {c.value != null ? c.value.toFixed(4) : "NULL / NaN"}{" "}
                  {c.value != null && Number.isFinite(c.value) ? "✓" : "✗ (excluded)"}
                </li>
              ))}
            </ul>
          </details>
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

export function EquityCurvesTab({ data }: BaseTabProps) {
  const selection = useDailySelection(data);
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

  const isNotIndex = selection.selectedStrategyKey !== "index";
  const benchmarkQuery = useQuery({
    queryKey: ["equity-benchmark", data.active_experiment_id, selection.selectedMarket],
    queryFn: () =>
      fetchEquitySeriesWithPathFallback(
        data.active_experiment_id,
        selection.selectedMarket,
        "index",
        data.runs
      ),
    enabled: Boolean(selection.selectedMarket && isNotIndex),
    staleTime: 120_000,
  });
  const benchmarkRows = useMemo(
    () => (isNotIndex ? aggregateDailyRows(benchmarkQuery.data ?? []) : []),
    [benchmarkQuery.data, isNotIndex]
  );

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
                {(() => {
                  const benchMap = new Map(benchmarkRows.map((r) => [r.date, r.portfolioValue]));
                  const hasBench = benchmarkRows.length > 0 && isNotIndex;
                  const merged = curveRows.map((r) => ({
                    ...r,
                    benchmarkValue: hasBench ? (benchMap.get(r.date) ?? null) : null,
                  }));
                  return (
                    <LineChart data={merged} margin={{ top: 10, right: 18, left: 6, bottom: 8 }}>
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
                      {hasBench && (
                        <Line
                          type="monotone"
                          dataKey="benchmarkValue"
                          stroke="rgba(180,172,165,0.7)"
                          strokeWidth={1.5}
                          strokeDasharray="6 3"
                          dot={false}
                          name="Market index"
                          connectNulls
                        />
                      )}
                      <Line
                        type="monotone"
                        dataKey="portfolioValue"
                        stroke={getStrategyColor(selection.selectedStrategyKey)}
                        strokeWidth={2.5}
                        dot={false}
                        name="Portfolio value"
                      />
                      {hasBench && <Legend />}
                    </LineChart>
                  );
                })()}
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

export function PortfoliosTab({ data }: BaseTabProps) {
  const selection = useDailySelection(data);
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
  const allMarkets = useMemo(() => getMarketOptions(data), [data]);

  // Portfolio options derive from strategy_key for consistent naming across tabs
  const portfolioOptions = useMemo(
    () =>
      Array.from(new Set(runs.map((run) => run.strategy_key).filter(Boolean) as string[])).sort(
        (a, b) => strategyOrder(a) - strategyOrder(b)
      ),
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

  const [marketFilter, setMarketFilter] = useState("All");
  const [portfolioFilter, setPortfolioFilter] = useState("All");
  const [modelFilter, setModelFilter] = useState("All");
  const [periodFilter, setPeriodFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [marketFilter, portfolioFilter, modelFilter, periodFilter, runs]);

  const filteredRuns = useMemo(() => {
    return runs
      .filter((run) => marketFilter === "All" || run.market === marketFilter)
      .filter((run) => portfolioFilter === "All" || run.strategy_key === portfolioFilter)
      .filter((run) => modelFilter === "All" || run.model === modelFilter)
      .filter((run) => periodFilter === "All" || run.period === periodFilter)
      .sort((left, right) => (asNumber(right.sharpe_ratio) ?? -Infinity) - (asNumber(left.sharpe_ratio) ?? -Infinity));
  }, [runs, marketFilter, portfolioFilter, modelFilter, periodFilter]);

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

  const pageComparisonData = useMemo(() => {
    // Count how many times each run_id appears on this page (they can repeat across periods)
    const runIdCounts = new Map<string, number>();
    for (const run of pageRows) {
      if (run.run_id != null) {
        const rid = String(run.run_id);
        runIdCounts.set(rid, (runIdCounts.get(rid) ?? 0) + 1);
      }
    }
    // Track occurrence index per run_id so duplicates get #10a, #10b labels
    const ridSeen = new Map<string, number>();
    return pageRows.map((run, index) => {
      let label: string;
      if (run.run_id != null) {
        const rid = String(run.run_id);
        if ((runIdCounts.get(rid) ?? 0) > 1) {
          const occurrence = (ridSeen.get(rid) ?? 0) + 1;
          ridSeen.set(rid, occurrence);
          label = `#${rid}${String.fromCharCode(96 + occurrence)}`; // #10a, #10b …
        } else {
          label = `#${rid}`;
        }
      } else {
        label = `${(page - 1) * 12 + index + 1}`;
      }
      return {
        key: getRunExplorerKey(run),
        label,
        sharpe: asNumber(run.sharpe_ratio),
        periodReturn: asNumber(run.period_return ?? run.net_return ?? run.period_return_net),
        strategyKey: run.strategy_key ?? "",
      };
    });
  }, [pageRows, page]);

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

  const MODEL_COLORS = [CHART_COLORS[0], CHART_COLORS[1], CHART_COLORS[2], CHART_COLORS[3], CHART_COLORS[4], COLORS.accent, COLORS.amber];
  const modelScatterData = useMemo(() => {
    const models = Array.from(new Set(filteredRuns.map((r) => r.model).filter(Boolean) as string[])).sort();
    if (models.length < 2) return null;
    const colorMap = new Map(models.map((m, i) => [m, MODEL_COLORS[i % MODEL_COLORS.length]]));
    return {
      models,
      colorMap,
      points: filteredRuns
        .filter((r) => r.model && asNumber(r.sharpe_ratio) != null)
        .map((r) => ({
          sharpe: asNumber(r.sharpe_ratio)!,
          ret: (asNumber(r.period_return ?? r.net_return ?? r.period_return_net) ?? 0) * 100,
          model: String(r.model),
          color: colorMap.get(String(r.model)) ?? COLORS.accent,
        })),
    };
  }, [filteredRuns]);

  const hhiScatterData = useMemo(() => {
    const models = Array.from(new Set(filteredRuns.map((r) => r.model).filter(Boolean) as string[])).sort();
    if (models.length < 2) return null;
    const colorMap = new Map(models.map((m, i) => [m, MODEL_COLORS[i % MODEL_COLORS.length]]));
    const points = filteredRuns
      .filter((r) => r.model && asNumber(r.hhi) != null)
      .map((r) => ({
        hhi: asNumber(r.hhi)!,
        sharpe: asNumber(r.sharpe_ratio) ?? 0,
        model: String(r.model),
        color: colorMap.get(String(r.model)) ?? COLORS.accent,
      }));
    if (points.length < 4) return null;
    return { models, colorMap, points };
  }, [filteredRuns]);

  return (
    <div className="space-y-4 pb-1">
      <Panel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterSelect
            label="Market"
            value={marketFilter}
            onChange={setMarketFilter}
            options={[{ value: "All", label: "All markets" }, ...allMarkets.map((m) => ({ value: m, label: MARKET_LABELS[m] ?? m }))]}
          />
          <FilterSelect
            label="Portfolio"
            value={portfolioFilter}
            onChange={setPortfolioFilter}
            options={[{ value: "All", label: "All portfolios" }, ...portfolioOptions.map((key) => ({ value: key, label: formatStrategyLabel(key) }))]}
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
        <EmptyState title="No runs match the current filters" body="Try widening the market, portfolio, model, or period filters to inspect the full experiment run set." />
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

          {modelScatterData && (
            <Panel>
              <p className="dashboard-label mb-4">Model comparison — Sharpe vs return</p>
              <ResponsiveContainer width="100%" height={300}>
                <ScatterChart margin={{ top: 8, right: 100, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" strokeDasharray="3 6" />
                  <XAxis
                    type="number"
                    dataKey="sharpe"
                    name="Sharpe"
                    tick={{ fontSize: 10, fill: "#aca49d" }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: "Sharpe ratio", position: "insideBottom", offset: -2, style: { fontSize: 10, fill: "#aca49d" } }}
                  />
                  <YAxis
                    type="number"
                    dataKey="ret"
                    name="Return %"
                    tick={{ fontSize: 10, fill: "#aca49d" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    label={{ value: "Period return", angle: -90, position: "insideLeft", offset: 12, style: { fontSize: 10, fill: "#aca49d" } }}
                  />
                  <ZAxis range={[40, 40]} />
                  <Tooltip
                    {...tooltipStyle}
                    content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as { model: string; sharpe: number; ret: number };
                      return (
                        <div style={{ ...(tooltipStyle.contentStyle as React.CSSProperties), padding: "8px 12px", fontSize: 11 }}>
                          <p style={{ fontWeight: 600, marginBottom: 4, color: "#5c534c" }}>{d.model}</p>
                          <p style={{ color: "#8f8780" }}>Sharpe: {d.sharpe.toFixed(2)}</p>
                          <p style={{ color: "#8f8780" }}>Return: {d.ret.toFixed(1)}%</p>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    data={modelScatterData.points}
                    shape={(props: Record<string, unknown>) => {
                      const cx = props.cx as number;
                      const cy = props.cy as number;
                      const pt = props.payload as { model: string; color: string };
                      return <circle cx={cx} cy={cy} r={5} fill={pt.color} fillOpacity={0.7} stroke="white" strokeWidth={1} />;
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    content={() => (
                      <div className="flex flex-wrap gap-3 text-[10px]">
                        {modelScatterData.models.map((m) => (
                          <span key={m} className="flex items-center gap-1">
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: modelScatterData.colorMap.get(m) }} />
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </Panel>
          )}

          {hhiScatterData && (
            <Panel>
              <p className="dashboard-label mb-4">Model comparison — Sharpe vs HHI (concentration)</p>
              <ResponsiveContainer width="100%" height={300}>
                <ScatterChart margin={{ top: 8, right: 100, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" strokeDasharray="3 6" />
                  <XAxis
                    type="number"
                    dataKey="sharpe"
                    name="Sharpe"
                    tick={{ fontSize: 10, fill: "#aca49d" }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: "Sharpe ratio", position: "insideBottom", offset: -2, style: { fontSize: 10, fill: "#aca49d" } }}
                  />
                  <YAxis
                    type="number"
                    dataKey="hhi"
                    name="HHI"
                    tick={{ fontSize: 10, fill: "#aca49d" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => v.toFixed(2)}
                    label={{ value: "HHI (concentration)", angle: -90, position: "insideLeft", offset: 12, style: { fontSize: 10, fill: "#aca49d" } }}
                  />
                  <ZAxis range={[40, 40]} />
                  <Tooltip
                    {...tooltipStyle}
                    content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as { model: string; sharpe: number; hhi: number };
                      return (
                        <div style={{ ...(tooltipStyle.contentStyle as React.CSSProperties), padding: "8px 12px", fontSize: 11 }}>
                          <p style={{ fontWeight: 600, marginBottom: 4, color: "#5c534c" }}>{d.model}</p>
                          <p style={{ color: "#8f8780" }}>Sharpe: {d.sharpe.toFixed(2)}</p>
                          <p style={{ color: "#8f8780" }}>HHI: {d.hhi.toFixed(3)}</p>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    data={hhiScatterData.points}
                    shape={(props: Record<string, unknown>) => {
                      const cx = props.cx as number;
                      const cy = props.cy as number;
                      const pt = props.payload as { color: string };
                      return <circle cx={cx} cy={cy} r={5} fill={pt.color} fillOpacity={0.7} stroke="white" strokeWidth={1} />;
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    content={() => (
                      <div className="flex flex-wrap gap-3 text-[10px]">
                        {hhiScatterData.models.map((m) => (
                          <span key={m} className="flex items-center gap-1">
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: hhiScatterData.colorMap.get(m) }} />
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  />
                  <ReferenceLine y={0.15} stroke="rgba(192,120,110,0.5)" strokeDasharray="6 3" label={{ value: "Concentrated (0.15)", position: "right", fontSize: 9, fill: "#b47070" }} />
                </ScatterChart>
              </ResponsiveContainer>
              <p className="mt-1 text-[10px] text-[#b4aca5]">
                Lower HHI = more diversified. Runs above the dashed line (0.15) are concentrated portfolios.
              </p>
            </Panel>
          )}

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

export function ByMarketTab({ data }: BaseTabProps) {
  const markets = getMarketOptions(data);
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
                        : sharpe > 1.2
                          ? "rgba(120, 185, 135, 0.55)"
                          : sharpe > 0.9
                            ? "rgba(156, 199, 164, 0.42)"
                            : sharpe > 0.6
                              ? "rgba(216, 182, 146, 0.40)"
                              : "rgba(212, 140, 130, 0.42)";

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

      {/* Period consistency heatmap */}
      {(() => {
        const gptKeys = ["gpt_advanced", "gpt_retail"];
        const gptRuns = data.runs.filter((r) => gptKeys.includes(r.strategy_key ?? ""));
        const indexRuns = data.runs.filter((r) => r.strategy_key === "index");
        const periods = Array.from(new Set(data.runs.map((r) => r.period).filter(Boolean) as string[])).sort();
        if (gptRuns.length === 0 || indexRuns.length === 0 || periods.length === 0) return null;

        const idxSharpeMap = new Map<string, number>();
        for (const r of indexRuns) {
          const key = `${r.market ?? ""}::${r.period ?? ""}`;
          const existing = idxSharpeMap.get(key);
          const s = asNumber(r.sharpe_ratio);
          if (s != null && (existing == null || s > existing)) idxSharpeMap.set(key, s);
        }

        const columns = markets.flatMap((m) =>
          gptKeys.map((gk) => ({ market: m, gptKey: gk, colKey: `${m}::${gk}` }))
        );

        return (
          <>
            <SectionHeader>Period Consistency</SectionHeader>
            <Panel className="border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.62)]">
              <p className="text-[12px] leading-5 text-[#8f8780]">
                For each period, does GPT beat the market index Sharpe in that market?
                Green = GPT Sharpe exceeded index. Red = missed. Grey = no data.
              </p>
            </Panel>
            <Panel className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-[11px]">
                <thead>
                  <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                      Period
                    </th>
                    {columns.map((col) => (
                      <th key={col.colKey} className="px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                        <div>{MARKET_LABELS[col.market]?.replace(/ \(.*\)$/, "") ?? col.market}</div>
                        <div className="mt-0.5 text-[9px] font-normal normal-case opacity-70">
                          {col.gptKey === "gpt_advanced" ? "Advanced" : "Retail"}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => (
                    <tr key={period} className="border-b border-[rgba(227,220,214,0.6)] last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-[#5e5955]">{period}</td>
                      {columns.map((col) => {
                        const idxKey = `${col.market}::${period}`;
                        const idxSharpe = idxSharpeMap.get(idxKey);
                        const gptRunsForCell = gptRuns.filter(
                          (r) => r.strategy_key === col.gptKey && r.market === col.market && r.period === period
                        );
                        if (gptRunsForCell.length === 0 || idxSharpe == null) {
                          return (
                            <td key={col.colKey} className="px-2 py-2 text-center text-[#d0c9c3]">—</td>
                          );
                        }
                        const avgGpt =
                          gptRunsForCell.reduce((s, r) => s + (asNumber(r.sharpe_ratio) ?? 0), 0) /
                          gptRunsForCell.length;
                        const beat = avgGpt > idxSharpe;
                        return (
                          <td key={col.colKey} className="px-2 py-2 text-center">
                            <span
                              className="inline-block rounded-[8px] px-2 py-1 text-[10px] font-semibold"
                              style={{
                                backgroundColor: beat ? "rgba(120,185,135,0.35)" : "rgba(212,140,130,0.3)",
                                color: beat ? "#4a8a5a" : "#b05050",
                              }}
                            >
                              {avgGpt.toFixed(2)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </>
        );
      })()}
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
                  <ErrorBar
                    dataKey="sharpeCi95"
                    width={6}
                    strokeWidth={2}
                    stroke="rgba(140,120,100,0.55)"
                    direction="y"
                  />
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
  const [reasoningPromptFilter, setReasoningPromptFilter] = useState<"all" | "retail" | "advanced">("all");
  const [reasoningSearch, setReasoningSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const chartData = rows.map((row) => ({
    prompt: row.prompt_type,
    hhi: row.mean_hhi,
    effectiveHoldings: row.mean_effective_n_holdings,
    turnoverPct: row.mean_turnover * 100,
    forecastAbsErrorPct: row.mean_forecast_abs_error * 100,
    realizedReturnPct: row.mean_realized_net_return * 100,
  }));

  // Compute post-loss runs: for each (strategy, market, model, prompt_type) group sorted by
  // period, find runs where the immediately preceding period had a negative return.
  const postLossRuns = useMemo(() => {
    const groups = new Map<string, RunRow[]>();
    for (const run of data.runs) {
      if (!run.prompt_type) continue;
      const key = `${run.strategy_key ?? ""}::${run.market ?? ""}::${run.model ?? ""}::${run.prompt_type}`;
      const group = groups.get(key) ?? [];
      group.push(run);
      groups.set(key, group);
    }
    const result: Array<{ run: RunRow; priorReturn: number; key: string }> = [];
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) =>
        String(a.period ?? "").localeCompare(String(b.period ?? ""))
      );
      for (let i = 1; i < sorted.length; i++) {
        const prior = sorted[i - 1];
        const priorReturn =
          (prior.period_return as number | null | undefined) ??
          (prior.net_return as number | null | undefined) ??
          (prior.period_return_net as number | null | undefined) ??
          null;
        if (priorReturn != null && priorReturn < 0) {
          const run = sorted[i];
          result.push({
            run,
            priorReturn,
            key: `${String(run.strategy_key ?? "")}::${String(run.market ?? "")}::${String(run.period ?? "")}::${String(run.prompt_type ?? "")}`,
          });
        }
      }
    }
    return result;
  }, [data.runs]);

  const filteredPostLoss = useMemo(() => {
    return postLossRuns.filter(({ run }) => {
      if (reasoningPromptFilter !== "all" && run.prompt_type !== reasoningPromptFilter) return false;
      if (reasoningSearch.trim()) {
        const q = reasoningSearch.toLowerCase();
        const summary = String((run as Record<string, unknown>).reasoning_summary ?? "").toLowerCase();
        if (!summary.includes(q)) return false;
      }
      return true;
    });
  }, [postLossRuns, reasoningPromptFilter, reasoningSearch]);

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
                <BarChart data={chartData} margin={{ top: 8, right: 48, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                  <XAxis dataKey="prompt" tick={{ fontSize: 10, fill: "#8f8780" }} axisLine={false} tickLine={false} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10, fill: "#aca49d" }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: "Eff. holdings", angle: -90, position: "insideLeft", offset: 12, style: { fontSize: 9, fill: "#aca49d" } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: COLORS.red }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => v.toFixed(2)}
                    label={{ value: "HHI", angle: 90, position: "insideRight", offset: 12, style: { fontSize: 9, fill: COLORS.red } }}
                  />
                  <Tooltip {...tooltipStyle} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="effectiveHoldings" fill={COLORS.cyan} radius={[8, 8, 0, 0]} name="Effective holdings" />
                  <Bar yAxisId="right" dataKey="hhi" fill={COLORS.red} radius={[8, 8, 0, 0]} name="HHI" />
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

          {/* ── Reasoning keyword frequency ── */}
          {(() => {
            const STOP = new Set([
              "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
              "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
              "been", "being", "have", "has", "had", "do", "does", "did", "will",
              "would", "could", "should", "may", "might", "shall", "can", "need",
              "it", "its", "this", "that", "these", "those", "i", "we", "you", "he",
              "she", "they", "me", "him", "her", "us", "them", "my", "our", "your",
              "his", "their", "which", "who", "whom", "what", "where", "when", "how",
              "not", "no", "nor", "if", "then", "than", "so", "up", "out", "just",
              "also", "more", "most", "very", "too", "each", "all", "any", "both",
              "few", "some", "such", "into", "over", "only", "own", "same", "other",
              "new", "one", "two", "about", "after", "before", "between", "under",
              "through", "during", "while", "because", "since", "until", "although",
              "however", "therefore", "thus", "there", "here", "s", "t", "m", "re",
              "ve", "d", "ll", "don", "doesn", "didn", "won", "wouldn", "couldn",
              "shouldn", "isn", "aren", "wasn", "weren", "hasn", "haven", "hadn",
              "based", "given", "using", "used", "like", "well", "still", "even",
            ]);
            const counts = new Map<string, number>();
            for (const run of data.runs) {
              const text = String((run as Record<string, unknown>).reasoning_summary ?? "");
              if (!text) continue;
              const words = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/);
              for (const w of words) {
                if (w.length < 3 || STOP.has(w)) continue;
                counts.set(w, (counts.get(w) ?? 0) + 1);
              }
            }
            const sorted = Array.from(counts.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 30);
            if (sorted.length < 5) return null;
            const maxCount = sorted[0][1];

            return (
              <>
                <SectionHeader>Reasoning themes</SectionHeader>
                <Panel className="border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.62)]">
                  <p className="text-[12px] leading-5 text-[#8f8780]">
                    Most frequent words in all reasoning summaries (stop words removed). Helps identify
                    whether the model consistently invokes certain themes across runs.
                  </p>
                </Panel>
                <Panel>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
                    {sorted.map(([word, count]) => (
                      <div key={word} className="flex items-center gap-2 py-1">
                        <span className="w-[80px] truncate text-[11px] font-medium text-[#5e5955]">{word}</span>
                        <div className="flex-1">
                          <div
                            className="h-[6px] rounded-full"
                            style={{
                              width: `${(count / maxCount) * 100}%`,
                              backgroundColor: "rgba(188,160,130,0.45)",
                            }}
                          />
                        </div>
                        <span className="w-[28px] text-right text-[10px] tabular-nums text-[#9b938b]">{count}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </>
            );
          })()}

          {/* ── Post-loss reasoning analysis ── */}
          <SectionHeader>Post-loss reasoning</SectionHeader>
          <Panel className="border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.62)]">
            <p className="text-[12px] leading-5 text-[#8f8780]">
              Reasoning summaries captured for runs that immediately followed a period with a negative return.
              Use these to understand what arguments the model invokes when recovering from a drawdown.
            </p>
          </Panel>

          {postLossRuns.length === 0 ? (
            <Panel>
              <p className="py-8 text-center text-[12px] text-[#9b938b]">
                No post-loss runs found — either no consecutive losing periods in the data or no reasoning summaries are stored for these runs.
              </p>
            </Panel>
          ) : (
            <>
              {/* Controls */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1 rounded-[12px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.62)] p-1">
                  {(["all", "retail", "advanced"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setReasoningPromptFilter(opt)}
                      className={`rounded-[9px] px-3 py-1 text-[11px] font-medium transition-colors ${
                        reasoningPromptFilter === opt
                          ? "bg-[rgba(188,160,130,0.28)] text-[#5c534c]"
                          : "text-[#9b938b] hover:text-[#5c534c]"
                      }`}
                    >
                      {opt === "all" ? `All (${postLossRuns.length})` : opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Search reasoning…"
                  value={reasoningSearch}
                  onChange={(e) => setReasoningSearch(e.target.value)}
                  className="flex-1 rounded-[12px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.62)] px-3 py-1.5 text-[11px] text-[#5c534c] placeholder-[#b4aca5] outline-none focus:border-[rgba(188,160,130,0.6)]"
                />
                <span className="text-[11px] text-[#b4aca5]">{filteredPostLoss.length} shown</span>
              </div>

              {filteredPostLoss.length === 0 ? (
                <Panel>
                  <p className="py-4 text-center text-[12px] text-[#9b938b]">No results match the current filter.</p>
                </Panel>
              ) : (
                <div className="space-y-2">
                  {filteredPostLoss.map(({ run, priorReturn, key }) => {
                    const summary = String((run as Record<string, unknown>).reasoning_summary ?? "");
                    const hasReasoning = summary.length > 0;
                    const isExpanded = expandedKey === key;
                    const promptLabel = run.prompt_type === "advanced" ? "Advanced" : "Retail";
                    const promptColor = run.prompt_type === "advanced" ? COLORS.accent : COLORS.cyan;
                    return (
                      <div
                        key={key}
                        className="rounded-[16px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.62)] px-4 py-3"
                      >
                        {/* Header row */}
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span
                              className="rounded-[8px] px-2 py-0.5 font-medium"
                              style={{ backgroundColor: `${promptColor}22`, color: promptColor }}
                            >
                              {promptLabel}
                            </span>
                            <span className="text-[#5c534c]">
                              {MARKET_LABELS[run.market ?? ""] ?? run.market ?? "—"}
                            </span>
                            <span className="text-[#b4aca5]">·</span>
                            <span className="text-[#8d857f]">{run.period ?? "—"}</span>
                            {run.model && (
                              <>
                                <span className="text-[#b4aca5]">·</span>
                                <span className="font-mono text-[10px] text-[#a39a92]">{String(run.model)}</span>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-[#9b938b]">
                              Prior return:{" "}
                              <span className="font-semibold text-[#c17070]">
                                {(priorReturn * 100).toFixed(1)}%
                              </span>
                            </span>
                            {run.sharpe_ratio != null && (
                              <span className="text-[11px] text-[#9b938b]">
                                This-period Sharpe:{" "}
                                <span className="font-semibold" style={{ color: sharpeColor(run.sharpe_ratio as number) }}>
                                  {(run.sharpe_ratio as number).toFixed(2)}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Reasoning body */}
                        {hasReasoning ? (
                          <div className="mt-2">
                            <p className={`text-[11px] leading-[1.7] text-[#5c534c] ${isExpanded ? "" : "line-clamp-3"}`}>
                              {summary}
                            </p>
                            {summary.length > 220 && (
                              <button
                                onClick={() => setExpandedKey(isExpanded ? null : key)}
                                className="mt-1 text-[10px] font-medium text-[#a07c5a] hover:text-[#7a5c3c]"
                              >
                                {isExpanded ? "Show less" : "Read more"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="mt-2 text-[11px] italic text-[#b4aca5]">No reasoning summary stored for this run.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

type DrawdownSeriesPayload =
  | { source: "vw_regime_daily"; rows: RegimeRow[] }
  | { source: "vw_strategy_daily"; rows: StrategyDailyRow[] };

export function DrawdownsTab({ data }: BaseTabProps) {
  const selection = useDailySelection(data);

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

export function DataQualityTab({ data }: BaseTabProps) {
  const allMarkets = useMemo(() => getMarketOptions(data), [data]);
  const [marketFilter, setMarketFilter] = useState("All");
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
      <TabMarketSelector markets={allMarkets} value={marketFilter} onChange={setMarketFilter} />
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
