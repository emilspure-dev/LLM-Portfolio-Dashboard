import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { FigureExportControls } from "./FigureExportControls";
import { SectionHeader, SoftHr } from "./SectionHeader";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { CHART_COLORS, MARKET_LABELS, getStrategyDisplayName } from "@/lib/constants";
import { getApiBaseUrl, getEquityChart, postFactorStyleAnalysis } from "@/lib/api-client";
import {
  FACTOR_DEFINITIONS_BLURB,
  STRATEGY_GLOSSARY,
} from "@/lib/strategy-factor-glossary";
import {
  computeFactorRegression,
  REGRESSION_FACTOR_KEYS,
  type FactorRegressionResult,
  type RegressionFactorKey,
} from "@/lib/factor-regression";
import type { FactorStyleSummaryRow, StrategyDailyRow } from "@/lib/api-types";
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

const GPT_STRATEGY_KEYS = ["gpt_retail", "gpt_advanced"] as const;
const FACTOR_LABELS: Record<RegressionFactorKey, string> = {
  size: "Size",
  value: "Value",
  momentum: "Momentum",
  lowRisk: "Low risk",
  quality: "Quality",
};
const STRATEGY_COLORS = {
  gpt_retail: CHART_COLORS[0],
  gpt_advanced: CHART_COLORS[2],
} satisfies Record<(typeof GPT_STRATEGY_KEYS)[number], string>;

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
  runs?: unknown;
}

type GptStrategyKey = (typeof GPT_STRATEGY_KEYS)[number];

type FactorStyleAggregateRow = {
  strategy_key: GptStrategyKey;
  strategy: string;
  prompt_type: string | null;
  path_count: number;
  mean_size_exposure: number | null;
  mean_value_exposure: number | null;
  mean_momentum_exposure: number | null;
  mean_low_risk_exposure: number | null;
  mean_quality_exposure: number | null;
};

