import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { buildStrategySummaryWithRunSharpe } from "@/lib/data-loader";
import type { FactorStyleSummaryRow } from "@/lib/api-types";
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

function aggregateFactorTiltsByStrategy(
  rows: FactorStyleSummaryRow[],
  marketFilter: string
) {
  const scoped =
    marketFilter === "All" ? rows : rows.filter((r) => r.market === marketFilter);

  type Acc = {
    strategy: string;
    tw: number;
    sz: number;
    val: number;
    mom: number;
    lr: number;
    qual: number;
  };

  const map = new Map<string, Acc>();
  for (const r of scoped) {
    const weight = Math.max(1, r.path_count ?? 1);
    const acc =
      map.get(r.strategy_key) ??
      ({
        strategy: r.strategy,
        tw: 0,
        sz: 0,
        val: 0,
        mom: 0,
        lr: 0,
        qual: 0,
      } satisfies Acc);
    acc.strategy = r.strategy;
    acc.tw += weight;
    if (r.mean_size_exposure != null) {
      acc.sz += r.mean_size_exposure * weight;
    }
    if (r.mean_value_exposure != null) {
      acc.val += r.mean_value_exposure * weight;
    }
    if (r.mean_momentum_exposure != null) {
      acc.mom += r.mean_momentum_exposure * weight;
    }
    if (r.mean_low_risk_exposure != null) {
      acc.lr += r.mean_low_risk_exposure * weight;
    }
    if (r.mean_quality_exposure != null) {
      acc.qual += r.mean_quality_exposure * weight;
    }
    map.set(r.strategy_key, acc);
  }

  return Array.from(map.entries())
    .map(([strategy_key, a]) => ({
      strategy_key,
      strategy: a.strategy,
      size: a.tw > 0 ? a.sz / a.tw : null,
      value: a.tw > 0 ? a.val / a.tw : null,
      momentum: a.tw > 0 ? a.mom / a.tw : null,
      lowRisk: a.tw > 0 ? a.lr / a.tw : null,
      quality: a.tw > 0 ? a.qual / a.tw : null,
    }))
    .filter((row) =>
      [row.size, row.value, row.momentum, row.lowRisk, row.quality].some(
        (v) => v != null && !Number.isNaN(v)
      )
    )
    .sort((a, b) => a.strategy.localeCompare(b.strategy));
}

interface StrategiesTabProps {
  data: EvaluationData;
  runs: RunRow[];
}

export function StrategiesTab({ data, runs }: StrategiesTabProps) {
  const allMarkets: string[] = data.filters?.markets ?? [];
  const [marketFilter, setMarketFilter] = useState("All");
  const strategiesMeanSharpeRef = useRef<HTMLDivElement>(null);
  const strategiesRiskReturnRef = useRef<HTMLDivElement>(null);
  const strategiesDispersionRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(
    () => buildStrategySummaryWithRunSharpe(data.summary_rows, marketFilter, runs),
    [data.summary_rows, marketFilter, runs]
  );
  const localRuns = useMemo(
    () => (marketFilter === "All" ? runs : runs.filter((r) => r.market === marketFilter)),
    [runs, marketFilter]
  );
  const runCounts = useMemo(() => runCountByStrategy(localRuns), [localRuns]);
  const factorAgg = useMemo(
    () => aggregateFactorTiltsByStrategy(data.factor_style_rows ?? [], marketFilter),
    [data.factor_style_rows, marketFilter]
  );

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
        <SectionHeader>Strategies</SectionHeader>
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
          </div>
        </div>
      )}
      <div>
        <SectionHeader>Strategies</SectionHeader>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#7b736e]">
          Aggregated performance, risk, run counts, and factor tilts by strategy, currently showing{" "}
          <strong>{marketScope}</strong>.
        </p>
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <p className="dashboard-label">Mean Sharpe by strategy</p>
            <FigureExportControls
              captureRef={strategiesMeanSharpeRef}
              slug="strategies-mean-sharpe-by-strategy"
              caption="Strategies — Mean Sharpe by strategy"
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
              caption="Strategies — Risk / Return Summary"
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
                caption="Strategies — Sharpe Dispersion (GPT Retail and GPT Advanced)"
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

      <SectionHeader>Factor Tilts Table</SectionHeader>
      {data.factor_style_error ? (
        <Panel>
          <p className="text-[12px] leading-5 text-[#8b5348]">
            Factor Style API error: {data.factor_style_error}
          </p>
          <p className="mt-2 text-[12px] leading-5 text-[#9b938b]">
            Open the <strong>Factor Style</strong> tab for full troubleshooting notes (backend deploy,
            API base URL, DB view).
          </p>
        </Panel>
      ) : factorAgg.length === 0 ? (
        <Panel>
          <p className="text-[12px] leading-5 text-[#9b938b]">
            No factor-style rows for this scope (API returned 200 with an empty list). Daily path
            metrics do not have factor-exposure rows for this experiment yet, so try another
            experiment or rebuild the analytics export.
          </p>
        </Panel>
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-[11px]">
            <thead>
              <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                  Strategy
                </th>
                <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                  Size
                </th>
                <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                  Value
                </th>
                <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                  Momentum
                </th>
                <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                  Low risk
                </th>
                <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                  Quality
                </th>
              </tr>
            </thead>
            <tbody>
              {factorAgg.map((row) => (
                <tr
                  key={row.strategy_key}
                  className="border-b border-[rgba(227,220,214,0.8)] last:border-0"
                >
                  <td className="px-3 py-2.5 font-medium text-[#5e5955]">
                    {getStrategyDisplayName(row.strategy, row.strategy_key)}
                  </td>
                  {(["size", "value", "momentum", "lowRisk", "quality"] as const).map((k, i) => (
                    <td key={k} className="px-3 py-2.5 text-right tabular-nums text-[#8d857f]">
                      {row[k] != null && Number.isFinite(row[k] as number)
                        ? (row[k] as number).toFixed(3)
                        : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <p className="text-[11px] leading-5 text-[#a39b93]">
        For equity paths, drawdowns, holdings, and run-level detail, use{" "}
        <strong>Equity Curves</strong>, <strong>Drawdowns</strong>, <strong>Portfolios</strong>, and{" "}
        <strong>Run Explorer</strong>.
      </p>
    </div>
  );
}
