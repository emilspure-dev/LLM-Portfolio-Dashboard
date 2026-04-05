import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { InsightCard } from "./InsightCard";
import { SectionHeader, SoftHr } from "./SectionHeader";
import { CHART_COLORS, MARKET_LABELS } from "@/lib/constants";
import { getApiBaseUrl } from "@/lib/api-client";
import type { FactorStyleSummaryRow } from "@/lib/api-types";
import type { EvaluationData } from "@/lib/types";

const FACTOR_STYLE_ORDER = [
  "gpt_retail",
  "gpt_advanced",
  "mean_variance",
  "equal_weight",
  "sixty_forty",
  "index",
  "fama_french",
] as const;

function factorStyleSortKey(strategyKey: string): number {
  const i = (FACTOR_STYLE_ORDER as readonly string[]).indexOf(strategyKey);
  return i === -1 ? 50 : i;
}

function buildFactorStyleLabel(row: FactorStyleSummaryRow): string {
  const m = MARKET_LABELS[row.market] ?? row.market;
  let base = row.strategy
    .replace("GPT (", "")
    .replace(")", "")
    .replace(" (market-matched)", "")
    .replace(" (buy-and-hold)", "")
    .trim();
  if (row.prompt_type) {
    base = `${base} (${row.prompt_type})`;
  }
  return `${base} · ${m}`;
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

interface FactorStyleTabProps {
  data: EvaluationData;
  marketFilter: string;
}

export function FactorStyleTab({ data, marketFilter }: FactorStyleTabProps) {
  const factorStyleFiltered = useMemo(() => {
    const rows = data.factor_style_rows ?? [];
    const scoped =
      marketFilter === "All" ? rows : rows.filter((r) => r.market === marketFilter);
    return [...scoped].sort((a, b) => {
      const sk = factorStyleSortKey(a.strategy_key) - factorStyleSortKey(b.strategy_key);
      if (sk !== 0) return sk;
      return (a.prompt_type ?? "").localeCompare(b.prompt_type ?? "");
    });
  }, [data.factor_style_rows, marketFilter]);

  const factorBarChartData = useMemo(() => {
    return factorStyleFiltered
      .filter((r) =>
        [
          r.mean_size_exposure,
          r.mean_value_exposure,
          r.mean_momentum_exposure,
          r.mean_low_risk_exposure,
          r.mean_quality_exposure,
        ].some((v) => v != null && !Number.isNaN(v))
      )
      .map((r) => ({
        label: buildFactorStyleLabel(r),
        strategy_key: r.strategy_key,
        path_count: r.path_count,
        Size: r.mean_size_exposure ?? 0,
        Value: r.mean_value_exposure ?? 0,
        Momentum: r.mean_momentum_exposure ?? 0,
        "Low risk": r.mean_low_risk_exposure ?? 0,
        Quality: r.mean_quality_exposure ?? 0,
      }));
  }, [factorStyleFiltered]);

  const nGptPaths = useMemo(() => {
    return factorStyleFiltered
      .filter((r) => r.strategy_key === "gpt_retail" || r.strategy_key === "gpt_advanced")
      .reduce((acc, r) => acc + (r.path_count ?? 0), 0);
  }, [factorStyleFiltered]);

  return (
    <div className="space-y-4 pb-1">
      <div>
        <SectionHeader>Portfolio factor style</SectionHeader>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#7b736e]">
          See how LLM-built portfolios tilt toward <strong>size</strong>, <strong>value</strong>,{" "}
          <strong>momentum</strong>, <strong>low risk</strong>, and <strong>quality</strong> versus
          deterministic benchmarks, using the same exposures as the daily factor series in the API.
        </p>
        <p className="mt-2 max-w-3xl text-[11px] leading-5 text-[#9d958d]">
          Values are means from{" "}
          <code className="rounded bg-[rgba(0,0,0,0.04)] px-1 py-0.5 text-[10px]">
            vw_factor_exposure_daily
          </code>
          : each portfolio path is averaged over trading days, then paths are averaged within each
          strategy · prompt · market cell. Use the sidebar <strong>Market</strong> filter to narrow
          the chart.
        </p>
        {nGptPaths > 0 && (
          <p className="mt-2 text-[11px] text-[#9d958d]">
            LLM paths in view (retail + advanced): <span className="font-medium text-[#6f6863]">{nGptPaths}</span>
          </p>
        )}
      </div>

      <SoftHr />

      {data.factor_style_error ? (
        <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
          <InsightCard
            type="warn"
            title="Factor-style request failed"
            body={`${data.factor_style_error}

The dashboard calls ${getApiBaseUrl()}/summary/factor-style. If you see 404, deploy the backend that defines GET /api/summary/factor-style, or set VITE_API_BASE_URL / NEXT_PUBLIC_API_BASE_URL to that server. If the request succeeds but this tab is still empty, the SQLite view vw_factor_exposure_daily has no rows for this experiment (rebuild the analytics DB / ETL).`}
          />
        </div>
      ) : factorBarChartData.length > 0 ? (
        <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
          <ResponsiveContainer
            width="100%"
            height={Math.min(720, Math.max(260, factorBarChartData.length * 44 + 72))}
          >
            <BarChart
              data={factorBarChartData}
              layout="vertical"
              margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
            >
              <CartesianGrid horizontal stroke="rgba(220, 213, 206, 0.7)" vertical strokeDasharray="3 6" />
              <XAxis
                type="number"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#aca49d" }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={168}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 9, fill: "#8f8780" }}
              />
              <ReferenceLine x={0} stroke="rgba(192, 180, 170, 0.85)" strokeDasharray="4 4" />
              <Tooltip
                {...tooltipStyle}
                labelFormatter={(label, payload) => {
                  const row = payload?.[0]?.payload as { path_count?: number } | undefined;
                  const n = row?.path_count;
                  return n != null ? `${label} · ${n} paths` : label;
                }}
                formatter={(value: number) =>
                  typeof value === "number" && !Number.isNaN(value) ? value.toFixed(3) : "—"
                }
              />
              <Legend
                wrapperStyle={{ fontSize: 10, color: "#9b938b", paddingTop: 8 }}
                iconType="circle"
                iconSize={8}
              />
              <Bar dataKey="Size" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={10} />
              <Bar dataKey="Value" fill={CHART_COLORS[1]} radius={[0, 4, 4, 0]} barSize={10} />
              <Bar dataKey="Momentum" fill={CHART_COLORS[2]} radius={[0, 4, 4, 0]} barSize={10} />
              <Bar dataKey="Low risk" fill={CHART_COLORS[3]} radius={[0, 4, 4, 0]} barSize={10} />
              <Bar dataKey="Quality" fill={CHART_COLORS[4]} radius={[0, 4, 4, 0]} barSize={10} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
          <InsightCard
            type="info"
            title="No factor-style aggregates for this view"
            body={
              factorStyleFiltered.length === 0
                ? `The API at ${getApiBaseUrl()} returned an empty array for /summary/factor-style (HTTP 200, zero rows). That usually means vw_factor_exposure_daily has no data for this experiment_id. Fix: load or rebuild the database so daily factor exposures are materialized, or pick an experiment that includes them. If you use a hosted API, confirm it uses the same DB file as your local pipeline.`
                : "Factor rows exist for this experiment, but every mean exposure is null for the current sidebar market filter—try Market: All."
            }
          />
        </div>
      )}
    </div>
  );
}
