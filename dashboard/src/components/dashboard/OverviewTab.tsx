import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, CartesianGrid,
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

      {/* Strategy KPI cards */}
      {summary.length > 0 && (
        <>
          <SectionHeader>Strategy Performance</SectionHeader>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {summary.map((s) => {
              const marketSuffix = !s.strategy_key.startsWith("gpt_") && s.markets?.length === 1
                ? ` · ${s.markets[0]}`
                : "";
              const short = s.Strategy
                .replace("GPT (", "")
                .replace(")", "")
                .replace(" (market-matched)", "")
                .replace(" (buy-and-hold)", "")
                + marketSuffix;
              return (
                <KpiCard
                  key={`${s.strategy_key}::${s.markets?.[0] ?? ""}`}
                  label={short}
                  value={fmt(s.mean_sharpe, 2)}
                  color={sharpeColor(s.mean_sharpe)}
                  sub={`Sharpe | ${
                    s.net_return_mean != null
                      ? fmtp(s.net_return_mean * 100, 1)
                      : "—"
                  } ret | n=${s.n_observations}`}
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
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Mean Sharpe</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Beat Index %</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Beat 60/40 %</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">Mean Return</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b4aca5]">N</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s, i) => (
                  <tr key={i} className="border-b border-[rgba(227,220,214,0.8)] last:border-0 hover:bg-[rgba(214,205,197,0.12)] transition-colors">
                    <td className="px-3 py-2.5 font-medium text-[#5e5955]">{s.Strategy}</td>
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
    </div>
  );
}
