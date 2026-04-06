import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, CartesianGrid,
} from "recharts";
import { KpiCard } from "./KpiCard";
import { InsightCard } from "./InsightCard";
import { SectionHeader, SoftHr } from "./SectionHeader";
import {
  COLORS, MARKET_LABELS, getStrategyColor, sharpeColor, fmt, fmtp,
} from "@/lib/constants";

const MARKET_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(MARKET_LABELS).map(([k, v]) => [k, v.replace(/ \(.*\)$/, "")])
);
import type { EvaluationData, RunRow, Insight } from "@/lib/types";

interface OverviewTabProps {
  data: EvaluationData;
  runs: RunRow[];
}

export function OverviewTab({ data, runs }: OverviewTabProps) {
  const { summary } = data;
  const nRuns = runs.filter((r) => r.valid !== false).length;
  const nMarkets = new Set(runs.map((r) => r.market).filter(Boolean)).size;
  const nPeriods = new Set(runs.map((r) => r.period).filter(Boolean)).size;

  const bestSharpe = useMemo(() => {
    if (!summary.length) return { value: NaN, name: "—" };
    const finite = summary.filter(
      (s) => s.mean_sharpe != null && Number.isFinite(s.mean_sharpe)
    );
    if (!finite.length) return { value: NaN, name: "—" };
    let best = finite[0];
    for (const s of finite) {
      if ((s.mean_sharpe ?? -Infinity) > (best.mean_sharpe ?? -Infinity)) best = s;
    }
    return {
      value: best.mean_sharpe as number,
      name: best.Strategy.replace("GPT (", "").replace(")", "")
        .replace(" (market-matched)", "").replace(" (buy-and-hold)", ""),
    };
  }, [summary]);

  const gptBeatRate = useMemo(() => {
    const gptRuns = runs.filter(
      (r) => r.prompt_type === "retail" || r.prompt_type === "advanced"
    );
    if (!gptRuns.length) return 0;
    const idxRow = summary.find((s) => s.strategy_key === "index");
    const idxSharpe = idxRow?.mean_sharpe ?? 0;
    if (!idxSharpe) return 0;
    const beating = gptRuns.filter(
      (r) => r.sharpe_ratio != null && r.sharpe_ratio > idxSharpe
    );
    return (beating.length / gptRuns.length) * 100;
  }, [runs, summary]);

  // Beat rate chart data
  const beatIndexData = useMemo(() => {
    return summary
      .filter((s) => s.pct_runs_beating_index_sharpe != null && !isNaN(s.pct_runs_beating_index_sharpe))
      .sort((a, b) => a.pct_runs_beating_index_sharpe - b.pct_runs_beating_index_sharpe)
      .map((s) => ({
        name: s.Strategy.replace("GPT (", "").replace(")", "")
          .replace(" (market-matched)", "").replace(" (buy-and-hold)", ""),
        value: Number(s.pct_runs_beating_index_sharpe.toFixed(1)),
        color: getStrategyColor(s.strategy_key),
      }));
  }, [summary]);

  const beat60Data = useMemo(() => {
    return summary
      .filter((s) => s.pct_runs_beating_sixty_forty_sharpe != null && !isNaN(s.pct_runs_beating_sixty_forty_sharpe))
      .sort((a, b) => a.pct_runs_beating_sixty_forty_sharpe - b.pct_runs_beating_sixty_forty_sharpe)
      .map((s) => ({
        name: s.Strategy.replace("GPT (", "").replace(")", "")
          .replace(" (market-matched)", "").replace(" (buy-and-hold)", ""),
        value: Number(s.pct_runs_beating_sixty_forty_sharpe.toFixed(1)),
        color: getStrategyColor(s.strategy_key),
      }));
  }, [summary]);

  // Insights
  const insights = useMemo(() => {
    const result: Insight[] = [];
    const gptRows = summary.filter(
      (s) => s.strategy_key === "gpt_retail" || s.strategy_key === "gpt_advanced"
    );
    const benchRows = summary.filter(
      (s) => s.strategy_key !== "gpt_retail" && s.strategy_key !== "gpt_advanced"
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
      const gptName = bestGpt.Strategy.replace("GPT (", "").replace(")", "");
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
            body: `${gptName} achieves a mean Sharpe of ${fmt(gptS, 2)}, beating the best benchmark (${bestBench.Strategy}: ${fmt(benchS, 2)}).`,
          });
        } else {
          result.push({
            type: "neg",
            title: "Benchmarks lead on Sharpe",
            body: `The best benchmark (${bestBench.Strategy}: ${fmt(benchS, 2)}) outperforms the best GPT strategy (${gptName}: ${fmt(gptS, 2)}).`,
          });
        }
      }
    }

    for (const gr of gptRows) {
      const br = gr.pct_runs_beating_index_sharpe;
      if (br != null && !isNaN(br)) {
        const gn = gr.Strategy.replace("GPT (", "").replace(")", "");
        const t = br > 50 ? "pos" : br > 30 ? "warn" : "neg";
        result.push({
          type: t,
          title: `${gn}: ${br.toFixed(0)}% beat index`,
          body: `${br > 50 ? "More than half" : "Less than half"} of ${gn} runs achieve a higher Sharpe ratio than the market index.`,
        });
      }
    }

    const gptHhi = runs
      .filter((r) => r.prompt_type === "retail" || r.prompt_type === "advanced")
      .map((r) => r.hhi)
      .filter((v): v is number => v != null && !isNaN(v));
    if (gptHhi.length > 0) {
      const mh = gptHhi.reduce((a, b) => a + b, 0) / gptHhi.length;
      result.push({
        type: mh > 0.15 ? "warn" : "pos",
        title: `Portfolio concentration: HHI = ${mh.toFixed(3)}`,
        body: `${mh > 0.15 ? "Portfolios tend to be concentrated" : "Portfolios are reasonably diversified"} (HHI ${mh > 0.15 ? "above" : "below"} 0.15 threshold).`,
      });
    }

    return result;
  }, [summary, runs]);

  // Strategy Summary Table: group by strategy_key, order groups by best Sharpe desc,
  // within each group order markets us → germany → japan.
  const summarySorted = useMemo(() => {
    const MARKET_ORDER: Record<string, number> = { us: 0, germany: 1, japan: 2 };
    // Compute best Sharpe per strategy_key for group ordering
    const bestSharpeByKey = new Map<string, number>();
    for (const s of summary) {
      const cur = bestSharpeByKey.get(s.strategy_key) ?? -Infinity;
      if (s.mean_sharpe != null && Number.isFinite(s.mean_sharpe) && s.mean_sharpe > cur) {
        bestSharpeByKey.set(s.strategy_key, s.mean_sharpe);
      }
    }
    return [...summary].sort((a, b) => {
      const aGpt = a.strategy_key.startsWith("gpt_");
      const bGpt = b.strategy_key.startsWith("gpt_");
      // GPT rows always first
      if (aGpt !== bGpt) return aGpt ? -1 : 1;
      // Same strategy_key → sort by market order
      if (a.strategy_key === b.strategy_key) {
        const am = a.markets?.[0] ?? "";
        const bm = b.markets?.[0] ?? "";
        return (MARKET_ORDER[am] ?? 99) - (MARKET_ORDER[bm] ?? 99);
      }
      // Different strategy groups → sort groups by best Sharpe desc
      return (bestSharpeByKey.get(b.strategy_key) ?? -Infinity) -
             (bestSharpeByKey.get(a.strategy_key) ?? -Infinity);
    });
  }, [summary]);

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
      const label = rep.strategy
        .replace("GPT (", "")
        .replace(")", "")
        .replace(" (market-matched)", "")
        .replace(" (buy-and-hold)", "")
        .trim();
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

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: "rgba(255, 255, 252, 0.95)",
      border: "1px solid rgba(232, 224, 217, 0.96)",
      borderRadius: 14,
      boxShadow: "0 12px 24px rgba(121, 101, 79, 0.08)",
      fontSize: 11,
      color: "#6f6762",
    },
    labelStyle: { color: "#9b938b", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" },
    itemStyle: { color: "#6f6762" },
  };

  return (
    <div className="space-y-4 pb-1">
      {/* Hero KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total Runs" value={String(nRuns)} color={COLORS.accent} sub={`${nMarkets} markets`} />
        <KpiCard label="Periods" value={String(nPeriods)} color={COLORS.cyan} />
        <KpiCard
          label="Best Sharpe"
          value={fmt(bestSharpe.value, 2)}
          color={sharpeColor(bestSharpe.value)}
          sub={bestSharpe.name}
        />
        <KpiCard
          label="GPT Beat Rate"
          value={fmtp(gptBeatRate, 0)}
          color={gptBeatRate > 50 ? COLORS.green : COLORS.red}
          sub="vs market index"
        />
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
                    <span className="shrink-0 rounded-[8px] bg-[rgba(0,0,0,0.04)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#b4aca5]">
                      All mkts
                    </span>
                  </div>

                  {/* Per-market chips */}
                  {group.byMarket.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[rgba(227,220,214,0.6)] pt-3">
                      {group.byMarket.map((m) => (
                        <div
                          key={m.market}
                          className="min-w-[90px] flex-1 rounded-[10px] bg-[rgba(0,0,0,0.03)] px-3 py-2"
                        >
                          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                            {MARKET_SHORT[m.market] ?? m.market}
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
                const short = s.Strategy
                  .replace("GPT (", "")
                  .replace(")", "")
                  .replace(" (market-matched)", "")
                  .replace(" (buy-and-hold)", "");
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

      {/* Beat rate charts */}
      {(beatIndexData.length > 0 || beat60Data.length > 0) && (
        <>
          <SectionHeader>Beat Rates</SectionHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {beatIndexData.length > 0 && (
              <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
                <p className="dashboard-label mb-4">
                  % of runs beating market index (Sharpe)
                </p>
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
                      tick={{ fontSize: 10, fill: "#8f8780" }}
                      width={100}
                    />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => `${v}%`} />
                    <ReferenceLine x={50} stroke="rgba(192, 180, 170, 0.9)" strokeDasharray="3 6" strokeWidth={1} />
                    <Bar
                      dataKey="value"
                      radius={[999, 999, 999, 999]}
                      barSize={12}
                      label={{ position: "right", fontSize: 10, fill: "#9b938b", formatter: (v: number) => `${v}%` }}
                    >
                      {beatIndexData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {beat60Data.length > 0 && (
              <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
                <p className="dashboard-label mb-4">
                  % of runs beating 60/40 (Sharpe)
                </p>
                <ResponsiveContainer width="100%" height={beat60Data.length * 40 + 36}>
                  <BarChart data={beat60Data} layout="vertical" margin={{ left: 104, right: 18, top: 4, bottom: 4 }}>
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
                      tick={{ fontSize: 10, fill: "#8f8780" }}
                      width={100}
                    />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => `${v}%`} />
                    <ReferenceLine x={50} stroke="rgba(192, 180, 170, 0.9)" strokeDasharray="3 6" strokeWidth={1} />
                    <Bar
                      dataKey="value"
                      radius={[999, 999, 999, 999]}
                      barSize={12}
                      label={{ position: "right", fontSize: 10, fill: "#9b938b", formatter: (v: number) => `${v}%` }}
                    >
                      {beat60Data.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}

      {/* Strategy summary table */}
      {summary.length > 0 && (
        <>
          <SectionHeader>Strategy Summary Table</SectionHeader>
          <div className="dashboard-panel-strong overflow-hidden rounded-[20px]">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Strategy</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Market</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Mean Sharpe</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Beat Index %</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Beat 60/40 %</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Mean Return</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">N</th>
                </tr>
              </thead>
              <tbody>
                {summarySorted.map((s, i) => (
                  <tr key={i} className="border-b border-[rgba(227,220,214,0.8)] last:border-0 hover:bg-[rgba(214,205,197,0.12)] transition-colors">
                    <td className="px-3 py-2.5 font-medium text-[#5e5955]">{s.Strategy}</td>
                    <td className="px-3 py-2.5 text-[#8d857f]">
                      {s.markets && s.markets.length > 1
                        ? "All"
                        : (MARKET_SHORT[s.markets?.[0] ?? ""] ?? s.markets?.[0] ?? "—")}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums" style={{ color: sharpeColor(s.mean_sharpe) }}>
                      {fmt(s.mean_sharpe, 2)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums text-[#9f978f]">
                      {s.pct_runs_beating_index_sharpe != null && !isNaN(s.pct_runs_beating_index_sharpe)
                        ? `${s.pct_runs_beating_index_sharpe.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums text-[#9f978f]">
                      {s.pct_runs_beating_sixty_forty_sharpe != null && !isNaN(s.pct_runs_beating_sixty_forty_sharpe)
                        ? `${s.pct_runs_beating_sixty_forty_sharpe.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums text-[#9f978f]">
                      {fmt(s.net_return_mean, 4)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums text-[#9f978f]">
                      {s.n_observations}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <SoftHr />

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

      {/* Period-by-period consistency */}
      {(() => {
        const gptKeys = ["gpt_advanced", "gpt_retail"] as const;
        const gptRuns = runs.filter((r) => gptKeys.includes(r.strategy_key as typeof gptKeys[number]));
        const indexRuns = runs.filter((r) => r.strategy_key === "index");
        const markets = Array.from(new Set(runs.map((r) => r.market).filter(Boolean) as string[])).sort(
          (a, b) => {
            const o: Record<string, number> = { us: 0, germany: 1, japan: 2 };
            return (o[a] ?? 99) - (o[b] ?? 99);
          }
        );
        const periods = Array.from(new Set(runs.map((r) => r.period).filter(Boolean) as string[])).sort();
        if (gptRuns.length === 0 || indexRuns.length === 0 || periods.length < 2) return null;

        const idxSharpe = new Map<string, number>();
        for (const r of indexRuns) {
          const k = `${r.market}::${r.period}`;
          const s = r.sharpe_ratio as number | null;
          if (s != null) {
            const prev = idxSharpe.get(k);
            if (prev == null || s > prev) idxSharpe.set(k, s);
          }
        }

        const columns = markets.flatMap((m) =>
          gptKeys.map((gk) => ({ market: m, gptKey: gk, col: `${m}::${gk}` }))
        );

        return (
          <>
            <SoftHr />
            <SectionHeader>Period-by-period consistency</SectionHeader>
            <div className="dashboard-panel-strong overflow-hidden rounded-[20px]">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Period</th>
                    {columns.map((c) => (
                      <th key={c.col} className="px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">
                        <div>{MARKET_SHORT[c.market] ?? c.market}</div>
                        <div className="mt-0.5 text-[9px] font-normal normal-case opacity-70">
                          {c.gptKey === "gpt_advanced" ? "Advanced" : "Retail"}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => (
                    <tr key={period} className="border-b border-[rgba(227,220,214,0.6)] last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-[#5e5955]">{period}</td>
                      {columns.map((c) => {
                        const idx = idxSharpe.get(`${c.market}::${period}`);
                        const gpts = gptRuns.filter(
                          (r) => r.strategy_key === c.gptKey && r.market === c.market && r.period === period
                        );
                        if (!gpts.length || idx == null) {
                          return <td key={c.col} className="px-2 py-2 text-center text-[#d0c9c3]">—</td>;
                        }
                        const avg = gpts.reduce((s, r) => s + ((r.sharpe_ratio as number) ?? 0), 0) / gpts.length;
                        const beat = avg > idx;
                        return (
                          <td key={c.col} className="px-2 py-2 text-center">
                            <span
                              className="inline-block rounded-[8px] px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                backgroundColor: beat ? "rgba(120,185,135,0.3)" : "rgba(212,140,130,0.25)",
                                color: beat ? "#4a8a5a" : "#b05050",
                              }}
                            >
                              {avg.toFixed(2)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}

      <SoftHr />
      <SharpeGapDiagnostic summaryRows={data.summary_rows} />
    </div>
  );
}

function SharpeGapDiagnostic({
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
    <div className="rounded-[16px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.55)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#b4aca5]">
          Sharpe gap diagnostics
          {gaps.length > 0 && (
            <span className="ml-2 rounded-full bg-[rgba(212,151,144,0.25)] px-2 py-0.5 text-[10px] text-[#c17070]">
              {gaps.length} missing
            </span>
          )}
        </span>
        <span className="text-[11px] text-[#b4aca5]">{open ? "▲ hide" : "▼ show"}</span>
      </button>

      {open && (
        <div className="border-t border-[rgba(227,220,214,0.7)] px-4 pb-4 pt-3">
          {gaps.length === 0 ? (
            <p className="text-[12px] text-[#7a9e7a]">All rows have a valid Sharpe ratio.</p>
          ) : (
            <>
              <p className="mb-3 text-[11px] leading-5 text-[#8f8780]">
                These rows have <code className="rounded bg-[rgba(0,0,0,0.06)] px-1">mean_sharpe = null</code> in the
                raw API data. The cause is usually missing volatility (Sharpe = return / vol — if vol is null,
                Sharpe cannot be computed) or the backend view not covering this strategy/market combination.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[11px]">
                  <thead>
                    <tr className="border-b border-[rgba(227,220,214,0.9)] bg-[rgba(250,247,243,0.84)]">
                      {["Strategy", "Market", "Sharpe", "Ann. Return", "Volatility", "Obs.", "Likely cause"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[#b4aca5]">
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
                        <tr key={i} className="border-b border-[rgba(227,220,214,0.6)] last:border-0">
                          <td className="px-3 py-2 font-medium text-[#5e5955]">{row.strategy}</td>
                          <td className="px-3 py-2 text-[#8d857f]">{row.market}</td>
                          <td className="px-3 py-2 font-mono text-[#c17070]">null</td>
                          <td className="px-3 py-2 tabular-nums text-[#8d857f]">
                            {row.mean_annualized_return != null ? `${(row.mean_annualized_return * 100).toFixed(1)}%` : "null"}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-[#8d857f]">
                            {row.mean_volatility != null ? `${(row.mean_volatility * 100).toFixed(1)}%` : "null"}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-[#8d857f]">{row.observations}</td>
                          <td className="px-3 py-2 text-[#a07c5a]">{cause}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[10px] text-[#b4aca5]">
                Total raw rows: {allRows.length} · Missing Sharpe: {gaps.length} ({((gaps.length / allRows.length) * 100).toFixed(0)}%)
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
