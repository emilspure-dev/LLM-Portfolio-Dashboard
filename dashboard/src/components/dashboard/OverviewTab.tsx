import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell,
} from "recharts";
import { KpiCard } from "./KpiCard";
import { InsightCard } from "./InsightCard";
import { SectionHeader, SoftHr } from "./SectionHeader";
import {
  COLORS, getStrategyColor, sharpeColor, fmt, fmtp,
} from "@/lib/constants";
import type { EvaluationData, RunRow, Insight } from "@/lib/types";

interface OverviewTabProps {
  data: EvaluationData;
  runs: RunRow[];
}

function getReturnVal(r: RunRow): number | null {
  return r.net_return ?? r.period_return_net ?? r.period_return ?? null;
}

export function OverviewTab({ data, runs }: OverviewTabProps) {
  const { summary } = data;
  const nRuns = runs.filter((r) => r.valid !== false).length;
  const nMarkets = new Set(runs.map((r) => r.market).filter(Boolean)).size;
  const nPeriods = new Set(runs.map((r) => r.period).filter(Boolean)).size;

  const bestSharpe = useMemo(() => {
    if (!summary.length) return { value: NaN, name: "—" };
    let best = summary[0];
    for (const s of summary) {
      if (s.mean_sharpe > best.mean_sharpe) best = s;
    }
    return {
      value: best.mean_sharpe,
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
      const bestGpt = gptRows.reduce((a, b) => (a.mean_sharpe > b.mean_sharpe ? a : b));
      const bestBench = benchRows.reduce((a, b) => (a.mean_sharpe > b.mean_sharpe ? a : b));
      const gptName = bestGpt.Strategy.replace("GPT (", "").replace(")", "");

      if (bestGpt.mean_sharpe > bestBench.mean_sharpe) {
        result.push({
          type: "pos",
          title: "GPT outperforms benchmarks",
          body: `${gptName} achieves a mean Sharpe of ${bestGpt.mean_sharpe.toFixed(2)}, beating the best benchmark (${bestBench.Strategy}: ${bestBench.mean_sharpe.toFixed(2)}).`,
        });
      } else {
        result.push({
          type: "neg",
          title: "Benchmarks lead on Sharpe",
          body: `The best benchmark (${bestBench.Strategy}: ${bestBench.mean_sharpe.toFixed(2)}) outperforms the best GPT strategy (${gptName}: ${bestGpt.mean_sharpe.toFixed(2)}).`,
        });
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

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: "#1A2E4A",
      border: "1px solid #2A3E5A",
      borderRadius: 6,
      fontSize: 12,
      color: "#A0AEBB",
    },
  };

  return (
    <div className="space-y-2">
      {/* Hero KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

      {/* Strategy KPI cards */}
      {summary.length > 0 && (
        <>
          <SectionHeader>Strategy Performance</SectionHeader>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {summary.slice(0, 6).map((s) => {
              const short = s.Strategy.replace("GPT (", "").replace(")", "")
                .replace(" (market-matched)", "").replace(" (buy-and-hold)", "");
              return (
                <KpiCard
                  key={s.strategy_key || s.Strategy}
                  label={short}
                  value={fmt(s.mean_sharpe, 2)}
                  color={sharpeColor(s.mean_sharpe)}
                  sub={`Sharpe | ${fmtp(s.net_return_mean * 100, 1)} ret | n=${s.n_observations}`}
                />
              );
            })}
          </div>
        </>
      )}

      <SoftHr />

      {/* Beat rate charts */}
      {(beatIndexData.length > 0 || beat60Data.length > 0) && (
        <>
          <SectionHeader>Beat Rates</SectionHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {beatIndexData.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-3">
                  % of runs beating market index (Sharpe)
                </p>
                <ResponsiveContainer width="100%" height={beatIndexData.length * 44 + 20}>
                  <BarChart data={beatIndexData} layout="vertical" margin={{ left: 100, right: 40, top: 4, bottom: 4 }}>
                    <XAxis type="number" domain={[0, 105]} tick={{ fontSize: 10, fill: "#5E7082" }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "#A0AEBB" }} width={95} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => `${v}%`} />
                    <ReferenceLine x={50} stroke="#5E7082" strokeDasharray="4 4" strokeWidth={1} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10, fill: "#A0AEBB", formatter: (v: number) => `${v}%` }}>
                      {beatIndexData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {beat60Data.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-3">
                  % of runs beating 60/40 (Sharpe)
                </p>
                <ResponsiveContainer width="100%" height={beat60Data.length * 44 + 20}>
                  <BarChart data={beat60Data} layout="vertical" margin={{ left: 100, right: 40, top: 4, bottom: 4 }}>
                    <XAxis type="number" domain={[0, 105]} tick={{ fontSize: 10, fill: "#5E7082" }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "#A0AEBB" }} width={95} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => `${v}%`} />
                    <ReferenceLine x={50} stroke="#5E7082" strokeDasharray="4 4" strokeWidth={1} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10, fill: "#A0AEBB", formatter: (v: number) => `${v}%` }}>
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
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary">
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Strategy</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Mean Sharpe</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Beat Index %</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Beat 60/40 %</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Mean Return</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">N</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground">{s.Strategy}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: sharpeColor(s.mean_sharpe) }}>
                      {fmt(s.mean_sharpe, 2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {s.pct_runs_beating_index_sharpe != null && !isNaN(s.pct_runs_beating_index_sharpe)
                        ? `${s.pct_runs_beating_index_sharpe.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {s.pct_runs_beating_sixty_forty_sharpe != null && !isNaN(s.pct_runs_beating_sixty_forty_sharpe)
                        ? `${s.pct_runs_beating_sixty_forty_sharpe.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {fmt(s.net_return_mean, 4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
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
    </div>
  );
}
