import { useMemo, type ReactNode } from "react";
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
import { SectionHeader, SoftHr } from "./SectionHeader";
import { COLORS, getStrategyColor, sharpeColor } from "@/lib/constants";
import type { FactorStyleSummaryRow } from "@/lib/api-types";
import type { EvaluationData, RunRow } from "@/lib/types";

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
  marketFilter: string;
}

export function StrategiesTab({ data, runs, marketFilter }: StrategiesTabProps) {
  const summary = data.summary;
  const runCounts = useMemo(() => runCountByStrategy(runs), [runs]);
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
      sortedBySharpe.map((row) => ({
        Strategy: formatStrategyLabel(row.Strategy),
        strategy_key: row.strategy_key,
        mean_sharpe: row.mean_sharpe,
      })),
    [sortedBySharpe]
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
        .map((row) => ({
          name: formatStrategyLabel(row.Strategy),
          strategy_key: row.strategy_key,
          volPct: (row.mean_volatility as number) * 100,
          retPct: (row.mean_annualized_return as number) * 100,
        })),
    [summary]
  );

  const marketScope =
    marketFilter === "All" ? "All markets" : `Market: ${marketFilter}`;

  if (!summary.length) {
    return (
      <div className="space-y-4 pb-1">
        <SectionHeader>Strategies</SectionHeader>
        <Panel className="flex min-h-[200px] items-center justify-center">
          <p className="text-center text-[13px] text-[#9b938b]">
            No strategy summary rows for {marketScope}. Widen the sidebar market filter or check the
            experiment.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-1">
      <div>
        <SectionHeader>Strategies</SectionHeader>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#7b736e]">
          One place for <strong>aggregated performance</strong>, <strong>risk</strong>,{" "}
          <strong>run counts</strong>, and <strong>factor tilts</strong> by strategy. Figures respect
          the sidebar <strong>market</strong> filter ({marketScope}).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Top Sharpe (summary)"
          value={
            topSharpe?.mean_sharpe != null && Number.isFinite(topSharpe.mean_sharpe)
              ? topSharpe.mean_sharpe.toFixed(2)
              : "—"
          }
          color={sharpeColor(topSharpe?.mean_sharpe)}
          sub={topSharpe ? formatStrategyLabel(topSharpe.Strategy) : "—"}
        />
        <KpiCard
          label="Best ann. return"
          value={formatPctFromRatio(bestReturn?.mean_annualized_return, 1)}
          color={COLORS.green}
          sub={bestReturn ? formatStrategyLabel(bestReturn.Strategy) : "—"}
        />
        <KpiCard
          label="Lowest volatility"
          value={formatPctFromRatio(lowestVol?.mean_volatility, 1)}
          color={COLORS.cyan}
          sub={lowestVol ? formatStrategyLabel(lowestVol.Strategy) : "—"}
        />
        <KpiCard
          label="Best beat index %"
          value={formatPctFromNumber(bestBeatIndex?.pct_runs_beating_index_sharpe, 0)}
          color={COLORS.amber}
          sub={bestBeatIndex ? formatStrategyLabel(bestBeatIndex.Strategy) : "—"}
        />
      </div>

      <SoftHr />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel>
          <p className="dashboard-label mb-4">Mean Sharpe by strategy</p>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={sharpeBarData} margin={{ top: 6, right: 12, left: 12, bottom: 56 }}>
              <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" vertical={false} strokeDasharray="3 6" />
              <XAxis
                dataKey="Strategy"
                tick={{ fontSize: 10, fill: "#8f8780" }}
                angle={-22}
                textAnchor="end"
                interval={0}
                height={72}
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
                  <Cell key={row.strategy_key} fill={getStrategyColor(row.strategy_key)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel>
          <p className="dashboard-label mb-4">Risk / return (summary)</p>
          {scatterData.length === 0 ? (
            <p className="py-16 text-center text-[12px] text-[#9b938b]">
              Need both mean volatility and mean annualized return in the summary for this chart.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="rgba(220, 213, 206, 0.7)" strokeDasharray="3 6" />
                <XAxis
                  type="number"
                  dataKey="volPct"
                  name="Volatility"
                  unit="%"
                  tick={{ fontSize: 10, fill: "#aca49d" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="number"
                  dataKey="retPct"
                  name="Ann. return"
                  unit="%"
                  tick={{ fontSize: 10, fill: "#aca49d" }}
                  axisLine={false}
                  tickLine={false}
                />
                <ZAxis range={[60, 60]} />
                <Tooltip
                  {...tooltipStyle}
                  cursor={{ strokeDasharray: "3 6" }}
                  formatter={(value: number) => `${value.toFixed(1)}%`}
                />
                <Scatter data={scatterData} fill={COLORS.accent}>
                  {scatterData.map((row) => (
                    <Cell key={row.strategy_key} fill={getStrategyColor(row.strategy_key)} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <SectionHeader>Strategy master table</SectionHeader>
      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[1100px] text-[11px]">
          <thead>
            <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Strategy
              </th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Source
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Runs
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Sharpe
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Ann. ret.
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Vol.
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Beat idx
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Beat 60/40
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Mean ret.
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Turnover
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                Obs.
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedBySharpe.map((row) => (
              <tr
                key={`${row.strategy_key}::${row.source_type}`}
                className="border-b border-[rgba(227,220,214,0.8)] last:border-0"
              >
                <td className="px-3 py-2.5 font-medium text-[#5e5955]">
                  {formatStrategyLabel(row.Strategy)}
                </td>
                <td className="px-3 py-2.5 text-[#8d857f]">{row.source_type}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#8d857f]">
                  {runCounts.get(row.strategy_key) ?? "—"}
                </td>
                <td
                  className="px-3 py-2.5 text-right font-medium tabular-nums"
                  style={{ color: sharpeColor(row.mean_sharpe) }}
                >
                  {row.mean_sharpe != null && Number.isFinite(row.mean_sharpe)
                    ? row.mean_sharpe.toFixed(2)
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-right text-[#8d857f]">
                  {formatPctFromRatio(row.mean_annualized_return, 1)}
                </td>
                <td className="px-3 py-2.5 text-right text-[#8d857f]">
                  {formatPctFromRatio(row.mean_volatility, 1)}
                </td>
                <td className="px-3 py-2.5 text-right text-[#8d857f]">
                  {formatPctFromNumber(row.pct_runs_beating_index_sharpe, 0)}
                </td>
                <td className="px-3 py-2.5 text-right text-[#8d857f]">
                  {formatPctFromNumber(row.pct_runs_beating_sixty_forty_sharpe, 0)}
                </td>
                <td className="px-3 py-2.5 text-right text-[#8d857f]">
                  {formatPctFromRatio(row.net_return_mean, 1)}
                </td>
                <td className="px-3 py-2.5 text-right text-[#8d857f]">
                  {formatPctFromRatio(row.mean_turnover, 1)}
                </td>
                <td className="px-3 py-2.5 text-right text-[#8d857f]">{row.n_observations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <SectionHeader>Factor tilts (path-weighted average)</SectionHeader>
      {data.factor_style_error ? (
        <Panel>
          <p className="text-[12px] leading-5 text-[#8b5348]">
            Factor-style API error: {data.factor_style_error}
          </p>
          <p className="mt-2 text-[12px] leading-5 text-[#9b938b]">
            Open the <strong>Factor style</strong> tab for full troubleshooting notes (backend deploy,
            API base URL, DB view).
          </p>
        </Panel>
      ) : factorAgg.length === 0 ? (
        <Panel>
          <p className="text-[12px] leading-5 text-[#9b938b]">
            No factor-style rows for this scope (API returned 200 with an empty list). The view{" "}
            <code className="rounded bg-[rgba(0,0,0,0.04)] px-1">vw_factor_exposure_daily</code> has
            no rows for this experiment—rebuild or reload analytics data, or try another experiment.
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
                  Mom.
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
                    {formatStrategyLabel(row.strategy)}
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
