import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, CartesianGrid, LineChart, Line, Legend,
} from "recharts";
import { KpiCard } from "./KpiCard";
import { InsightCard } from "./InsightCard";
import { FigureExportControls } from "./FigureExportControls";
import { SectionHeader, SoftHr } from "./SectionHeader";
import { getCumulativeReturnSummary } from "@/lib/api-client";
import {
  MARKET_LABELS,
  getMarketShortLabel,
  getStrategyColor,
  getStrategyDisplayName,
  sharpeColor,
  fmt,
  fmtp,
} from "@/lib/constants";
import { apiRouteLikelyMissing } from "@/lib/data-loader";
import type { EvaluationData, Insight, RunRow } from "@/lib/types";

function formatChartDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

function formatChartTooltipDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatReturnPercent(value: number | string | null | undefined, decimals = 1) {
  const numericValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numericValue)) {
    return "—";
  }
  return `${(numericValue * 100).toFixed(decimals)}%`;
}

interface OverviewTabProps {
  data: EvaluationData;
  runs: RunRow[];
}

export function OverviewTab({ data, runs }: OverviewTabProps) {
  const { summary } = data;
  const overviewAccumulatedReturnRef = useRef<HTMLDivElement>(null);
  const overviewBeatIndexRef = useRef<HTMLDivElement>(null);
  const cumulativeReturnQuery = useQuery({
    queryKey: ["overview-cumulative-return", data.active_experiment_id],
    queryFn: async () => {
      try {
        return await getCumulativeReturnSummary({
          experiment_id: data.active_experiment_id,
        });
      } catch (error) {
        if (apiRouteLikelyMissing(error)) {
          return null;
        }
        throw error;
      }
    },
    enabled: Boolean(data.active_experiment_id),
    staleTime: 60_000,
  });

  // Beat rate chart data
  const beatIndexData = useMemo(() => {
    return summary
      .filter((s) => s.pct_runs_beating_index_sharpe != null && !isNaN(s.pct_runs_beating_index_sharpe))
      .sort((a, b) => a.pct_runs_beating_index_sharpe - b.pct_runs_beating_index_sharpe)
      .map((s) => ({
        name: getStrategyDisplayName(s.Strategy, s.strategy_key),
        value: Number(s.pct_runs_beating_index_sharpe.toFixed(1)),
        color: getStrategyColor(s.strategy_key),
      }));
  }, [summary]);

  // Insights
  const insights = useMemo(() => {
    const result: Insight[] = [];
    const gptRows = summary.filter(
      (s) => s.strategy_key === "gpt_simple" || s.strategy_key === "gpt_advanced"
    );
    const benchRows = summary.filter(
      (s) => s.strategy_key !== "gpt_simple" && s.strategy_key !== "gpt_advanced"
    );

    if (gptRows.length > 0 && benchRows.length > 0) {
      const bestGpt = gptRows.reduce((a, b) => {
        const as = a.mean_sharpe ?? -Infinity;
        const bs = b.mean_sharpe ?? -Infinity;
        return as > bs ? a : b;
      });
      const bestBench = benchRows.reduce((a, b) => {
        const as = a.mean_sharpe ?? -Infinity;
        const bs = b.mean_sharpe ?? -Infinity;
        return as > bs ? a : b;
      });
      const gptName = getStrategyDisplayName(bestGpt.Strategy, bestGpt.strategy_key);
      const gptS = bestGpt.mean_sharpe;
      const benchS = bestBench.mean_sharpe;
      if (
        gptS != null &&
        benchS != null &&
        Number.isFinite(gptS) &&
        Number.isFinite(benchS)
      ) {
        if (gptS > benchS) {
          result.push({
            type: "pos",
            title: "GPT outperforms benchmarks",
            body: `${gptName} achieves a mean Sharpe of ${fmt(gptS, 2)}, beating the best benchmark (${getStrategyDisplayName(bestBench.Strategy, bestBench.strategy_key)}: ${fmt(benchS, 2)}).`,
          });
        } else {
          result.push({
            type: "neg",
            title: "Benchmarks lead on Sharpe",
            body: `The best benchmark (${getStrategyDisplayName(bestBench.Strategy, bestBench.strategy_key)}: ${fmt(benchS, 2)}) outperforms the best GPT strategy (${gptName}: ${fmt(gptS, 2)}).`,
          });
        }
      }
    }

    for (const gr of gptRows) {
      const br = gr.pct_runs_beating_index_sharpe;
      if (br != null && !isNaN(br)) {
        const gn = getStrategyDisplayName(gr.Strategy, gr.strategy_key);
        const t = br > 50 ? "pos" : br > 30 ? "warn" : "neg";
        result.push({
          type: t,
          title: `${gn}: ${br.toFixed(0)}% Beat Index`,
          body: `${br > 50 ? "More than half" : "Less than half"} of ${gn} runs achieve a higher Sharpe ratio than the market index.`,
        });
      }
    }

    const meanGptHhi =
      data.overview_summary?.mean_gpt_hhi ??
      (() => {
        const gptHhi = runs
          .filter((r) => r.prompt_type === "simple" || r.prompt_type === "advanced")
          .map((r) => r.hhi)
          .filter((v): v is number => v != null && !isNaN(v));
        return gptHhi.length > 0
          ? gptHhi.reduce((a, b) => a + b, 0) / gptHhi.length
          : null;
      })();
    if (meanGptHhi != null && Number.isFinite(meanGptHhi)) {
      result.push({
        type: meanGptHhi > 0.15 ? "warn" : "pos",
        title: `Portfolio concentration: HHI = ${meanGptHhi.toFixed(3)}`,
        body: `${meanGptHhi > 0.15 ? "Portfolios tend to be concentrated" : "Portfolios are reasonably diversified"} (HHI ${meanGptHhi > 0.15 ? "above" : "below"} 0.15 threshold).`,
      });
    }

    return result;
  }, [data.overview_summary, runs, summary]);

  // Two-tier strategy grouping: one overall entry per strategy_key + per-market breakdown
  const strategyGroups = useMemo(() => {
    if (!data.summary_rows?.length) return null;

    const groups = new Map<string, typeof data.summary_rows>();
    for (const row of data.summary_rows) {
      const key = `${row.strategy_key}::${row.source_type}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    function wavg(
      rows: typeof data.summary_rows,
      get: (r: (typeof data.summary_rows)[0]) => number | null
    ): number | null {
      const valid = rows.filter((r) => {
        const v = get(r);
        return v != null && Number.isFinite(v);
      });
      if (!valid.length) return null;
      const totalObs = valid.reduce((s, r) => s + (r.observations ?? 1), 0);
      if (!totalObs) return null;
      return valid.reduce((s, r) => s + (get(r) as number) * (r.observations ?? 1), 0) / totalObs;
    }

    const result = Array.from(groups.entries()).map(([key, rows]) => {
      const rep = rows[0];
      const totalObs = rows.reduce((s, r) => s + (r.observations ?? 0), 0);
      const label = getStrategyDisplayName(rep.strategy, rep.strategy_key);
      const byMarket = rows
        .map((r) => ({ market: r.market, sharpe: r.mean_sharpe, ret: r.mean_annualized_return }))
        .sort((a, b) => {
          const order: Record<string, number> = { us: 0, germany: 1, japan: 2 };
          return (order[a.market] ?? 99) - (order[b.market] ?? 99);
        });
      return {
        key,
        label,
        strategyKey: rep.strategy_key,
        overallSharpe: wavg(rows, (r) => r.mean_sharpe),
        overallReturn: wavg(rows, (r) => r.mean_annualized_return),
        totalObs,
        byMarket,
      };
    });

    return result.sort((a, b) => {
      const aGpt = a.strategyKey.startsWith("gpt_");
      const bGpt = b.strategyKey.startsWith("gpt_");
      if (aGpt !== bGpt) return aGpt ? -1 : 1;
      return (b.overallSharpe ?? -Infinity) - (a.overallSharpe ?? -Infinity);
    });
  }, [data.summary_rows]);

  const cumulativeReturnChart = useMemo(() => {
    const rows = cumulativeReturnQuery.data ?? [];
    if (rows.length === 0) {
      return {
        chartRows: [] as Array<Record<string, string | number | null>>,
        series: [] as Array<{ key: string; label: string; color: string }>,
      };
    }

    const strategyOrder = new Map<string, number>();
    summary.forEach((row, index) => {
      if (!strategyOrder.has(row.strategy_key)) {
        strategyOrder.set(row.strategy_key, index);
      }
    });

    const grouped = new Map<
      string,
      {
        key: string;
        label: string;
        color: string;
        rows: typeof rows;
      }
    >();

    for (const row of rows) {
      const summaryRow = summary.find((item) => item.strategy_key === row.strategy_key);
      const bucket = grouped.get(row.strategy_key) ?? {
        key: row.strategy_key,
        label: getStrategyDisplayName(row.strategy ?? summaryRow?.Strategy ?? null, row.strategy_key),
        color: getStrategyColor(row.strategy_key),
        rows: [],
      };
      bucket.rows.push(row);
      grouped.set(row.strategy_key, bucket);
    }

    const series = Array.from(grouped.values()).sort((left, right) => {
      const leftGpt = left.key.startsWith("gpt_");
      const rightGpt = right.key.startsWith("gpt_");
      if (leftGpt !== rightGpt) return leftGpt ? -1 : 1;
      return (
        (strategyOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
        (strategyOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER)
      );
    });

    const chartMap = new Map<string, Record<string, string | number | null>>();
    for (const item of series) {
      for (const point of item.rows) {
        const bucket = chartMap.get(point.date) ?? { date: point.date };
        bucket[item.key] = point.mean_cumulative_return;
        chartMap.set(point.date, bucket);
      }
    }

    return {
      chartRows: Array.from(chartMap.values()).sort((left, right) =>
        String(left.date).localeCompare(String(right.date))
      ),
      series: series.map(({ key, label, color }) => ({ key, label, color })),
    };
  }, [cumulativeReturnQuery.data, summary]);

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: "#fafafa",
      border: "1px solid #ececec",
      borderRadius: 14,
      boxShadow: "0 12px 24px rgba(121, 101, 79, 0.08)",
      fontSize: 11,
      color: "#6f6762",
    },
    labelStyle: { color: "#737373", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" },
    itemStyle: { color: "#6f6762" },
  };

  return (
    <div className="space-y-4 pb-1">
      <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="dashboard-label">Accumulated Return by Strategy</p>
            <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[#8f8780]">
              Mean cumulative return on common dates with full market and path coverage,
              aggregated to one line per strategy and weighted by path count.
            </p>
          </div>
          <FigureExportControls
            captureRef={overviewAccumulatedReturnRef}
            slug="overview-accumulated-return-by-strategy"
            caption="Overview — accumulated return by strategy across all periods"
            experimentId={data.active_experiment_id}
          />
        </div>

        {cumulativeReturnQuery.isLoading ? (
          <p className="py-20 text-center text-[12px] text-[#737373]">
            Loading accumulated return overview…
          </p>
        ) : cumulativeReturnChart.chartRows.length > 0 ? (
          <div ref={overviewAccumulatedReturnRef} className="min-w-0">
            <ResponsiveContainer width="100%" height={340}>
              <LineChart
                data={cumulativeReturnChart.chartRows}
                margin={{ top: 8, right: 16, left: 6, bottom: 8 }}
              >
                <CartesianGrid
                  stroke="rgba(220, 213, 206, 0.7)"
                  vertical={false}
                  strokeDasharray="3 6"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatChartDate}
                  tick={{ fontSize: 10, fill: "#737373" }}
                  minTickGap={28}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(value) => formatReturnPercent(value, 0)}
                  tick={{ fontSize: 10, fill: "#aca49d" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  {...tooltipStyle}
                  labelFormatter={(value) => formatChartTooltipDate(String(value))}
                  formatter={(value: number | null, _name, item) => [
                    formatReturnPercent(value, 1),
                    item?.name ?? "",
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#737373", paddingTop: 12 }} />
                <ReferenceLine
                  y={0}
                  stroke="rgba(192, 180, 170, 0.9)"
                  strokeDasharray="3 6"
                />
                {cumulativeReturnChart.series.map((series) => (
                  <Line
                    key={series.key}
                    type="linear"
                    dataKey={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeWidth={series.key.startsWith("gpt_") ? 2.5 : 1.8}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : cumulativeReturnQuery.data === null ? (
          <p className="py-20 text-center text-[12px] text-[#737373]">
            Accumulated return history is not available on this backend yet.
          </p>
        ) : (
          <p className="py-20 text-center text-[12px] text-[#737373]">
            No accumulated return series are available for this experiment.
          </p>
        )}
      </div>

      <SoftHr />

      {/* Strategy KPI cards — two-tier layout */}
      {(strategyGroups ?? summary).length > 0 && (
        <>
          <SectionHeader>Strategy Performance</SectionHeader>
          {strategyGroups ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {strategyGroups.map((group) => (
                <div key={group.key} className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
                  {/* Overall row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="dashboard-label truncate">{group.label}</p>
                      <p
                        className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.05em]"
                        style={{ color: sharpeColor(group.overallSharpe) }}
                      >
                        {fmt(group.overallSharpe, 2)}
                      </p>
                      <p className="mt-1.5 text-[11px] text-[#9f978f]">
                        Sharpe ·{" "}
                        {group.overallReturn != null
                          ? fmtp(group.overallReturn * 100, 1)
                          : "—"}{" "}
                        ret · n={group.totalObs}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-[8px] bg-[rgba(0,0,0,0.04)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a3a3a3]">
                      All Markets
                    </span>
                  </div>

                  {/* Per-market chips */}
                  {group.byMarket.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[#ececec] pt-3">
                      {group.byMarket.map((m) => (
                        <div
                          key={m.market}
                          className="min-w-[90px] flex-1 rounded-[10px] bg-[rgba(0,0,0,0.03)] px-3 py-2"
                        >
                          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#a3a3a3]">
                            {getMarketShortLabel(m.market)}
                          </p>
                          <p
                            className="mt-1 text-[15px] font-semibold tabular-nums leading-none"
                            style={{ color: sharpeColor(m.sharpe) }}
                          >
                            {m.sharpe != null && Number.isFinite(m.sharpe)
                              ? m.sharpe.toFixed(2)
                              : "—"}
                          </p>
                          <p className="mt-0.5 text-[10px] text-[#9f978f]">
                            {m.ret != null ? fmtp(m.ret * 100, 1) : "—"} ret
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* Fallback: flat grid when summary_rows is unavailable */
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {summary.map((s) => {
                const short = getStrategyDisplayName(s.Strategy, s.strategy_key);
                return (
                  <KpiCard
                    key={`${s.strategy_key}::${s.markets?.[0] ?? ""}`}
                    label={short}
                    value={fmt(s.mean_sharpe, 2)}
                    color={sharpeColor(s.mean_sharpe)}
                    sub={`Sharpe | ${
                      s.net_return_mean != null ? fmtp(s.net_return_mean * 100, 1) : "—"
                    } ret | n=${s.n_observations}`}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      <SoftHr />

      {/* Beat rate chart */}
      {beatIndexData.length > 0 && (
        <>
          <SectionHeader>Beat Rate Comparison</SectionHeader>
          <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <p className="dashboard-label">% of runs beating market index (Sharpe)</p>
              <FigureExportControls
                captureRef={overviewBeatIndexRef}
                slug="overview-beat-index-sharpe"
                caption="Overview — Percent of runs beating market index (Sharpe)"
                experimentId={data.active_experiment_id}
              />
            </div>
            <div ref={overviewBeatIndexRef} className="min-w-0">
              <ResponsiveContainer width="100%" height={beatIndexData.length * 40 + 36}>
                <BarChart data={beatIndexData} layout="vertical" margin={{ left: 104, right: 18, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
                <XAxis
                  type="number"
                  domain={[0, 105]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#aca49d" }}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#737373" }}
                  width={100}
                />
                <Tooltip {...tooltipStyle} formatter={(v: number) => `${v}%`} />
                <ReferenceLine x={50} stroke="rgba(192, 180, 170, 0.9)" strokeDasharray="3 6" strokeWidth={1} />
                <Bar
                  dataKey="value"
                  radius={[999, 999, 999, 999]}
                  barSize={12}
                  label={{ position: "right", fontSize: 10, fill: "#737373", formatter: (v: number) => `${v}%` }}
                >
                  {beatIndexData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* Key Insights */}
      {insights.length > 0 && (
        <>
          <SectionHeader>Key Insights</SectionHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.slice(0, 4).map((ins, i) => (
              <InsightCard key={i} type={ins.type} title={ins.title} body={ins.body} />
            ))}
          </div>
        </>
      )}

      <div className="dashboard-panel-strong rounded-[20px] border border-[#ececec] bg-[#fafafa] p-4 md:p-5">
        <p className="text-[12px] leading-5 text-[#737373]">
          Use <strong>Performance</strong> for full strategy ranking and run distributions, <strong>Factor Style</strong>
          for return explanations, <strong>Paths</strong> for time-series drill-down, and <strong>Diagnostics</strong> for
          missing-data and confidence checks.
        </p>
      </div>
    </div>
  );
}

export function SharpeGapDiagnostic({
  summaryRows,
}: {
  summaryRows: { strategy_key: string; strategy: string; market: string; mean_sharpe: number | null; mean_annualized_return: number | null; mean_volatility: number | null; observations: number }[];
}) {
  const [open, setOpen] = useState(false);

  const gaps = useMemo(() => {
    if (!summaryRows?.length) return [];
    return summaryRows
      .filter((r) => r.mean_sharpe == null || !Number.isFinite(r.mean_sharpe))
      .map((r) => ({
        strategy: r.strategy,
        strategy_key: r.strategy_key,
        market: r.market,
        mean_sharpe: r.mean_sharpe,
        mean_annualized_return: r.mean_annualized_return,
        mean_volatility: r.mean_volatility,
        observations: r.observations,
        hasReturn: r.mean_annualized_return != null && Number.isFinite(r.mean_annualized_return),
        hasVol: r.mean_volatility != null && Number.isFinite(r.mean_volatility),
      }));
  }, [summaryRows]);

  const allRows = useMemo(() => summaryRows ?? [], [summaryRows]);

  if (!allRows.length) return null;

  return (
    <div className="rounded-[16px] border border-[#ececec] bg-[#fafafa]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a3a3a3]">
          Sharpe gap diagnostics
          {gaps.length > 0 && (
            <span className="ml-2 rounded-full bg-[rgba(212,151,144,0.25)] px-2 py-0.5 text-[10px] text-[#c17070]">
              {gaps.length} missing
            </span>
          )}
        </span>
        <span className="text-[11px] text-[#a3a3a3]">{open ? "▲ hide" : "▼ show"}</span>
      </button>

      {open && (
        <div className="border-t border-[#ececec] px-4 pb-4 pt-3">
          {gaps.length === 0 ? (
            <p className="text-[12px] text-[#7a9e7a]">All rows have a valid Sharpe ratio.</p>
          ) : (
            <>
              <p className="mb-3 text-[11px] leading-5 text-[#737373]">
                These rows have <code className="rounded bg-[rgba(0,0,0,0.06)] px-1">mean_sharpe = null</code> in the
                raw API data. The cause is usually missing volatility (Sharpe = return / vol — if vol is null,
                Sharpe cannot be computed) or the backend view not covering this strategy/market combination.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[11px]">
                  <thead>
                    <tr className="border-b border-[#ececec] bg-[#fafafa]">
                      {["Strategy", "Market", "Sharpe", "Annualized Return", "Volatility", "Observations", "Likely cause"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a3a3a3]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gaps.map((row, i) => {
                      let cause = "Unknown";
                      if (!row.hasVol && row.hasReturn) cause = "Volatility missing → Sharpe not computable";
                      else if (!row.hasReturn && !row.hasVol) cause = "Return + volatility both missing";
                      else if (row.hasReturn && row.hasVol) cause = "Backend did not compute Sharpe despite having inputs";
                      return (
                        <tr key={i} className="border-b border-[#ececec] last:border-0">
                          <td className="px-3 py-2 font-medium text-[#404040]">{row.strategy}</td>
                          <td className="px-3 py-2 text-[#737373]">{row.market}</td>
                          <td className="px-3 py-2 font-mono text-[#c17070]">null</td>
                          <td className="px-3 py-2 tabular-nums text-[#737373]">
                            {row.mean_annualized_return != null ? `${(row.mean_annualized_return * 100).toFixed(1)}%` : "null"}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-[#737373]">
                            {row.mean_volatility != null ? `${(row.mean_volatility * 100).toFixed(1)}%` : "null"}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-[#737373]">{row.observations}</td>
                          <td className="px-3 py-2 text-[#a07c5a]">{cause}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[10px] text-[#a3a3a3]">
                Total raw rows: {allRows.length} · Missing Sharpe: {gaps.length} ({((gaps.length / allRows.length) * 100).toFixed(0)}%)
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
