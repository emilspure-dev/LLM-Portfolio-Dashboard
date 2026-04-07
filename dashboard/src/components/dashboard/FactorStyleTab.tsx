import { useCallback, useMemo, useRef, useState } from "react";
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
import { CHART_COLORS, MARKET_LABELS } from "@/lib/constants";
import { getApiBaseUrl, postFactorStyleAnalysis } from "@/lib/api-client";
import {
  FACTOR_DEFINITIONS_BLURB,
  STRATEGY_GLOSSARY,
} from "@/lib/strategy-factor-glossary";
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
  runs?: unknown;
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
        marketFilter === "All" ? "All markets" : (MARKET_LABELS[marketFilter] ?? marketFilter);
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
      <p className="dashboard-label mb-2">AI interpretation (OpenAI)</p>
      <p className="mb-3 max-w-3xl text-[12px] leading-5 text-[#8f8780]">
        Generates a concise comparison of factor tilts across strategies using the table above. The API server calls
        OpenAI (default model <span className="font-mono text-[11px]">gpt-4o</span>; set{" "}
        <span className="font-mono text-[11px]">OPENAI_MODEL</span> on the API host for another chat model). Not
        investment advice.
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
          {loading ? "Running…" : "Generate analysis"}
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
  const factorStyleChartRef = useRef<HTMLDivElement>(null);

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

  const strategyKeysInView = useMemo(() => {
    const keys = new Set(factorStyleFiltered.map((r) => r.strategy_key));
    return [...keys].sort((a, b) => factorStyleSortKey(a) - factorStyleSortKey(b));
  }, [factorStyleFiltered]);

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
              <option value="All">All markets</option>
              {allMarkets.map((m) => (
                <option key={m} value={m}>{MARKET_LABELS[m] ?? m}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div>
        <SectionHeader>Portfolio factor style</SectionHeader>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#7b736e]">
          See how LLM-built portfolios tilt toward <strong>size</strong>, <strong>value</strong>,{" "}
          <strong>momentum</strong>, <strong>low risk</strong>, and <strong>quality</strong> versus
          deterministic benchmarks, using the same exposures as the daily factor series in the API.
        </p>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#9d958d]">
          Values are means from{" "}
          <code className="rounded bg-[rgba(0,0,0,0.04)] px-1 py-0.5 text-[10px]">
            daily_path_metrics
          </code>
          : each portfolio path is averaged over trading days, then paths are averaged within each
          strategy · prompt · market cell.
        </p>
        {data.factor_style_from_exposure_fallback && (
          <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#5a6d78]">
            This view is built from <span className="font-mono text-[11px]">GET /charts/factor-exposures</span> because{" "}
            <span className="font-mono text-[11px]">/summary/factor-style</span> returned 404 on this API. The math matches
            the backend summary route; deploy the current Node API to use the dedicated endpoint and clear the health
            warning.
          </p>
        )}
        {nGptPaths > 0 && (
          <p className="mt-2 text-[11px] text-[#9d958d]">
            LLM paths in view (retail + advanced): <span className="font-medium text-[#6f6863]">{nGptPaths}</span>
          </p>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <SectionHeader>Strategy &amp; factor definitions</SectionHeader>
        <p className="max-w-3xl text-[12px] leading-5 text-[#9d958d]">{FACTOR_DEFINITIONS_BLURB}</p>
        <Accordion type="multiple" className="dashboard-panel rounded-[16px] border border-[rgba(232,224,217,0.9)] px-3">
          {strategyKeysInView.map((key) => {
            const g = STRATEGY_GLOSSARY[key];
            const row0 = factorStyleFiltered.find((r) => r.strategy_key === key);
            const title = g?.title ?? row0?.strategy ?? key;
            const summary =
              g?.summary ??
              "Custom or auxiliary strategy in this experiment; use the factor bars versus index and 60/40 to see relative tilts.";
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

      <SoftHr />

      {data.factor_style_error ? (
        <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
          <InsightCard
            type="warn"
            title="Factor-style request failed"
            body={`${data.factor_style_error} The dashboard calls ${getApiBaseUrl()}/summary/factor-style. Status 404 usually means the deployed API does not include this route yet—deploy the current backend or point VITE_API_BASE_URL / NEXT_PUBLIC_API_BASE_URL at a server that has GET /api/summary/factor-style.`}
          />
        </div>
      ) : factorBarChartData.length > 0 ? (
        <>
          <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-start justify-end gap-2">
              <FigureExportControls
                captureRef={factorStyleChartRef}
                slug="factor-style-portfolio-tilts"
                caption="Factor style — Portfolio factor tilts (size, value, momentum, low risk, quality)"
                experimentId={data.active_experiment_id}
              />
            </div>
            <div ref={factorStyleChartRef} className="min-w-0">
              <ResponsiveContainer
                width="100%"
                height={Math.min(780, Math.max(280, factorBarChartData.length * 52 + 80))}
              >
                <BarChart
                  data={factorBarChartData}
                  layout="vertical"
                  margin={{ left: 4, right: 20, top: 8, bottom: 8 }}
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
                    width={236}
                    interval={0}
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
                    wrapperStyle={{ fontSize: 10, color: "#9b938b", paddingTop: 10 }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Bar dataKey="Size" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={8} />
                  <Bar dataKey="Value" fill={CHART_COLORS[1]} radius={[0, 4, 4, 0]} barSize={8} />
                  <Bar dataKey="Momentum" fill={CHART_COLORS[2]} radius={[0, 4, 4, 0]} barSize={8} />
                  <Bar dataKey="Low risk" fill={CHART_COLORS[3]} radius={[0, 4, 4, 0]} barSize={8} />
                  <Bar dataKey="Quality" fill={CHART_COLORS[4]} radius={[0, 4, 4, 0]} barSize={8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <FactorStyleAiSection
            experimentId={data.active_experiment_id}
            marketFilter={marketFilter}
            factorStyleFiltered={factorStyleFiltered}
          />
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
                : "Factor rows exist for this experiment, but every mean exposure is null for the selected market — try All markets."
            }
          />
        </div>
      )}
    </div>
  );
}
