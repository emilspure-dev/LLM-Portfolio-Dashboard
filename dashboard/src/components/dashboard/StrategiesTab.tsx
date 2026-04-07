import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { KpiCard } from "./KpiCard";
import { FigureExportControls } from "./FigureExportControls";
import { SectionHeader, SoftHr } from "./SectionHeader";
import {
  COLORS,
  MARKET_LABELS,
  MARKET_SHORT_LABELS,
  getMarketShortLabel,
  getSourceDisplayName,
  getStrategyColor,
  getStrategyDisplayName,
  sharpeColor,
} from "@/lib/constants";
import {
  buildBenchmarkComparisonRows,
  buildStrategySummaryWithRunSharpe,
  excludeJapan25H2Runs,
  percentile,
  stdDev,
} from "@/lib/data-loader";
import type { EvaluationData, RunRow } from "@/lib/types";

/** Stable [0, 1) for jitter so dots don’t jump on re-render. */
function jitter01(run: RunRow): number {
  const s = `${run.run_id ?? ""}|${run.strategy_key ?? ""}|${run.market ?? ""}|${run.period ?? ""}|${run.model ?? ""}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`dashboard-panel-strong rounded-[20px] p-4 md:p-5 ${className}`}>
      {children}
    </div>
  );
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

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "rgba(255, 255, 252, 0.95)",
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

const CHART_X_TICK = { fontSize: 11, fill: "#8f8780" };
const CHART_Y_TICK = { fontSize: 11, fill: "#aca49d" };
const CHART_LEGEND_WRAPPER = {
  fontSize: 11,
  color: "#6f6863",
  paddingTop: 8,
};

function runCountByStrategy(runs: RunRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of runs) {
    if (r.valid === false) {
      continue;
    }
    const k = r.strategy_key ?? "unknown";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

const SHARPE_HIST_COLORS = {
  gptRetail: COLORS.accent,
  gptAdvanced: COLORS.orange,
  equalWeight: COLORS.cyan,
  meanVariance: COLORS.purple,
  sixtyForty: COLORS.slate,
  index: COLORS.amber,
  famaFrench: "#818CF8",
} as const;

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function runStrategySharpes(runs: RunRow[], strategyKey: string): number[] {
  return runs
    .filter((run) => run.strategy_key === strategyKey)
    .map((run) => run.sharpe_ratio)
    .filter((value): value is number => value != null && Number.isFinite(value));
}

function buildSharpeHistogramBins(
  retail: number[],
  advanced: number[],
  binWidth: number
) {
  const all = [...retail, ...advanced];
  if (all.length === 0) return [];
  const minValue = Math.min(...all);
  const maxValue = Math.max(...all);
  const start = Math.floor((minValue - binWidth) / binWidth) * binWidth;
  const end = Math.ceil((maxValue + binWidth) / binWidth) * binWidth;
  const bins: Array<{ mid: number; retail: number; advanced: number }> = [];
  for (let left = start; left < end; left += binWidth) {
    const right = left + binWidth;
    const mid = left + binWidth / 2;
    bins.push({
      mid,
      retail: retail.filter((value) => value >= left && value < right).length,
      advanced: advanced.filter((value) => value >= left && value < right).length,
    });
  }
  return bins;
}

interface StrategiesTabProps {
  data: EvaluationData;
  runs: RunRow[];
}

export function StrategiesTab({ data, runs }: StrategiesTabProps) {
  const allMarkets: string[] = data.filters?.markets ?? [];
  const [marketFilter, setMarketFilter] = useState("All");
  const [excludeJapan25H2, setExcludeJapan25H2] = useState(false);
  const strategiesDistributionRef = useRef<HTMLDivElement>(null);
  const strategiesBenchmarkRef = useRef<HTMLDivElement>(null);
  const strategiesCumulativeRef = useRef<HTMLDivElement>(null);
  const strategiesMeanSharpeRef = useRef<HTMLDivElement>(null);
  const strategiesRiskReturnRef = useRef<HTMLDivElement>(null);
  const strategiesDispersionRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(
    () => buildStrategySummaryWithRunSharpe(data.summary_rows, marketFilter, runs),
    [data.summary_rows, marketFilter, runs]
  );
  const scopedRuns = useMemo(
    () => (marketFilter === "All" ? runs : runs.filter((r) => r.market === marketFilter)),
    [runs, marketFilter]
  );
  const localRuns = useMemo(
    () => (excludeJapan25H2 ? excludeJapan25H2Runs(scopedRuns) : scopedRuns),
    [scopedRuns, excludeJapan25H2]
  );
  const runCounts = useMemo(() => runCountByStrategy(localRuns), [localRuns]);

  const sortedBySharpe = useMemo(
    () =>
      [...summary].sort(
        (left, right) =>
          (right.mean_sharpe ?? -Infinity) - (left.mean_sharpe ?? -Infinity)
      ),
    [summary]
  );

  const topSharpe = sortedBySharpe[0];
  const bestReturn = useMemo(
    () =>
      [...summary].sort(
        (left, right) =>
          (right.mean_annualized_return ?? -Infinity) -
          (left.mean_annualized_return ?? -Infinity)
      )[0],
    [summary]
  );
  const lowestVol = useMemo(
    () =>
      [...summary]
        .filter((row) => row.mean_volatility != null && Number.isFinite(row.mean_volatility))
        .sort(
          (left, right) =>
            (left.mean_volatility ?? Infinity) - (right.mean_volatility ?? Infinity)
        )[0],
    [summary]
  );
  const bestBeatIndex = useMemo(
    () =>
      [...summary]
        .filter((row) => row.pct_runs_beating_index_sharpe != null)
        .sort(
          (left, right) =>
            (right.pct_runs_beating_index_sharpe ?? -Infinity) -
            (left.pct_runs_beating_index_sharpe ?? -Infinity)
        )[0],
    [summary]
  );

  const sharpeHistogramModel = useMemo(() => {
    const retail = runStrategySharpes(localRuns, "gpt_retail");
    const advanced = runStrategySharpes(localRuns, "gpt_advanced");
    let binWidth = 0.42;
    let bins = buildSharpeHistogramBins(retail, advanced, binWidth);
    while (bins.length > 42 && binWidth < 2.5) {
      binWidth += 0.14;
      bins = buildSharpeHistogramBins(retail, advanced, binWidth);
    }
    const summaryMean = (key: string) => {
      const row = summary.find((item) => item.strategy_key === key);
      return row?.mean_sharpe != null && Number.isFinite(row.mean_sharpe)
        ? row.mean_sharpe
        : null;
    };
    return {
      retail,
      advanced,
      bins,
      meanMarkers: [
        { key: "adv", value: mean(advanced), label: "GPT (Advanced) mean", color: SHARPE_HIST_COLORS.gptAdvanced, dashed: true },
        { key: "ret", value: mean(retail), label: "GPT (Retail) mean", color: SHARPE_HIST_COLORS.gptRetail, dashed: true },
        { key: "ew", value: summaryMean("equal_weight"), label: "Equal Weight mean", color: SHARPE_HIST_COLORS.equalWeight, dashed: false },
        { key: "mv", value: summaryMean("mean_variance"), label: "Mean-Variance mean", color: SHARPE_HIST_COLORS.meanVariance, dashed: false },
        { key: "ix", value: summaryMean("index"), label: "Market Index mean", color: SHARPE_HIST_COLORS.index, dashed: false },
        { key: "sf", value: summaryMean("sixty_forty"), label: "60/40 mean", color: SHARPE_HIST_COLORS.sixtyForty, dashed: false },
        { key: "ff", value: summaryMean("fama_french"), label: "Fama-French mean", color: SHARPE_HIST_COLORS.famaFrench, dashed: false },
      ].filter(
        (marker): marker is { key: string; value: number; label: string; color: string; dashed: boolean } =>
          marker.value != null && Number.isFinite(marker.value)
      ),
    };
  }, [localRuns, summary]);

  const dispersionStats = useMemo(() => {
    const retail = sharpeHistogramModel.retail;
    const advanced = sharpeHistogramModel.advanced;
    const build = (values: number[]) => {
      const q1 = percentile(values, 0.25);
      const q3 = percentile(values, 0.75);
      return {
        mean: mean(values),
        std: stdDev(values),
        iqr: q1 != null && q3 != null ? q3 - q1 : null,
      };
    };
    return {
      retail: build(retail),
      advanced: build(advanced),
    };
  }, [sharpeHistogramModel]);

  const sharpeOutliers = useMemo(() => {
    const rows = [
      ...localRuns
        .filter((run) => run.strategy_key === "gpt_retail" || run.strategy_key === "gpt_advanced")
        .map((run) => ({
          runLabel:
            run.run_id != null && String(run.run_id).length > 0
              ? `Run ${run.run_id}`
              : run.path_id != null
                ? `Path ${run.path_id}`
                : "Run",
          strategyLabel: getStrategyDisplayName(run.strategy ?? run.strategy_key ?? "", run.strategy_key),
          strategyKey: run.strategy_key ?? "",
          prompt: run.prompt_type ?? "—",
          market: run.market ?? "—",
          period: run.period ?? "—",
          sharpe: run.sharpe_ratio,
        }))
        .filter((row): row is typeof row & { sharpe: number } => row.sharpe != null && Number.isFinite(row.sharpe)),
    ];
    const values = rows.map((row) => row.sharpe);
    const q1 = percentile(values, 0.25);
    const q3 = percentile(values, 0.75);
    if (q1 == null || q3 == null) return [];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    return rows
      .filter((row) => row.sharpe < lower || row.sharpe > upper)
      .sort((left, right) => right.sharpe - left.sharpe)
      .slice(0, 10);
  }, [localRuns]);

  const benchmarkComparisonRows = useMemo(
    () => buildBenchmarkComparisonRows(localRuns),
    [localRuns]
  );

  const cumulativePathData = useMemo(() => {
    const strategyKeys = ["gpt_retail", "gpt_advanced", "index", "equal_weight", "mean_variance", "sixty_forty", "fama_french"];
    const grouped = new Map<string, Map<string, number[]>>();
    for (const run of localRuns) {
      const strategyKey = String(run.strategy_key ?? "");
      if (!strategyKeys.includes(strategyKey)) continue;
      const period = String(run.period ?? "");
      const ret = run.period_return ?? run.net_return ?? run.period_return_net;
      if (ret == null || !Number.isFinite(ret)) continue;
      const periodBucket = grouped.get(strategyKey) ?? new Map<string, number[]>();
      const values = periodBucket.get(period) ?? [];
      values.push(ret);
      periodBucket.set(period, values);
      grouped.set(strategyKey, periodBucket);
    }

    const orderedPeriods = Array.from(
      new Set(
        localRuns.map((run) => run.period).filter((value): value is string => Boolean(value))
      )
    ).sort();
    const cumulative = new Map<string, number>(strategyKeys.map((key) => [key, 1]));
    return orderedPeriods.map((period) => {
      const row: Record<string, string | number | null> = { period };
      for (const key of strategyKeys) {
        const values = grouped.get(key)?.get(period) ?? [];
        const avg = mean(values);
        const next = avg != null ? (cumulative.get(key) ?? 1) * (1 + avg) : cumulative.get(key) ?? 1;
        cumulative.set(key, next);
        row[key] = (next - 1) * 100;
      }
      return row;
    });
  }, [localRuns]);

  const periodContributionRows = useMemo(() => {
    const targetKeys = ["gpt_retail", "gpt_advanced", "index"];
    const grouped = new Map<string, Map<string, number[]>>();
    for (const run of localRuns) {
      const strategyKey = String(run.strategy_key ?? "");
      if (!targetKeys.includes(strategyKey)) continue;
      const period = String(run.period ?? "");
      const sharpe = run.sharpe_ratio;
      if (sharpe == null || !Number.isFinite(sharpe)) continue;
      const strategyMap = grouped.get(period) ?? new Map<string, number[]>();
      const bucket = strategyMap.get(strategyKey) ?? [];
      bucket.push(sharpe);
      strategyMap.set(strategyKey, bucket);
      grouped.set(period, strategyMap);
    }
    return Array.from(grouped.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([period, strategyMap]) => ({
        period,
        gpt_retail: mean(strategyMap.get("gpt_retail") ?? []),
        gpt_advanced: mean(strategyMap.get("gpt_advanced") ?? []),
        index: mean(strategyMap.get("index") ?? []),
      }));
  }, [localRuns]);

  const sharpeBarData = useMemo(
    () =>
      sortedBySharpe.map((row) => {
        const base = getStrategyDisplayName(row.Strategy, row.strategy_key);
        let marketSuffix = "";
        if (marketFilter === "All") {
          if (row.markets.length > 1) {
            marketSuffix = " · All Markets";
          } else if (row.markets.length === 1 && row.markets[0]) {
            marketSuffix = ` · ${getMarketShortLabel(row.markets[0])}`;
          }
        }
        const barKey = `${row.strategy_key}|${[...row.markets].sort().join(",")}|${[...row.prompt_types].sort().join(",")}`;
        return {
          Strategy: `${base}${marketSuffix}`,
          barKey,
          strategy_key: row.strategy_key,
          mean_sharpe: row.mean_sharpe,
        };
      }),
    [sortedBySharpe, marketFilter]
  );

  const scatterData = useMemo(
    () =>
      summary
        .filter(
          (row) =>
            row.mean_volatility != null &&
            row.mean_annualized_return != null &&
            Number.isFinite(row.mean_volatility) &&
            Number.isFinite(row.mean_annualized_return)
        )
        .map((row) => {
          const name = getStrategyDisplayName(row.Strategy, row.strategy_key);
          const market = row.market ?? "";
          const scatterKey = `${row.strategy_key}::${market}::${row.prompt_type ?? ""}`;
          const legendLabel =
            marketFilter === "All" && market
              ? `${name} · ${MARKET_SHORT_LABELS[market] ?? market}`
              : name;
          return {
            scatterKey,
            legendLabel,
            name,
            strategy_key: row.strategy_key,
            market,
            volPct: (row.mean_volatility as number) * 100,
            retPct: (row.mean_annualized_return as number) * 100,
          };
        }),
    [summary, marketFilter]
  );

  const riskReturnLegendRows = useMemo(() => {
    return [...scatterData].sort((a, b) => a.legendLabel.localeCompare(b.legendLabel));
  }, [scatterData]);

  const marketScope =
    marketFilter === "All" ? "all markets" : (MARKET_LABELS[marketFilter] ?? marketFilter);

  if (!summary.length) {
    return (
      <div className="space-y-4 pb-1">
        {allMarkets.length > 0 && (
          <div className="dashboard-panel rounded-[18px] px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="dashboard-label shrink-0">Market</span>
              <select
                value={marketFilter}
                onChange={(e) => setMarketFilter(e.target.value)}
                className="rounded-[12px] border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.72)] px-3 py-1.5 text-[12px] font-medium text-[#6f6863] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] outline-none"
              >
                <option value="All">All Markets</option>
                {allMarkets.map((m) => (
                  <option key={m} value={m}>{MARKET_LABELS[m] ?? m}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        <SectionHeader>Performance</SectionHeader>
        <Panel className="flex min-h-[200px] items-center justify-center">
          <p className="text-center text-[13px] text-[#9b938b]">
            No strategy summary rows for {marketScope}. Select a different market or check the experiment.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-1">
      {allMarkets.length > 0 && (
        <div className="dashboard-panel rounded-[18px] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="dashboard-label shrink-0">Market</span>
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="rounded-[12px] border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.72)] px-3 py-1.5 text-[12px] font-medium text-[#6f6863] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] outline-none"
            >
              <option value="All">All Markets</option>
              {allMarkets.map((m) => (
                <option key={m} value={m}>{MARKET_LABELS[m] ?? m}</option>
              ))}
            </select>
            <label className="ml-auto flex items-center gap-2 text-[12px] font-medium text-[#6f6863]">
              <input
                type="checkbox"
                checked={excludeJapan25H2}
                onChange={(e) => setExcludeJapan25H2(e.target.checked)}
              />
              Exclude Japan H2 2025
            </label>
          </div>
        </div>
      )}
      <div>
        <SectionHeader>Performance</SectionHeader>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#7b736e]">
          Use this view to rank strategies, compare their risk/return trade-offs, and inspect how GPT run outcomes are
          distributed in{" "}
          <strong>{marketScope}</strong>.
        </p>
        {excludeJapan25H2 && (
          <p className="mt-2 text-[11px] leading-5 text-[#8f8780]">
            Sensitivity mode is active: runs from `Japan · H2 2025` are excluded from run-level charts and tables below.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Best Mean Sharpe"
          value={
            topSharpe?.mean_sharpe != null && Number.isFinite(topSharpe.mean_sharpe)
              ? topSharpe.mean_sharpe.toFixed(2)
              : "—"
          }
          color={sharpeColor(topSharpe?.mean_sharpe)}
          sub={topSharpe ? getStrategyDisplayName(topSharpe.Strategy, topSharpe.strategy_key) : "—"}
        />
        <KpiCard
          label="Best Annualized Return"
          value={formatPctFromRatio(bestReturn?.mean_annualized_return, 1)}
          color={COLORS.green}
          sub={bestReturn ? getStrategyDisplayName(bestReturn.Strategy, bestReturn.strategy_key) : "—"}
        />
        <KpiCard
          label="Lowest volatility"
          value={formatPctFromRatio(lowestVol?.mean_volatility, 1)}
          color={COLORS.cyan}
          sub={lowestVol ? getStrategyDisplayName(lowestVol.Strategy, lowestVol.strategy_key) : "—"}
        />
        <KpiCard
          label="Highest Beat-Index Rate"
          value={formatPctFromNumber(bestBeatIndex?.pct_runs_beating_index_sharpe, 0)}
          color={COLORS.amber}
          sub={bestBeatIndex ? getStrategyDisplayName(bestBeatIndex.Strategy, bestBeatIndex.strategy_key) : "—"}
        />
      </div>

      <SoftHr />

      <div>
        <SectionHeader>Run Distribution</SectionHeader>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#7b736e]">
          This view shows how GPT run outcomes are distributed within the current market scope, while the dotted and dashed
          markers anchor those runs against benchmark and GPT mean Sharpe levels.
        </p>
      </div>
      {sharpeHistogramModel.retail.length > 0 || sharpeHistogramModel.advanced.length > 0 ? (
        <Panel>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <p className="dashboard-label">Distribution of GPT run Sharpe ratios</p>
            <FigureExportControls
              captureRef={strategiesDistributionRef}
              slug="performance-sharpe-distribution"
              caption="Performance — Distribution of GPT Run Sharpe Ratios"
              experimentId={data.active_experiment_id}
            />
          </div>
          <p className="mb-3 text-[11px] leading-5 text-[#8a827a]">
            The filled areas show the run-level Sharpe distribution for GPT (Retail) and GPT (Advanced). Dashed markers show
            GPT means; dotted markers show benchmark means for the same market scope.
          </p>
          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 border-b border-[rgba(232,224,217,0.65)] pb-3 text-[10px] sm:grid-cols-3 lg:grid-cols-4">
            {sharpeHistogramModel.meanMarkers
              .sort((a, b) => a.value - b.value)
              .map((marker) => (
                <span key={marker.key} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-[2px] w-4 shrink-0"
                    style={{
                      backgroundColor: marker.color,
                      borderTop: marker.dashed ? `2px dashed ${marker.color}` : `2px dotted ${marker.color}`,
                      height: 0,
                    }}
                  />
                  <span style={{ color: marker.color }} className="font-semibold">
                    {marker.label}: {marker.value.toFixed(2)}
                  </span>
                </span>
              ))}
          </div>
          {(() => {
            const markerXs = sharpeHistogramModel.meanMarkers.map((marker) => marker.value);
            const binMids = sharpeHistogramModel.bins.map((bin) => bin.mid);
            const allXs = [...binMids, ...markerXs];
            const xMin = Math.floor((Math.min(...allXs) - 0.5) * 2) / 2;
            const xMax = Math.ceil((Math.max(...allXs) + 0.5) * 2) / 2;
            return (
              <div ref={strategiesDistributionRef} className="min-w-0">
                <ResponsiveContainer width="100%" height={340}>
                  <AreaChart data={sharpeHistogramModel.bins} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
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
                      formatter={(value: number | undefined, name: string) => [`${value ?? 0} run${value === 1 ? "" : "s"}`, name]}
                      labelFormatter={(mid) => `Sharpe ≈ ${typeof mid === "number" ? mid.toFixed(2) : mid}`}
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
                    {sharpeHistogramModel.meanMarkers.map((marker) => (
                      <ReferenceLine
                        key={marker.key}
                        x={marker.value}
                        stroke={marker.color}
                        strokeWidth={2.2}
                        strokeDasharray={marker.dashed ? "8 4" : "3 3"}
                        ifOverflow="extendDomain"
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
          <p className="mt-2 text-[10px] text-[#a39b93]">
            X-axis: Sharpe ratio. Y-axis: run count per bin.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-[14px] border border-[rgba(232,224,217,0.8)] bg-[rgba(255,255,252,0.62)] px-3 py-2">
              <p className="text-[11px] font-semibold text-[#6f6863]">Distribution width</p>
              <p className="mt-1 text-[11px] text-[#8d857f]">
                GPT (Retail): sd {dispersionStats.retail.std?.toFixed(2) ?? "—"} | IQR {dispersionStats.retail.iqr?.toFixed(2) ?? "—"}
              </p>
              <p className="text-[11px] text-[#8d857f]">
                GPT (Advanced): sd {dispersionStats.advanced.std?.toFixed(2) ?? "—"} | IQR {dispersionStats.advanced.iqr?.toFixed(2) ?? "—"}
              </p>
            </div>
            <div className="rounded-[14px] border border-[rgba(232,224,217,0.8)] bg-[rgba(255,255,252,0.62)] px-3 py-2">
              <p className="text-[11px] font-semibold text-[#6f6863]">Outlier flagging</p>
              <p className="mt-1 text-[11px] text-[#8d857f]">
                {sharpeOutliers.length > 0
                  ? `${sharpeOutliers.length} GPT run outliers flagged with the 1.5×IQR rule.`
                  : "No GPT run outliers were flagged in this market scope."}
              </p>
            </div>
          </div>
          {sharpeOutliers.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-[11px]">
                <thead>
                  <tr className="border-b border-[rgba(227,220,214,0.7)] text-left text-[#b4aca5]">
                    <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Run</th>
                    <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Strategy</th>
                    <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Market</th>
                    <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Period</th>
                    <th className="py-2 text-right font-semibold uppercase tracking-[0.12em]">Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {sharpeOutliers.map((row) => (
                    <tr key={`${row.runLabel}-${row.strategyKey}-${row.period}`} className="border-b border-[rgba(227,220,214,0.45)] last:border-0">
                      <td className="py-2 pr-3 text-[#5e5955]">{row.runLabel}</td>
                      <td className="py-2 pr-3 text-[#5e5955]">{row.strategyLabel}</td>
                      <td className="py-2 pr-3 text-[#8d857f]">{row.market}</td>
                      <td className="py-2 pr-3 text-[#8d857f]">{row.period}</td>
                      <td className="py-2 text-right text-[#8d857f]">{row.sharpe.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : (
        <Panel>
          <p className="text-[12px] leading-5 text-[#8a827a]">
            No GPT run-level Sharpe observations are available for this market scope.
          </p>
        </Panel>
      )}

      <SoftHr />

      {benchmarkComparisonRows.length > 0 && (
        <Panel>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <p className="dashboard-label">Benchmark win rates with confidence intervals</p>
            <FigureExportControls
              captureRef={strategiesBenchmarkRef}
              slug="performance-benchmark-win-rates"
              caption="Performance — Benchmark win rates with confidence intervals"
              experimentId={data.active_experiment_id}
            />
          </div>
          <div ref={strategiesBenchmarkRef} className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[11px]">
              <thead>
                <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Strategy</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Benchmark</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Wins</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Win rate</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">95% CI</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Mean Sharpe delta</th>
                </tr>
              </thead>
              <tbody>
                {benchmarkComparisonRows.map((row) => (
                  <tr key={`${row.strategyKey}-${row.benchmarkKey}`} className="border-b border-[rgba(227,220,214,0.8)] last:border-0">
                    <td className="px-3 py-2.5 font-medium text-[#5e5955]">{getStrategyDisplayName(row.strategyLabel, row.strategyKey)}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">{getStrategyDisplayName(row.benchmarkKey, row.benchmarkKey)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{`${row.wins}/${row.total}`}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{formatPctFromRatio(row.winRate, 0)}</td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">
                      {row.ciLow != null && row.ciHigh != null
                        ? `${formatPctFromRatio(row.ciLow, 0)} - ${formatPctFromRatio(row.ciHigh, 0)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#8d857f]">{row.meanDelta != null ? row.meanDelta.toFixed(2) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {cumulativePathData.length > 0 && (
        <Panel>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <p className="dashboard-label">Cumulative benchmark comparison</p>
            <FigureExportControls
              captureRef={strategiesCumulativeRef}
              slug="performance-cumulative-benchmark-comparison"
              caption="Performance — Cumulative benchmark comparison"
              experimentId={data.active_experiment_id}
            />
          </div>
          <div ref={strategiesCumulativeRef} className="min-w-0">
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={cumulativePathData} margin={{ top: 8, right: 14, left: 6, bottom: 8 }}>
                <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                <XAxis dataKey="period" tick={CHART_X_TICK} axisLine={false} tickLine={false} />
                <YAxis tick={CHART_Y_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                <Tooltip {...tooltipStyle} formatter={(value: number) => `${value.toFixed(1)}%`} />
                <Legend wrapperStyle={CHART_LEGEND_WRAPPER} iconType="line" />
                <Area type="monotone" dataKey="gpt_retail" name="GPT (Retail)" stroke={SHARPE_HIST_COLORS.gptRetail} fill={SHARPE_HIST_COLORS.gptRetail} fillOpacity={0.08} />
                <Area type="monotone" dataKey="gpt_advanced" name="GPT (Advanced)" stroke={SHARPE_HIST_COLORS.gptAdvanced} fill={SHARPE_HIST_COLORS.gptAdvanced} fillOpacity={0.08} />
                <Area type="monotone" dataKey="index" name="Market Index" stroke={SHARPE_HIST_COLORS.index} fill={SHARPE_HIST_COLORS.index} fillOpacity={0.03} />
                <Area type="monotone" dataKey="equal_weight" name="Equal Weight" stroke={SHARPE_HIST_COLORS.equalWeight} fillOpacity={0} fill="transparent" />
                <Area type="monotone" dataKey="mean_variance" name="Mean-Variance" stroke={SHARPE_HIST_COLORS.meanVariance} fillOpacity={0} fill="transparent" />
                <Area type="monotone" dataKey="sixty_forty" name="60/40" stroke={SHARPE_HIST_COLORS.sixtyForty} fillOpacity={0} fill="transparent" />
                <Area type="monotone" dataKey="fama_french" name="Fama-French" stroke={SHARPE_HIST_COLORS.famaFrench} fillOpacity={0} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[10px] text-[#a39b93]">
            Approximate cumulative path from average run-level period returns in the selected market scope.
          </p>
        </Panel>
      )}

      {periodContributionRows.length > 0 && (
        <Panel>
          <div className="mb-4">
            <p className="dashboard-label">Per-period Sharpe contribution proxy</p>
            <p className="mt-1 text-[11px] leading-5 text-[#8a827a]">
              This is a descriptive proxy, not an additive decomposition of total Sharpe: it shows mean period Sharpe by period so you can see which windows dominate the headline profile.
            </p>
          </div>
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={periodContributionRows} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                <XAxis dataKey="period" tick={CHART_X_TICK} axisLine={false} tickLine={false} />
                <YAxis tick={CHART_Y_TICK} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(value: number | null) => (value != null ? value.toFixed(2) : "—")} />
                <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
                <Bar dataKey="gpt_retail" name="GPT (Retail)" fill={SHARPE_HIST_COLORS.gptRetail} radius={[6, 6, 0, 0]} />
                <Bar dataKey="gpt_advanced" name="GPT (Advanced)" fill={SHARPE_HIST_COLORS.gptAdvanced} radius={[6, 6, 0, 0]} />
                <Bar dataKey="index" name="Market Index" fill={SHARPE_HIST_COLORS.index} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      <SoftHr />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <p className="dashboard-label">Mean Sharpe by strategy</p>
            <FigureExportControls
              captureRef={strategiesMeanSharpeRef}
              slug="strategies-mean-sharpe-by-strategy"
              caption="Performance — Mean Sharpe by Strategy"
              experimentId={data.active_experiment_id}
            />
          </div>
          <div ref={strategiesMeanSharpeRef} className="min-w-0">
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={sharpeBarData} margin={{ top: 6, right: 12, left: 12, bottom: 88 }}>
              <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
              <XAxis
                dataKey="Strategy"
                tick={{ fontSize: 9, fill: "#8f8780" }}
                angle={-32}
                textAnchor="end"
                interval={0}
                height={96}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 10, fill: "#aca49d" }} axisLine={false} tickLine={false} />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number | undefined) =>
                  value != null && Number.isFinite(value) ? value.toFixed(2) : "—"
                }
              />
              <ReferenceLine y={0} stroke="rgba(192, 180, 170, 0.9)" strokeDasharray="3 6" />
              <Bar dataKey="mean_sharpe" radius={[10, 10, 0, 0]}>
                {sharpeBarData.map((row) => (
                  <Cell key={row.barKey} fill={getStrategyColor(row.strategy_key)} />
                ))}
              </Bar>
            </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <p className="dashboard-label">Risk / Return Summary</p>
            <FigureExportControls
              captureRef={strategiesRiskReturnRef}
              slug="strategies-risk-return-summary"
              caption="Performance — Risk / Return Summary"
              experimentId={data.active_experiment_id}
            />
          </div>
          {scatterData.length === 0 ? (
            <p className="py-16 text-center text-[12px] text-[#9b938b]">
              Need both mean volatility and mean annualized return in the summary for this chart.
            </p>
          ) : (
            <div ref={strategiesRiskReturnRef} className="min-w-0">
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" strokeDasharray="3 6" />
                <XAxis
                  type="number"
                  dataKey="volPct"
                  name="Volatility"
                  tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                  tick={{ fontSize: 10, fill: "#aca49d" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="number"
                  dataKey="retPct"
                  name="Annualized Return"
                  tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                  tick={{ fontSize: 10, fill: "#aca49d" }}
                  axisLine={false}
                  tickLine={false}
                />
                <ZAxis range={[60, 60]} />
                <Tooltip
                  {...tooltipStyle}
                  cursor={{ strokeDasharray: "3 6" }}
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0].payload as {
                      legendLabel: string;
                      volPct: number;
                      retPct: number;
                    };
                    return (
                      <div style={{ ...(tooltipStyle.contentStyle as React.CSSProperties), padding: "8px 12px", fontSize: 11 }}>
                        <p style={{ fontWeight: 600, marginBottom: 4, color: "#5c534c" }}>{d.legendLabel}</p>
                        <p style={{ color: "#8f8780" }}>Volatility : {d.volPct.toFixed(1)}%</p>
                        <p style={{ color: "#8f8780" }}>Annualized Return: {d.retPct.toFixed(1)}%</p>
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={scatterData}
                  fill={COLORS.accent}
                  shape={(props: Record<string, unknown>) => {
                    const cx = props.cx as number;
                    const cy = props.cy as number;
                    const payload = props.payload as { scatterKey: string; strategy_key: string };
                    const color = getStrategyColor(payload.strategy_key);
                    const r = 6;
                    return (
                      <g key={payload.scatterKey}>
                        <circle cx={cx} cy={cy} r={r} fill={color} stroke="white" strokeWidth={1.5} />
                      </g>
                    );
                  }}
                />
              </ScatterChart>
              </ResponsiveContainer>
              <p className="mt-2 text-[11px] text-[#9a928b]">
                Hover a point for details. Strategy names are listed below to avoid overlapping labels on the chart.
              </p>
              <div className="mt-3 max-h-[200px] space-y-1 overflow-y-auto pr-1 text-[11px] text-[#9a928b]">
                {riskReturnLegendRows.map((row) => (
                  <div
                    key={row.scatterKey}
                    className="flex min-w-0 items-baseline justify-between gap-3 border-b border-[rgba(227,220,214,0.5)] py-1 last:border-0"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: getStrategyColor(row.strategy_key) }}
                      />
                      <span className="truncate text-[#6f6863]">{row.legendLabel}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[#8d857f]">
                      σ {row.volPct.toFixed(1)}% · μ {row.retPct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Sharpe dispersion — GPT runs only (retail + advanced prompts) */}
      {(() => {
        const GPT_DISPERSION_KEYS = ["gpt_advanced", "gpt_retail"] as const;
        const gptDispersionRuns = localRuns.filter(
          (r) =>
            (r.prompt_type === "retail" || r.prompt_type === "advanced") &&
            r.strategy_key &&
            (r.strategy_key === "gpt_advanced" || r.strategy_key === "gpt_retail")
        );
        const strategyOrder = GPT_DISPERSION_KEYS.filter((k) =>
          gptDispersionRuns.some((r) => r.strategy_key === k && r.sharpe_ratio != null)
        );
        if (strategyOrder.length === 0) return null;

        const dispersionPoints = gptDispersionRuns
          .filter((r) => r.sharpe_ratio != null && r.strategy_key)
          .map((r) => {
            const idx = strategyOrder.indexOf(r.strategy_key as (typeof GPT_DISPERSION_KEYS)[number]);
            // Place each strategy in an equal-width band [idx, idx+1] with jitter around idx+0.5.
            // (Old layout used domain [-0.5, n-0.5], which made the left half-band only half as wide as
            // the middle band, so Advanced looked shifted right of its grid line.)
            const u = jitter01(r);
            const strategyIdx = idx + 0.15 + u * 0.7;
            return {
              strategyIdx,
              sharpe: r.sharpe_ratio as number,
              label: getStrategyDisplayName(r.strategy ?? r.strategy_key ?? "", r.strategy_key),
              strategyKey: r.strategy_key ?? "",
            };
          })
          .filter((p) => p.strategyIdx >= 0);

        if (dispersionPoints.length < 4) return null;

        return (
          <Panel>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <p className="dashboard-label">Sharpe Dispersion — GPT Runs</p>
              <FigureExportControls
                captureRef={strategiesDispersionRef}
                slug="strategies-sharpe-dispersion-gpt"
                caption="Performance — Sharpe Dispersion (GPT Retail and GPT Advanced)"
                experimentId={data.active_experiment_id}
              />
            </div>
            <div ref={strategiesDispersionRef} className="min-w-0">
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart margin={{ top: 8, right: 12, left: 12, bottom: 36 }}>
                <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" strokeDasharray="3 6" />
                <XAxis
                  type="number"
                  dataKey="strategyIdx"
                  domain={[0, strategyOrder.length]}
                  ticks={strategyOrder.map((_, i) => i + 0.5)}
                  tickFormatter={(v: number) => {
                    const idx = Math.min(
                      strategyOrder.length - 1,
                      Math.max(0, Math.round(Number(v) - 0.5))
                    );
                    const key = strategyOrder[idx];
                    if (!key) return "";
                    const row = summary.find((s) => s.strategy_key === key);
                    return row ? getStrategyDisplayName(row.Strategy, row.strategy_key) : getStrategyDisplayName(key, key);
                  }}
                  tick={{ fontSize: 9, fill: "#8f8780" }}
                  axisLine={false}
                  tickLine={false}
                  angle={-20}
                  textAnchor="end"
                  height={56}
                />
                <YAxis
                  type="number"
                  dataKey="sharpe"
                  tick={{ fontSize: 10, fill: "#aca49d" }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: "Sharpe ratio", angle: -90, position: "insideLeft", offset: 4, style: { fontSize: 9, fill: "#aca49d" } }}
                />
                <ZAxis range={[20, 20]} />
                <Tooltip
                  {...tooltipStyle}
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0].payload as { label: string; sharpe: number };
                    return (
                      <div style={{ ...(tooltipStyle.contentStyle as React.CSSProperties), padding: "8px 12px", fontSize: 11 }}>
                        <p style={{ fontWeight: 600, marginBottom: 3, color: "#5c534c" }}>{d.label}</p>
                        <p style={{ color: "#8f8780" }}>Sharpe: {d.sharpe.toFixed(2)}</p>
                      </div>
                    );
                  }}
                />
                {Array.from({ length: Math.max(0, strategyOrder.length - 1) }, (_, i) => (
                  <ReferenceLine
                    key={`sep-${i + 1}`}
                    x={i + 1}
                    stroke="rgba(220,213,206,0.4)"
                    strokeDasharray="3 6"
                  />
                ))}
                <Scatter data={dispersionPoints}>
                  {dispersionPoints.map((p, i) => (
                    <Cell key={i} fill={getStrategyColor(p.strategyKey)} fillOpacity={0.55} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
            <p className="mt-2 text-[10px] text-[#b4aca5]">
              GPT strategy runs only (retail and advanced prompts). Each dot is one run; horizontal spread is jitter.
            </p>
            </div>
          </Panel>
        );
      })()}

      <SectionHeader>Strategy Details Table</SectionHeader>
      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[1080px] text-[11px]">
          <thead>
            <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Strategy
              </th>
              <th className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Market
              </th>
              <th className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Source
              </th>
              <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Runs
              </th>
              <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Sharpe
              </th>
              <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Annualized Return
              </th>
              <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Volatility
              </th>
              <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Beat Index
              </th>
              <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Beat 60/40
              </th>
              <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Mean Period Return
              </th>
              <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Turnover
              </th>
              <th className="px-2 py-2.5 pr-4 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Observations
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedBySharpe.map((row) => {
              const marketLabel =
                row.markets && row.markets.length === 1
                  ? getMarketShortLabel(row.markets[0])
                  : "All Markets";
              return (
                <tr
                  key={`${row.strategy_key}::${row.source_type}::${row.markets?.[0] ?? ""}`}
                  className="border-b border-[rgba(227,220,214,0.8)] last:border-0"
                >
                  <td className="px-3 py-2.5 font-medium text-[#5e5955]">
                    {getStrategyDisplayName(row.Strategy, row.strategy_key)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-[#8d857f]">{marketLabel}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-[#8d857f]">{getSourceDisplayName(row.source_type)}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-[#8d857f]">
                    {runCounts.get(row.strategy_key) ?? "—"}
                  </td>
                  <td
                    className="whitespace-nowrap px-2 py-2.5 text-right font-medium tabular-nums"
                    style={{ color: sharpeColor(row.mean_sharpe) }}
                  >
                    {row.mean_sharpe != null && Number.isFinite(row.mean_sharpe)
                      ? row.mean_sharpe.toFixed(2)
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-[#8d857f]">
                    {formatPctFromRatio(row.mean_annualized_return, 1)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-[#8d857f]">
                    {formatPctFromRatio(row.mean_volatility, 1)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-[#8d857f]">
                    {formatPctFromNumber(row.pct_runs_beating_index_sharpe, 0)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-[#8d857f]">
                    {formatPctFromNumber(row.pct_runs_beating_sixty_forty_sharpe, 0)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-[#8d857f]">
                    {formatPctFromRatio(row.net_return_mean, 1)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-[#8d857f]">
                    {formatPctFromRatio(row.mean_turnover, 1)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 pr-4 text-right tabular-nums text-[#8d857f]">
                    {row.n_observations > 0 ? row.n_observations.toLocaleString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <p className="text-[11px] leading-5 text-[#a39b93]">
        Use <strong>Factor Style</strong> for the style-based return explanation, <strong>Paths</strong> for daily
        equity and drawdown drill-down, and <strong>Markets</strong> for heterogeneity across regions and periods.
      </p>
    </div>
  );
}