function weightedMean(values: Array<{ value: number | null | undefined; weight: number | null | undefined }>) {
  let weightedSum = 0;
  let weightSum = 0;
  for (const item of values) {
    if (item.value == null || Number.isNaN(item.value)) continue;
    const weight = item.weight != null && Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1;
    weightedSum += item.value * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? weightedSum / weightSum : null;
}

function aggregateGptFactorRows(rows: FactorStyleSummaryRow[]): FactorStyleAggregateRow[] {
  const grouped = new Map<GptStrategyKey, FactorStyleSummaryRow[]>();
  for (const row of rows) {
    if (!GPT_STRATEGY_KEYS.includes(row.strategy_key as GptStrategyKey)) continue;
    const key = row.strategy_key as GptStrategyKey;
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  return GPT_STRATEGY_KEYS.map((key) => {
    const bucket = grouped.get(key) ?? [];
    const first = bucket[0];
    return {
      strategy_key: key,
      strategy: first?.strategy ?? getStrategyDisplayName(key, key),
      prompt_type: first?.prompt_type ?? null,
      path_count: bucket.reduce((sum, row) => sum + (row.path_count ?? 0), 0),
      mean_size_exposure: weightedMean(bucket.map((row) => ({ value: row.mean_size_exposure, weight: row.path_count }))),
      mean_value_exposure: weightedMean(bucket.map((row) => ({ value: row.mean_value_exposure, weight: row.path_count }))),
      mean_momentum_exposure: weightedMean(bucket.map((row) => ({ value: row.mean_momentum_exposure, weight: row.path_count }))),
      mean_low_risk_exposure: weightedMean(bucket.map((row) => ({ value: row.mean_low_risk_exposure, weight: row.path_count }))),
      mean_quality_exposure: weightedMean(bucket.map((row) => ({ value: row.mean_quality_exposure, weight: row.path_count }))),
    };
  }).filter((row) =>
    [
      row.mean_size_exposure,
      row.mean_value_exposure,
      row.mean_momentum_exposure,
      row.mean_low_risk_exposure,
      row.mean_quality_exposure,
    ].some((value) => value != null && !Number.isNaN(value))
  );
}

function formatPercentFromRatio(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatPercentPoints(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) return "—";
  const pctPoints = value * 100;
  const sign = pctPoints > 0 ? "+" : "";
  return `${sign}${pctPoints.toFixed(digits)} pp`;
}

function formatExposure(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function getExposureValue(row: FactorStyleAggregateRow, key: RegressionFactorKey) {
  switch (key) {
    case "size":
      return row.mean_size_exposure;
    case "value":
      return row.mean_value_exposure;
    case "momentum":
      return row.mean_momentum_exposure;
    case "lowRisk":
      return row.mean_low_risk_exposure;
    case "quality":
      return row.mean_quality_exposure;
  }
}

function topExposureKeys(row: FactorStyleAggregateRow) {
  return REGRESSION_FACTOR_KEYS
    .map((key) => ({ key, value: getExposureValue(row, key) ?? -Infinity }))
    .sort((left, right) => right.value - left.value)
    .filter((item) => item.value !== -Infinity)
    .slice(0, 2)
    .map((item) => item.key);
}

function describeFingerprint(row: FactorStyleAggregateRow) {
  const [first, second] = topExposureKeys(row);
  if (!first) return "No usable factor exposure summary is available for this strategy.";
  if (!second) {
    return `The strongest style tilt is ${FACTOR_LABELS[first].toLowerCase()} (${formatExposure(
      getExposureValue(row, first)
    )}).`;
  }
  return `The clearest factor signature is ${FACTOR_LABELS[first].toLowerCase()} plus ${FACTOR_LABELS[
    second
  ].toLowerCase()} (${formatExposure(getExposureValue(row, first))} / ${formatExposure(
    getExposureValue(row, second)
  )}).`;
}

function describeRegression(result: FactorRegressionResult | null) {
  if (!result) {
    return "Not enough daily observations with valid exposures to estimate a stable regression.";
  }

  const ranked = REGRESSION_FACTOR_KEYS
    .map((key) => ({ key, value: result.coefficients[key] }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  const leader = ranked[0];
  const runnerUp = ranked[1];
  if (!leader) {
    return `The regression is available, but no dominant factor stands out.`;
  }

  const leaderDirection = leader.value >= 0 ? "supports" : "works against";
  const runnerText = runnerUp
    ? ` Secondary signal: ${FACTOR_LABELS[runnerUp.key]} (${formatPercentPoints(runnerUp.value)}).`
    : "";

  return `${FACTOR_LABELS[leader.key]} most strongly ${leaderDirection} daily returns (${formatPercentPoints(
    leader.value
  )}); the model explains ${formatPercentFromRatio(result.rSquared, 0)} of daily variation.${runnerText}`;
}

function FactorStyleAiSection({
  experimentId,
  marketFilter,
  factorStyleFiltered,
}: {
  experimentId: string;
  marketFilter: string;
  factorStyleFiltered: FactorStyleSummaryRow[];
}) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const market_scope =
        marketFilter === "All" ? "All Markets" : (MARKET_LABELS[marketFilter] ?? marketFilter);
      const rows = factorStyleFiltered.map((r) => ({
        strategy_key: r.strategy_key,
        strategy: r.strategy,
        prompt_type: r.prompt_type,
        market: r.market,
        path_count: r.path_count,
        size: r.mean_size_exposure,
        value: r.mean_value_exposure,
        momentum: r.mean_momentum_exposure,
        low_risk: r.mean_low_risk_exposure,
        quality: r.mean_quality_exposure,
      }));
      const res = await postFactorStyleAnalysis({
        experiment_id: experimentId,
        market_scope,
        rows,
        glossary: STRATEGY_GLOSSARY,
        factor_definitions: FACTOR_DEFINITIONS_BLURB,
      });
      setAnalysis(res.analysis);
      setModelLabel(res.model);
    } catch (e) {
      setAnalysis(null);
      setModelLabel(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [experimentId, marketFilter, factorStyleFiltered]);

  return (
    <div className="dashboard-panel-strong mt-4 rounded-[20px] p-4 md:p-5">
      <p className="dashboard-label mb-2">Optional AI narrative</p>
      <p className="mb-3 max-w-3xl text-[12px] leading-5 text-[#8f8780]">
        Use this after reviewing the regression summary if you want an extra natural-language interpretation. It builds
        on the same GPT factor rows but remains suggestive, not causal.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.72)] text-[12px] font-semibold"
          disabled={loading || factorStyleFiltered.length === 0}
          onClick={() => void runAnalysis()}
        >
          {loading ? "Running…" : "Generate GPT-focused analysis"}
        </Button>
        {modelLabel && (
          <span className="text-[11px] text-[#aaa29a]">
            Model: <span className="font-mono">{modelLabel}</span>
          </span>
        )}
      </div>
      {error && (
        <p className="mt-3 text-[12px] leading-5 text-[#a85a52]">
          {error}{" "}
          <span className="text-[#9d958d]">
            (If you see “openai_not_configured”, set <span className="font-mono">OPENAI_API_KEY</span> on the Node API
            and restart.)
          </span>
        </p>
      )}
      {analysis && (
        <div className="mt-4 max-h-[min(70vh,520px)] overflow-y-auto rounded-[14px] border border-[rgba(232,224,217,0.85)] bg-[rgba(255,255,252,0.65)] px-4 py-3">
          <div className="whitespace-pre-wrap text-[12px] leading-6 text-[#5e5955] [word-break:break-word]">
            {analysis}
          </div>
        </div>
      )}
    </div>
  );
}

export function FactorStyleTab({ data }: FactorStyleTabProps) {
  const allMarkets: string[] = data.filters?.markets ?? [];
  const [marketFilter, setMarketFilter] = useState("All");
  const fingerprintChartRef = useRef<HTMLDivElement>(null);
  const regressionChartRef = useRef<HTMLDivElement>(null);

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

  const factorStyleGptOnly = useMemo(() => {
    return factorStyleFiltered.filter((r) => GPT_STRATEGY_KEYS.includes(r.strategy_key as GptStrategyKey));
  }, [factorStyleFiltered]);

  const aggregatedGptRows = useMemo(
    () => aggregateGptFactorRows(factorStyleGptOnly),
    [factorStyleGptOnly]
  );

  const fingerprintChartData = useMemo(() => {
    return aggregatedGptRows.map((row) => ({
      label: getStrategyDisplayName(row.strategy, row.strategy_key),
      strategy_key: row.strategy_key,
      path_count: row.path_count,
      Size: row.mean_size_exposure ?? 0,
      Value: row.mean_value_exposure ?? 0,
      Momentum: row.mean_momentum_exposure ?? 0,
      "Low risk": row.mean_low_risk_exposure ?? 0,
      Quality: row.mean_quality_exposure ?? 0,
    }));
  }, [aggregatedGptRows]);

  const nGptPaths = useMemo(() => {
    return factorStyleFiltered
      .filter((r) => r.strategy_key === "gpt_retail" || r.strategy_key === "gpt_advanced")
      .reduce((acc, r) => acc + (r.path_count ?? 0), 0);
  }, [factorStyleFiltered]);

  const strategyKeysInView = useMemo(() => {
    const keys = new Set(aggregatedGptRows.map((r) => r.strategy_key));
    return [...keys].sort((a, b) => factorStyleSortKey(a) - factorStyleSortKey(b));
  }, [aggregatedGptRows]);

  const equityRegressionQuery = useQuery({
    queryKey: ["factor-style-regression", data.active_experiment_id, marketFilter],
    queryFn: async () => {
      const market = marketFilter === "All" ? undefined : marketFilter;
      const rows = await Promise.all(
        GPT_STRATEGY_KEYS.map(async (strategyKey) => ({
          strategyKey,
          rows: await getEquityChart({
            experiment_id: data.active_experiment_id,
            strategy_key: strategyKey,
            market,
          }),
        }))
      );

      return rows.reduce(
        (acc, item) => {
          acc[item.strategyKey] = item.rows;
          return acc;
        },
        {} as Record<GptStrategyKey, StrategyDailyRow[]>
      );
    },
    enabled: Boolean(data.active_experiment_id),
    staleTime: 60_000,
  });

  const regressionByStrategy = useMemo(() => {
    const dataRows = equityRegressionQuery.data;
    if (!dataRows) return null;
    return GPT_STRATEGY_KEYS.reduce(
      (acc, key) => {
        acc[key] = computeFactorRegression(dataRows[key] ?? []);
        return acc;
      },
      {} as Record<GptStrategyKey, FactorRegressionResult | null>
    );
  }, [equityRegressionQuery.data]);

  const regressionChartData = useMemo(() => {
    if (!regressionByStrategy) return [];
    return REGRESSION_FACTOR_KEYS.map((key) => ({
      factor: FACTOR_LABELS[key],
      retail: ((regressionByStrategy.gpt_retail?.coefficients[key] ?? 0) * 100),
      advanced: ((regressionByStrategy.gpt_advanced?.coefficients[key] ?? 0) * 100),
    }));
  }, [regressionByStrategy]);

  return (
    <div className="space-y-4 pb-1">
      {allMarkets.length > 0 && (
        <div className="dashboard-panel rounded-[18px] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="shrink-0 text-[11px] font-bold uppercase tracking-[0.16em] text-[#8f8780]"
            >
              Market
            </span>
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
        <SectionHeader>Factor strategy diagnosis</SectionHeader>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#7b736e]">
          Which factor strategy is each GPT portfolio following in this market, and how much of its return pattern does
          that explain? This page starts with the average factor fingerprint, then estimates a simple daily regression
          using the same five exposure series.
        </p>
        {data.factor_style_from_exposure_fallback && (
          <p className="mt-2 max-w-3xl text-[11px] leading-5 text-[#5a6d78]">
            Using fallback data from <span className="font-mono text-[11px]">/charts/factor-exposures</span>.
          </p>
        )}
      </div>

      <SoftHr />

      {data.factor_style_error ? (
        <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
          <InsightCard
            type="warn"
            title="Factor Style request failed"
            body={`${data.factor_style_error} The dashboard calls ${getApiBaseUrl()}/summary/factor-style. Status 404 usually means the deployed API does not include this route yet—deploy the current backend or point VITE_API_BASE_URL / NEXT_PUBLIC_API_BASE_URL at a server that has GET /api/summary/factor-style.`}
          />
        </div>
      ) : aggregatedGptRows.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {aggregatedGptRows.map((row) => {
              const regression = regressionByStrategy?.[row.strategy_key];
              return (
                <div key={row.strategy_key} className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
                  <p className="dashboard-label mb-2">{getStrategyDisplayName(row.strategy, row.strategy_key)}</p>
                  <p className="text-[18px] font-semibold text-[#534b45]">
                    {topExposureKeys(row)
                      .map((key) => FACTOR_LABELS[key])
                      .join(" + ")}
                  </p>
                  <p className="mt-2 text-[12px] leading-5 text-[#7b736e]">{describeFingerprint(row)}</p>
                  <p className="mt-2 text-[12px] leading-5 text-[#8f8780]">{describeRegression(regression ?? null)}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#9d958d]">
                    <span className="rounded-full border border-[rgba(232,224,217,0.9)] px-2.5 py-1">
                      Paths: {row.path_count || 0}
                    </span>
                    <span className="rounded-full border border-[rgba(232,224,217,0.9)] px-2.5 py-1">
                      R²: {formatPercentFromRatio(regression?.rSquared ?? null, 0)}
                    </span>
                    <span className="rounded-full border border-[rgba(232,224,217,0.9)] px-2.5 py-1">
                      Daily rows: {regression?.sampleSize ?? 0}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="dashboard-label">Strategy fingerprint</p>
                <p className="mt-1 text-[12px] leading-5 text-[#8f8780]">
                  Average factor exposures show what style each GPT portfolio most resembles in the selected market.
                </p>
              </div>
              <FigureExportControls
                captureRef={fingerprintChartRef}
                slug="factor-style-strategy-fingerprint"
                caption="Factor Style — GPT strategy fingerprint"
                experimentId={data.active_experiment_id}
              />
            </div>
            <div ref={fingerprintChartRef} className="min-w-0">
              <ResponsiveContainer width="100%" height={Math.max(260, aggregatedGptRows.length * 82 + 80)}>
                <BarChart data={fingerprintChartData} layout="vertical" margin={{ left: 8, right: 20, top: 8, bottom: 8 }}>
                  <CartesianGrid horizontal stroke="rgba(220, 213, 206, 0.7)" vertical strokeDasharray="3 6" />
                  <XAxis type="number" domain={[0, 1]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#aca49d" }} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={160}
                    interval={0}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#8f8780" }}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    labelFormatter={(label, payload) => {
                      const row = payload?.[0]?.payload as { path_count?: number } | undefined;
                      return row?.path_count != null ? `${label} · ${row.path_count} paths` : label;
                    }}
                    formatter={(value: number) => (Number.isFinite(value) ? value.toFixed(3) : "—")}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: "#9b938b", paddingTop: 10 }} iconType="circle" iconSize={8} />
                  <Bar dataKey="Size" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={10} />
                  <Bar dataKey="Value" fill={CHART_COLORS[1]} radius={[0, 4, 4, 0]} barSize={10} />
                  <Bar dataKey="Momentum" fill={CHART_COLORS[2]} radius={[0, 4, 4, 0]} barSize={10} />
                  <Bar dataKey="Low risk" fill={CHART_COLORS[3]} radius={[0, 4, 4, 0]} barSize={10} />
                  <Bar dataKey="Quality" fill={CHART_COLORS[4]} radius={[0, 4, 4, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="dashboard-label">Return explanation (five-factor regression)</p>
                <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[#8f8780]">
                  Daily returns are regressed on the five portfolio exposure series. This is an explanatory model using
                  portfolio tilts, not classical factor-return attribution and not a causal claim.
                </p>
              </div>
              <FigureExportControls
                captureRef={regressionChartRef}
                slug="factor-style-regression-coefficients"
                caption="Factor Style — Regression coefficients"
                experimentId={data.active_experiment_id}
              />
            </div>

            {equityRegressionQuery.isLoading ? (
              <InsightCard
                type="info"
                title="Loading regression data"
                body="Fetching daily GPT portfolio paths to estimate how the five factor exposures relate to daily returns."
              />
            ) : equityRegressionQuery.error ? (
              <InsightCard
                type="warn"
                title="Regression data request failed"
                body={equityRegressionQuery.error instanceof Error ? equityRegressionQuery.error.message : "Unable to load daily equity rows."}
              />
            ) : regressionChartData.length === 0 ? (
              <InsightCard
                type="info"
                title="Not enough data for regression"
                body="The selected market does not have enough daily GPT rows with valid return and factor exposure values to estimate the regression."
              />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {GPT_STRATEGY_KEYS.map((key) => {
                    const result = regressionByStrategy?.[key] ?? null;
                    return (
                      <div
                        key={key}
                        className="rounded-[16px] border border-[rgba(232,224,217,0.8)] bg-[rgba(255,255,252,0.62)] px-4 py-3"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9d958d]">
                          {getStrategyDisplayName(key, key)}
                        </p>
                        <p className="mt-2 text-[12px] leading-5 text-[#6f6863]">{describeRegression(result)}</p>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                          <div>
                            <p className="text-[#b4aca5]">R²</p>
                            <p className="font-semibold text-[#534b45]">{formatPercentFromRatio(result?.rSquared ?? null, 0)}</p>
                          </div>
                          <div>
                            <p className="text-[#b4aca5]">Mean daily return</p>
                            <p className="font-semibold text-[#534b45]">{formatPercentFromRatio(result?.meanDailyReturn ?? null, 2)}</p>
                          </div>
                          <div>
                            <p className="text-[#b4aca5]">Rows</p>
                            <p className="font-semibold text-[#534b45]">{result?.sampleSize ?? 0}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div ref={regressionChartRef} className="mt-4 min-w-0">
                  <ResponsiveContainer width="100%" height={360}>
                    <BarChart data={regressionChartData} layout="vertical" margin={{ left: 8, right: 20, top: 8, bottom: 8 }}>
                      <CartesianGrid horizontal stroke="rgba(220, 213, 206, 0.7)" vertical strokeDasharray="3 6" />
                      <XAxis
                        type="number"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#aca49d" }}
                        tickFormatter={(value: number) => `${value.toFixed(1)}pp`}
                      />
                      <YAxis
                        type="category"
                        dataKey="factor"
                        width={110}
                        interval={0}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: "#8f8780" }}
                      />
                      <ReferenceLine x={0} stroke="rgba(192, 180, 170, 0.85)" strokeDasharray="4 4" />
                      <Tooltip
                        {...tooltipStyle}
                        formatter={(value: number) => `${value.toFixed(2)} pp`}
                      />
                      <Legend wrapperStyle={{ fontSize: 10, color: "#9b938b", paddingTop: 10 }} iconType="circle" iconSize={8} />
                      <Bar
                        dataKey="retail"
                        name="GPT (Retail)"
                        fill={STRATEGY_COLORS.gpt_retail}
                        radius={[0, 4, 4, 0]}
                        barSize={12}
                      />
                      <Bar
                        dataKey="advanced"
                        name="GPT (Advanced)"
                        fill={STRATEGY_COLORS.gpt_advanced}
                        radius={[0, 4, 4, 0]}
                        barSize={12}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <Accordion
                  type="multiple"
                  className="mt-4 rounded-[16px] border border-[rgba(232,224,217,0.9)] bg-[rgba(255,255,252,0.62)] px-3"
                >
                  {GPT_STRATEGY_KEYS.map((key) => {
                    const result = regressionByStrategy?.[key];
                    return (
                      <AccordionItem key={key} value={`technical-${key}`} className="border-[rgba(227,220,214,0.75)]">
                        <AccordionTrigger className="py-3 text-left text-[12px] font-semibold text-[#6f6863] hover:no-underline">
                          Technical details — {getStrategyDisplayName(key, key)}
                        </AccordionTrigger>
                        <AccordionContent className="pb-4">
                          {!result ? (
                            <p className="text-[12px] leading-5 text-[#8f8780]">
                              Not enough usable daily observations to compute the regression for this strategy.
                            </p>
                          ) : (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3 text-[12px] md:grid-cols-4">
                                <div>
                                  <p className="text-[#b4aca5]">Sample size</p>
                                  <p className="font-semibold text-[#534b45]">{result.sampleSize}</p>
                                </div>
                                <div>
                                  <p className="text-[#b4aca5]">R²</p>
                                  <p className="font-semibold text-[#534b45]">{formatPercentFromRatio(result.rSquared, 1)}</p>
                                </div>
                                <div>
                                  <p className="text-[#b4aca5]">Intercept</p>
                                  <p className="font-semibold text-[#534b45]">{formatPercentPoints(result.intercept, 2)}</p>
                                </div>
                                <div>
                                  <p className="text-[#b4aca5]">Mean daily return</p>
                                  <p className="font-semibold text-[#534b45]">{formatPercentFromRatio(result.meanDailyReturn, 2)}</p>
                                </div>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[460px] text-[11px]">
                                  <thead>
                                    <tr className="border-b border-[rgba(227,220,214,0.8)] text-left text-[#b4aca5]">
                                      <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Factor</th>
                                      <th className="py-2 pr-3 text-right font-semibold uppercase tracking-[0.12em]">Coefficient</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {REGRESSION_FACTOR_KEYS.map((factorKey) => (
                                      <tr key={factorKey} className="border-b border-[rgba(227,220,214,0.55)] last:border-0">
                                        <td className="py-2 pr-3 text-[#5e5955]">{FACTOR_LABELS[factorKey]}</td>
                                        <td className="py-2 text-right text-[#8d857f]">
                                          {formatPercentPoints(result.coefficients[factorKey], 2)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {REGRESSION_FACTOR_KEYS.map((factorKey) => (
              <div
                key={factorKey}
                className="rounded-[14px] border border-[rgba(232,224,217,0.8)] bg-[rgba(255,255,252,0.62)] px-3 py-2"
              >
                <p className="text-[11px] font-semibold text-[#6f6863]">{FACTOR_LABELS[factorKey]}</p>
                <p className="mt-1 text-[11px] leading-5 text-[#9d958d]">
                  {{
                    size: "Higher = more tilt toward smaller companies.",
                    value: "Higher = more tilt toward cheaper / value stocks.",
                    momentum: "Higher = more tilt toward recent winners / trend-following names.",
                    lowRisk: "Higher = more defensive, lower-volatility exposure.",
                    quality: "Higher = more tilt toward profitable, financially stronger firms.",
                  }[factorKey]}
                </p>
              </div>
            ))}
          </div>

          <FactorStyleAiSection
            experimentId={data.active_experiment_id}
            marketFilter={marketFilter}
            factorStyleFiltered={factorStyleGptOnly}
          />

          <div className="mt-4 space-y-3">
            <SectionHeader>Method notes</SectionHeader>
            <p className="max-w-3xl text-[12px] leading-5 text-[#9d958d]">
              {FACTOR_DEFINITIONS_BLURB} The regression uses daily portfolio returns and daily exposure values from the
              same path data. It helps explain return patterns, but it is not a causal decomposition and it does not use
              classical factor return series. {nGptPaths > 0 ? `GPT paths in view: ${nGptPaths}.` : ""}
            </p>
            <Accordion type="multiple" className="dashboard-panel rounded-[16px] border border-[rgba(232,224,217,0.9)] px-3">
              {strategyKeysInView.map((key) => {
                const g = STRATEGY_GLOSSARY[key];
                const row0 = aggregatedGptRows.find((r) => r.strategy_key === key);
                const title = g?.title ?? row0?.strategy ?? key;
                const summary =
                  g?.summary ??
                  "Custom or auxiliary strategy in this experiment; compare factor fingerprint and regression coefficients to see what it behaves like.";
                return (
                  <AccordionItem key={key} value={key} className="border-[rgba(227,220,214,0.75)]">
                    <AccordionTrigger className="py-3 text-left text-[12px] font-semibold text-[#6f6863] hover:no-underline">
                      {title}
                    </AccordionTrigger>
                    <AccordionContent className="text-[12px] leading-5 text-[#7b736e]">{summary}</AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        </>
      ) : (
        <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
          <InsightCard
            type="info"
            title="No factor-style aggregates for this view"
            body={
              factorStyleFiltered.length === 0
                ? data.factor_style_from_exposure_fallback
                  ? `The dashboard fell back to ${getApiBaseUrl()}/charts/factor-exposures, which returned no usable rows. Factor exposures may be missing in daily path metrics for this experiment.`
                  : `The API at ${getApiBaseUrl()} returned an empty array for /summary/factor-style (HTTP 200, zero rows). That usually means daily path metrics have no factor-exposure data for this experiment. Fix: rebuild or reload analytics data, or pick an experiment that includes populated daily path metrics.`
                : "Factor rows exist for this experiment, but every mean exposure is null for the selected market — try All Markets."
            }
          />
        </div>
      )}
    </div>
  );
}
