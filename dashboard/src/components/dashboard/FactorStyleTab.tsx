import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
import {
  getDailyHoldings,
  getFactorSelectionSummary,
  postFactorStyleAnalysis,
} from "@/lib/api-client";
import { apiRouteLikelyMissing } from "@/lib/data-loader";
import { FACTOR_DEFINITIONS_BLURB, STRATEGY_GLOSSARY } from "@/lib/strategy-factor-glossary";
import type { FactorStyleSummaryRow, HoldingDailyRow } from "@/lib/api-types";
import type { EvaluationData } from "@/lib/types";

const FACTOR_STYLE_ORDER = [
  "gpt_simple",
  "gpt_advanced",
  "mean_variance",
  "equal_weight",
  "sixty_forty",
  "index",
  "fama_french",
] as const;

const GPT_STRATEGY_KEYS = ["gpt_simple", "gpt_advanced"] as const;
const STRATEGY_COLORS = {
  gpt_simple: CHART_COLORS[0],
  gpt_advanced: CHART_COLORS[2],
} satisfies Record<(typeof GPT_STRATEGY_KEYS)[number], string>;

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "#fafafa",
    border: "1px solid #ececec",
    borderRadius: 14,
    boxShadow: "0 12px 24px rgba(121, 101, 79, 0.08)",
    fontSize: 11,
    color: "#6f6762",
  },
  labelStyle: {
    color: "#737373",
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  itemStyle: { color: "#6f6762" },
};

interface FactorStyleTabProps {
  data: EvaluationData;
}

type GptStrategyKey = (typeof GPT_STRATEGY_KEYS)[number];
type SelectionFactorKey = "size" | "value" | "momentum" | "low_risk" | "quality";

type RegimeContextRow = {
  market: string;
  period: string;
  periodStartDate: string | null;
  periodEndDate: string | null;
  marketRegimeLabel: string | null;
  volRegimeLabel: string | null;
  rateRegimeLabel: string | null;
};

type SelectionRow = {
  strategyKey: GptStrategyKey;
  runKey: string;
  date: string;
  period: string;
  label: string;
};

type RunProfile = {
  strategyKey: GptStrategyKey;
  runKey: string;
  totalSelections: number;
  labelCounts: Record<string, number>;
  dominantLabel: string;
};

const FACTOR_CONFIG: Record<
  SelectionFactorKey,
  { label: string; field: string; definition: string }
> = {
  size: {
    label: "Size",
    field: "size_label",
    definition: "Counts whether the prompt is selecting more small-cap or large-cap names.",
  },
  value: {
    label: "Value",
    field: "value_label",
    definition: "Counts how often the prompt selects cheaper/value names versus richer/growth ones.",
  },
  momentum: {
    label: "Momentum",
    field: "momentum_label",
    definition: "Counts whether the prompt is leaning into recent winners or weaker trend names.",
  },
  low_risk: {
    label: "Low risk",
    field: "low_risk_label",
    definition: "Counts how often the prompt prefers more defensive/low-volatility names.",
  },
  quality: {
    label: "Quality",
    field: "quality_label",
    definition: "Counts whether the prompt is selecting more profitable, higher-quality names.",
  },
};

function factorStyleSortKey(strategyKey: string): number {
  const i = (FACTOR_STYLE_ORDER as readonly string[]).indexOf(strategyKey);
  return i === -1 ? 50 : i;
}

function formatPromptLabel(strategyKey: GptStrategyKey) {
  return getStrategyDisplayName(strategyKey, strategyKey);
}

function getFactorLabelValue(
  row: HoldingDailyRow,
  factorKey: SelectionFactorKey
) {
  const raw = row[FACTOR_CONFIG[factorKey].field as keyof HoldingDailyRow];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function getRunKey(
  row: Pick<
    HoldingDailyRow | EvaluationData["runs"][number],
    | "run_id"
    | "path_id"
    | "trajectory_id"
    | "strategy_key"
    | "market"
    | "prompt_type"
    | "model"
  >
) {
  const runId = String(row.run_id ?? "").trim();
  if (runId) return `run:${runId}`;
  const pathId = String(row.path_id ?? "").trim();
  if (pathId) return `path:${pathId}`;
  const trajectoryId = String(row.trajectory_id ?? "").trim();
  if (trajectoryId) return `trajectory:${trajectoryId}`;
  return [
    String(row.strategy_key ?? "") || "unknown-strategy",
    String(row.market ?? "") || "unknown-market",
    String(row.prompt_type ?? "") || "unknown-prompt",
    String(row.model ?? "") || "unknown-model",
  ].join("::");
}

async function fetchAllDailyHoldings(
  query: Record<string, string | number | undefined>
) {
  let page = 1;
  let totalPages = 1;
  const items: HoldingDailyRow[] = [];

  while (page <= totalPages) {
    const response = await getDailyHoldings({
      ...query,
      page,
      page_size: 1000,
    });
    items.push(...response.items);
    totalPages = response.total_pages;
    page += 1;
  }

  return items;
}

function buildSelectionRows(
  holdingsByStrategy: Record<GptStrategyKey, HoldingDailyRow[]> | undefined,
  factorKey: SelectionFactorKey
) {
  if (!holdingsByStrategy) return [];

  const rows: SelectionRow[] = [];
  for (const strategyKey of GPT_STRATEGY_KEYS) {
    for (const row of holdingsByStrategy[strategyKey] ?? []) {
      const label = getFactorLabelValue(row, factorKey);
      if (!label) continue;
      rows.push({
        strategyKey,
        runKey: getRunKey(row),
        date: row.date,
        period: row.period || "Unknown period",
        label,
      });
    }
  }
  return rows;
}

function getLabelOrder(rows: SelectionRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([label]) => label);
}

function getDisplayedLabels(labelOrder: string[]) {
  if (labelOrder.length <= 4) return labelOrder;
  return [...labelOrder.slice(0, 4), "Other"];
}

function buildRunProfiles(rows: SelectionRow[], displayedLabels: string[]) {
  const topLabelSet = new Set(displayedLabels.filter((label) => label !== "Other"));
  const grouped = new Map<string, RunProfile>();

  for (const row of rows) {
    const label = topLabelSet.has(row.label) ? row.label : "Other";
    const profileKey = `${row.strategyKey}__${row.runKey}`;
    const profile =
      grouped.get(profileKey) ??
      {
        strategyKey: row.strategyKey,
        runKey: row.runKey,
        totalSelections: 0,
        labelCounts: {},
        dominantLabel: label,
      };
    profile.totalSelections += 1;
    profile.labelCounts[label] = (profile.labelCounts[label] ?? 0) + 1;
    grouped.set(profileKey, profile);
  }

  return Array.from(grouped.values()).map((profile) => {
    const dominant = displayedLabels
      .map((label) => ({ label, value: profile.labelCounts[label] ?? 0 }))
      .sort((left, right) => right.value - left.value)[0];
    return {
      ...profile,
      dominantLabel: dominant?.label ?? "Other",
    };
  });
}

function buildAggregateCountData(rows: SelectionRow[], displayedLabels: string[]) {
  const runProfiles = buildRunProfiles(rows, displayedLabels);
  const grouped = new Map<string, { label: string; simple: number; advanced: number }>();

  for (const profile of runProfiles) {
    const bucket = grouped.get(profile.dominantLabel) ?? {
      label: profile.dominantLabel,
      simple: 0,
      advanced: 0,
    };
    if (profile.strategyKey === "gpt_simple") bucket.simple += 1;
    if (profile.strategyKey === "gpt_advanced") bucket.advanced += 1;
    grouped.set(profile.dominantLabel, bucket);
  }

  return displayedLabels
    .map((label) => grouped.get(label) ?? { label, simple: 0, advanced: 0 })
    .filter((row) => row.simple > 0 || row.advanced > 0);
}

function buildPromptSummary(rows: SelectionRow[], strategyKey: GptStrategyKey) {
  const promptRows = rows.filter((row) => row.strategyKey === strategyKey);
  const labels = Array.from(new Set(promptRows.map((row) => row.label)));
  const profiles = buildRunProfiles(promptRows, labels);
  const dominantCounts = new Map<string, number>();
  const dates = new Set<string>(promptRows.map((row) => row.date));
  const periods = new Set<string>(promptRows.map((row) => row.period));
  for (const profile of profiles) {
    dominantCounts.set(
      profile.dominantLabel,
      (dominantCounts.get(profile.dominantLabel) ?? 0) + 1
    );
  }

  const dominantEntry = Array.from(dominantCounts.entries()).sort(
    (left, right) => right[1] - left[1]
  )[0];
  const runCount = profiles.length;
  return {
    strategy_key: strategyKey,
    prompt_type: strategyKey === "gpt_advanced" ? "advanced" : "simple",
    run_count: runCount,
    dominant_label: dominantEntry?.[0] ?? "—",
    dominant_count: dominantEntry?.[1] ?? 0,
    dominant_share: runCount > 0 ? (dominantEntry?.[1] ?? 0) / runCount : 0,
    date_count: dates.size,
    period_count: periods.size,
  };
}

function buildRunMixData(profiles: RunProfile[], displayedLabels: string[]) {
  const grouped = new Map<GptStrategyKey, { runCount: number; sums: Record<string, number> }>();
  for (const strategyKey of GPT_STRATEGY_KEYS) {
    grouped.set(strategyKey, {
      runCount: 0,
      sums: Object.fromEntries(displayedLabels.map((label) => [label, 0])),
    });
  }

  for (const profile of profiles) {
    const bucket = grouped.get(profile.strategyKey);
    if (!bucket) continue;
    bucket.runCount += 1;
    for (const label of displayedLabels) {
      const share =
        profile.totalSelections > 0
          ? (profile.labelCounts[label] ?? 0) / profile.totalSelections
          : 0;
      bucket.sums[label] = (bucket.sums[label] ?? 0) + share;
    }
  }

  return displayedLabels.map((label) => ({
    label,
    simple:
      (grouped.get("gpt_simple")?.sums[label] ?? 0) /
      Math.max(grouped.get("gpt_simple")?.runCount ?? 0, 1),
    advanced:
      (grouped.get("gpt_advanced")?.sums[label] ?? 0) /
      Math.max(grouped.get("gpt_advanced")?.runCount ?? 0, 1),
  }));
}

function buildOutcomeLinkageRows(profiles: RunProfile[], runs: EvaluationData["runs"]) {
  const runLookup = new Map(
    runs.map((run) => [
      getRunKey(run),
      run,
    ])
  );
  const grouped = new Map<
    string,
    {
      dominant_label: string;
      model: string;
      prompt_type: string;
      sharpeValues: number[];
      returnValues: number[];
      count: number;
    }
  >();

  for (const profile of profiles) {
    const run = runLookup.get(profile.runKey);
    if (!run) continue;
    const model = String(run.model ?? "").trim() || "unknown";
    const promptType = String(run.prompt_type ?? "").trim() || "unknown";
    const key = `${profile.dominantLabel}::${model}::${promptType}`;
    const bucket = grouped.get(key) ?? {
      dominant_label: profile.dominantLabel,
      model,
      prompt_type: promptType,
      sharpeValues: [],
      returnValues: [],
      count: 0,
    };
    if (run.sharpe_ratio != null && Number.isFinite(run.sharpe_ratio)) {
      bucket.sharpeValues.push(run.sharpe_ratio);
    }
    const realized =
      run.annualized_return ?? run.period_return ?? run.net_return ?? run.period_return_net;
    if (realized != null && Number.isFinite(realized)) {
      bucket.returnValues.push(realized);
    }
    bucket.count += 1;
    grouped.set(key, bucket);
  }

  return Array.from(grouped.values())
    .map((row) => ({
      dominant_label: row.dominant_label,
      model: row.model,
      prompt_type: row.prompt_type,
      count: row.count,
      mean_sharpe:
        row.sharpeValues.length > 0
          ? row.sharpeValues.reduce((sum, value) => sum + value, 0) /
            row.sharpeValues.length
          : null,
      mean_return:
        row.returnValues.length > 0
          ? row.returnValues.reduce((sum, value) => sum + value, 0) /
            row.returnValues.length
          : null,
    }))
    .sort((left, right) => (right.mean_sharpe ?? -Infinity) - (left.mean_sharpe ?? -Infinity));
}

function buildRegimeContextRows(
  holdingsByStrategy: Record<GptStrategyKey, HoldingDailyRow[]> | undefined
) {
  if (!holdingsByStrategy) return [];

  const grouped = new Map<string, RegimeContextRow>();
  for (const strategyKey of GPT_STRATEGY_KEYS) {
    for (const row of holdingsByStrategy[strategyKey] ?? []) {
      const key = `${row.market}__${row.period}`;
      if (grouped.has(key)) continue;
      grouped.set(key, {
        market: row.market,
        period: row.period,
        periodStartDate: row.period_start_date,
        periodEndDate: row.period_end_date,
        marketRegimeLabel: row.market_regime_label,
        volRegimeLabel: row.vol_regime_label,
        rateRegimeLabel: row.rate_regime_label,
      });
    }
  }

  return Array.from(grouped.values()).sort((left, right) => {
    const startCompare = (left.periodStartDate ?? left.period).localeCompare(
      right.periodStartDate ?? right.period
    );
    if (startCompare !== 0) return startCompare;
    return (MARKET_LABELS[left.market] ?? left.market).localeCompare(
      MARKET_LABELS[right.market] ?? right.market
    );
  });
}

function formatPerRun(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function formatPct(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function getTopTwoLabels(values: Record<string, number>, labels: string[]) {
  return labels
    .map((label) => ({ label, value: values[label] ?? 0 }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 2);
}

function buildOverallAnalysis(
  aggregateCountData: Array<{ label: string; simple: number; advanced: number }>
) {
  const labels = aggregateCountData.map((row) => row.label);
  if (labels.length === 0) return "No run-normalized selection pattern is available yet.";

  const simpleTop = getTopTwoLabels(
    Object.fromEntries(aggregateCountData.map((row) => [row.label, row.simple])),
    labels
  );
  const advancedTop = getTopTwoLabels(
    Object.fromEntries(aggregateCountData.map((row) => [row.label, row.advanced])),
    labels
  );

  const simpleLead = simpleTop[0];
  const advancedLead = advancedTop[0];
  if (!simpleLead || !advancedLead) return "No run-normalized selection pattern is available yet.";

  const simpleGap = simpleLead.value - (simpleTop[1]?.value ?? 0);
  const advancedGap = advancedLead.value - (advancedTop[1]?.value ?? 0);
  const sameLeader = simpleLead.label === advancedLead.label;

  return sameLeader
    ? `Both prompts most often finish with ${simpleLead.label} as the dominant full-run bucket. This looks sensible if the prompts share a common strategy, although the lead over the next bucket is only ${formatPerRun(
        Math.max(simpleGap, advancedGap),
        0
      )} runs.`
    : `GPT (Simple) most often ends with ${simpleLead.label} as its dominant full-run bucket, while GPT (Advanced) most often ends with ${advancedLead.label}. That looks like a real prompt difference because the lead over the next bucket is ${formatPerRun(
        Math.max(simpleGap, advancedGap),
        0
      )} runs.`;
}

function buildMixAnalysis(
  mixData: Array<{ label: string; simple: number; advanced: number }>
) {
  if (mixData.length === 0) return "No full-run bucket mix is available yet.";
  const biggestGap = [...mixData].sort((left, right) => Math.abs(right.simple - right.advanced) - Math.abs(left.simple - left.advanced))[0];
  if (!biggestGap) return "No full-run bucket mix is available yet.";
  const leader = biggestGap.simple >= biggestGap.advanced ? "GPT (Simple)" : "GPT (Advanced)";
  return `${leader} allocates a larger share of its full-run selection mix to ${biggestGap.label}. The gap is ${formatPct(
    Math.abs(biggestGap.simple - biggestGap.advanced),
    0
  )}, which is the clearest cross-prompt difference in the full-run mix.`;
}

function formatPeriodWindow(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) return "—";
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${startDate} - ${endDate}`;
  return `${start.toLocaleString("en-US", { month: "short", year: "2-digit" })} - ${end.toLocaleString("en-US", {
    month: "short",
    year: "2-digit",
  })}`;
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
      <p className="mb-3 max-w-3xl text-[12px] leading-5 text-[#737373]">
        Use this after reviewing the count-based charts if you want an extra natural-language interpretation.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full border-[#ececec] bg-[#fafafa] text-[12px] font-semibold"
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
          <span className="text-[#737373]">
            (If you see “openai_not_configured”, set <span className="font-mono">OPENAI_API_KEY</span> on the Node API
            and restart.)
          </span>
        </p>
      )}
      {analysis && (
        <div className="mt-4 max-h-[min(70vh,520px)] overflow-y-auto rounded-[14px] border border-[#ececec] bg-[#fafafa] px-4 py-3">
          <div className="whitespace-pre-wrap text-[12px] leading-6 text-[#404040] [word-break:break-word]">
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
  const [factorFilter, setFactorFilter] = useState<SelectionFactorKey>("value");
  const countSummaryRef = useRef<HTMLDivElement>(null);
  const runMixRef = useRef<HTMLDivElement>(null);

  const factorStyleFiltered = useMemo(() => {
    const rows = data.factor_style_rows ?? [];
    const scoped = marketFilter === "All" ? rows : rows.filter((r) => r.market === marketFilter);
    return [...scoped].sort((a, b) => {
      const sk = factorStyleSortKey(a.strategy_key) - factorStyleSortKey(b.strategy_key);
      if (sk !== 0) return sk;
      return (a.prompt_type ?? "").localeCompare(b.prompt_type ?? "");
    });
  }, [data.factor_style_rows, marketFilter]);

  const factorStyleGptOnly = useMemo(
    () => factorStyleFiltered.filter((r) => GPT_STRATEGY_KEYS.includes(r.strategy_key as GptStrategyKey)),
    [factorStyleFiltered]
  );

  useEffect(() => {
    setMarketFilter("All");
  }, [data.active_experiment_id]);

  useEffect(() => {
    if (marketFilter !== "All" && !allMarkets.includes(marketFilter)) {
      setMarketFilter("All");
    }
  }, [allMarkets, marketFilter]);

  const selectionSummaryQuery = useQuery({
    queryKey: [
      "factor-style-selection-summary",
      data.active_experiment_id,
      marketFilter,
      factorFilter,
    ],
    queryFn: async () => {
      try {
        return await getFactorSelectionSummary({
          experiment_id: data.active_experiment_id,
          market: marketFilter === "All" ? undefined : marketFilter,
          factor_key: factorFilter,
        });
      } catch (error) {
        if (!apiRouteLikelyMissing(error)) {
          throw error;
        }

        const holdingsByStrategy = Object.fromEntries(
          await Promise.all(
            GPT_STRATEGY_KEYS.map(async (strategyKey) => [
              strategyKey,
              await fetchAllDailyHoldings({
                experiment_id: data.active_experiment_id,
                strategy_key: strategyKey,
                market: marketFilter === "All" ? undefined : marketFilter,
              }),
            ])
          )
        ) as Record<GptStrategyKey, HoldingDailyRow[]>;

        const selectionRows = buildSelectionRows(holdingsByStrategy, factorFilter);
        const labelOrder = getLabelOrder(selectionRows);
        const displayedLabels = getDisplayedLabels(labelOrder);
        const profiles = buildRunProfiles(selectionRows, displayedLabels);

        return {
          factor_key: factorFilter,
          aggregate_counts: buildAggregateCountData(selectionRows, displayedLabels),
          prompt_summaries: GPT_STRATEGY_KEYS.map((strategyKey) =>
            buildPromptSummary(selectionRows, strategyKey)
          ),
          run_mix: buildRunMixData(profiles, displayedLabels),
          outcome_linkage: buildOutcomeLinkageRows(profiles, data.runs),
          regime_context: buildRegimeContextRows(holdingsByStrategy).map((row) => ({
            market: row.market,
            period: row.period,
            period_start_date: row.periodStartDate,
            period_end_date: row.periodEndDate,
            market_regime_label: row.marketRegimeLabel,
            vol_regime_label: row.volRegimeLabel,
            rate_regime_label: row.rateRegimeLabel,
          })),
        };
      }
    },
    enabled: Boolean(data.active_experiment_id),
    staleTime: 60_000,
  });

  const selectionSummary = selectionSummaryQuery.data;
  const aggregateCountData = selectionSummary?.aggregate_counts ?? [];
  const promptSummaries = selectionSummary?.prompt_summaries ?? [];
  const regimeContextRows: RegimeContextRow[] = useMemo(
    () =>
      (selectionSummary?.regime_context ?? []).map((row) => ({
        market: row.market,
        period: row.period,
        periodStartDate: row.period_start_date,
        periodEndDate: row.period_end_date,
        marketRegimeLabel: row.market_regime_label,
        volRegimeLabel: row.vol_regime_label,
        rateRegimeLabel: row.rate_regime_label,
      })),
    [selectionSummary]
  );

  const overallAnalysis = useMemo(
    () => buildOverallAnalysis(aggregateCountData),
    [aggregateCountData]
  );

  const runMixData = selectionSummary?.run_mix ?? [];

  const runMixAnalysis = useMemo(
    () => buildMixAnalysis(runMixData),
    [runMixData]
  );

  const outcomeLinkageRows = selectionSummary?.outcome_linkage ?? [];

  return (
    <div className="space-y-4 pb-1">
      <div className="dashboard-panel rounded-[18px] px-4 py-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#737373]">Market</span>
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="dashboard-select-input min-h-[42px]"
            >
              <option value="All">All Markets</option>
              {allMarkets.map((market) => (
                <option key={market} value={market}>
                  {MARKET_LABELS[market] ?? market}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#737373]">Factor bucket</span>
            <select
              value={factorFilter}
              onChange={(e) => setFactorFilter(e.target.value as SelectionFactorKey)}
              className="dashboard-select-input min-h-[42px]"
            >
              {Object.entries(FACTOR_CONFIG).map(([value, config]) => (
                <option key={value} value={value}>
                  {config.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div>
        <SectionHeader>Prompt selection counts</SectionHeader>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#525252]">
          The main question here is what each prompt actually selects over the full backtest. Each run is first collapsed
          into one whole-run profile, so the charts below reflect full-run behavior rather than repeated half-year slices.
        </p>
        <p className="mt-2 max-w-3xl text-[11px] leading-5 text-[#737373]">
          {FACTOR_CONFIG[factorFilter].label}: {FACTOR_CONFIG[factorFilter].definition}
        </p>
        {data.factor_style_error && (
          <p className="mt-2 max-w-3xl text-[11px] leading-5 text-[#a85a52]">
            Factor-style summary route warning: {data.factor_style_error}
          </p>
        )}
      </div>

      <SoftHr />

      {selectionSummaryQuery.isLoading ? (
        <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
          <InsightCard
            type="info"
            title="Loading prompt selection counts"
            body="Fetching compact selection summaries so the page can count how each prompt selects names across factor buckets."
          />
        </div>
      ) : selectionSummaryQuery.error ? (
        <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
          <InsightCard
            type="warn"
            title="Holdings request failed"
            body={selectionSummaryQuery.error instanceof Error ? selectionSummaryQuery.error.message : "Unable to load factor-selection summary."}
          />
        </div>
      ) : aggregateCountData.length === 0 ? (
        <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
          <InsightCard
            type="info"
            title="No labeled holdings for this factor"
            body={`No ${FACTOR_CONFIG[factorFilter].label.toLowerCase()} labels were returned for the selected market. Try another market or factor bucket.`}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {GPT_STRATEGY_KEYS.map((strategyKey) => {
              const summary = promptSummaries.find((row) => row.strategy_key === strategyKey);
              const runCount = summary?.run_count ?? 0;
              const dominantCount = summary?.dominant_count ?? 0;
              const dominantShare = summary?.dominant_share ?? 0;
              return (
                <div key={strategyKey} className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
                  <p className="dashboard-label mb-2">{formatPromptLabel(strategyKey)}</p>
                  <p className="text-[18px] font-semibold text-[#534b45]">{summary?.dominant_label ?? "—"}</p>
                  <p className="mt-2 text-[12px] leading-5 text-[#525252]">
                    Most common dominant full-run {FACTOR_CONFIG[factorFilter].label.toLowerCase()} bucket, leading in{" "}
                    {dominantCount} of {runCount} runs ({formatPct(dominantShare, 0)}).
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#737373]">
                    <span className="rounded-full border border-[#ececec] px-2.5 py-1">
                      Runs: {runCount}
                    </span>
                    <span className="rounded-full border border-[#ececec] px-2.5 py-1">
                      Dates: {summary?.date_count ?? 0}
                    </span>
                    <span className="rounded-full border border-[#ececec] px-2.5 py-1">
                      Periods: {summary?.period_count ?? 0}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="dashboard-label">What each prompt selects</p>
                <p className="mt-1 text-[12px] leading-5 text-[#737373]">
                  Count of full runs by dominant bucket. Each run contributes once, based on the bucket that dominates its
                  full backtest selection profile.
                </p>
              </div>
              <FigureExportControls
                captureRef={countSummaryRef}
                slug="factor-style-selection-counts"
                caption="Factor Style — Selection counts by prompt"
                experimentId={data.active_experiment_id}
              />
            </div>
            <div ref={countSummaryRef} className="min-w-0">
              <ResponsiveContainer width="100%" height={Math.max(240, aggregateCountData.length * 56 + 90)}>
                <BarChart data={aggregateCountData} layout="vertical" margin={{ left: 8, right: 20, top: 8, bottom: 8 }}>
                  <CartesianGrid horizontal stroke="rgba(220, 213, 206, 0.7)" vertical strokeDasharray="3 6" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#aca49d" }} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={150}
                    interval={0}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#737373" }}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number) => `${Number(value).toFixed(0)} runs`}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: "#737373", paddingTop: 10 }} iconType="circle" iconSize={8} />
                  <Bar dataKey="simple" name="GPT (Simple)" fill={STRATEGY_COLORS.gpt_simple} radius={[0, 4, 4, 0]} barSize={14} />
                  <Bar dataKey="advanced" name="GPT (Advanced)" fill={STRATEGY_COLORS.gpt_advanced} radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 text-[12px] leading-5 text-[#525252]">{overallAnalysis}</p>
          </div>

          <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="dashboard-label">Average full-run mix</p>
                <p className="mt-1 text-[12px] leading-5 text-[#737373]">
                  Average bucket share inside the full-run profile. This shows how much of the total run each prompt spends
                  in each bucket, after collapsing each run to one whole-run mix.
                </p>
              </div>
              <FigureExportControls
                captureRef={runMixRef}
                slug="factor-style-full-run-mix"
                caption="Factor Style — Average full-run mix"
                experimentId={data.active_experiment_id}
              />
            </div>
            <div ref={runMixRef} className="min-w-0">
              <ResponsiveContainer width="100%" height={Math.max(240, runMixData.length * 56 + 90)}>
                <BarChart data={runMixData} layout="vertical" margin={{ left: 8, right: 20, top: 8, bottom: 8 }}>
                  <CartesianGrid horizontal stroke="rgba(220, 213, 206, 0.7)" vertical strokeDasharray="3 6" />
                  <XAxis
                    type="number"
                    domain={[0, 1]}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#aca49d" }}
                    tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={150}
                    interval={0}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#737373" }}
                  />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => formatPct(Number(value), 1)} />
                  <Legend wrapperStyle={{ fontSize: 10, color: "#737373", paddingTop: 10 }} iconType="circle" iconSize={8} />
                  <Bar dataKey="simple" name="GPT (Simple)" fill={STRATEGY_COLORS.gpt_simple} radius={[0, 4, 4, 0]} barSize={14} />
                  <Bar dataKey="advanced" name="GPT (Advanced)" fill={STRATEGY_COLORS.gpt_advanced} radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 text-[12px] leading-5 text-[#525252]">{runMixAnalysis}</p>
          </div>

          {outcomeLinkageRows.length > 0 && (
            <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
              <div className="mb-3">
                <p className="dashboard-label">Outcome linkage by dominant full-run bucket</p>
                <p className="mt-1 text-[12px] leading-5 text-[#737373]">
                  This links each run&apos;s dominant full-run bucket to realized outcomes, so you can see whether certain
                  selection styles tend to coincide with stronger Sharpe or return profiles.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-[11px]">
                  <thead>
                    <tr className="border-b border-[#ececec] text-left text-[#a3a3a3]">
                      <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Dominant bucket</th>
                      <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Model</th>
                      <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Prompt</th>
                      <th className="py-2 pr-3 text-right font-semibold uppercase tracking-[0.12em]">Runs</th>
                      <th className="py-2 pr-3 text-right font-semibold uppercase tracking-[0.12em]">Mean Sharpe</th>
                      <th className="py-2 text-right font-semibold uppercase tracking-[0.12em]">Mean realized return</th>
                    </tr>
                  </thead>
                  <tbody>
                  {outcomeLinkageRows.slice(0, 18).map((row) => (
                      <tr key={`${row.dominant_label}-${row.model}-${row.prompt_type}`} className="border-b border-[#ececec] last:border-0">
                        <td className="py-2 pr-3 text-[#404040]">{row.dominant_label}</td>
                        <td className="py-2 pr-3 text-[#737373]">{row.model}</td>
                        <td className="py-2 pr-3 text-[#737373]">{row.prompt_type}</td>
                        <td className="py-2 pr-3 text-right text-[#737373]">{row.count}</td>
                        <td className="py-2 pr-3 text-right text-[#737373]">{row.mean_sharpe != null ? row.mean_sharpe.toFixed(2) : "—"}</td>
                        <td className="py-2 text-right text-[#737373]">{formatPct(row.mean_return, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {regimeContextRows.length > 0 && (
            <div className="dashboard-panel-strong rounded-[20px] p-4 md:p-5">
              <div className="mb-3">
                <p className="dashboard-label">Regime context</p>
                <p className="mt-1 text-[12px] leading-5 text-[#737373]">
                  Period-level `Mkt / Vol / Rate` labels for the counts above, so you can read prompt selection shifts
                  against the regime backdrop.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-[11px]">
                  <thead>
                    <tr className="border-b border-[#ececec] text-left text-[#a3a3a3]">
                      <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Market</th>
                      <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Period</th>
                      <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Window</th>
                      <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Mkt</th>
                      <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Vol</th>
                      <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regimeContextRows.map((row) => (
                      <tr key={`${row.market}-${row.period}`} className="border-b border-[#ececec] last:border-0">
                        <td className="py-2 pr-3 text-[#404040]">{MARKET_LABELS[row.market] ?? row.market}</td>
                        <td className="py-2 pr-3 text-[#404040]">{row.period}</td>
                        <td className="py-2 pr-3 text-[#737373]">
                          {formatPeriodWindow(row.periodStartDate, row.periodEndDate)}
                        </td>
                        <td className="py-2 pr-3 text-[#737373]">{row.marketRegimeLabel ?? "—"}</td>
                        <td className="py-2 pr-3 text-[#737373]">{row.volRegimeLabel ?? "—"}</td>
                        <td className="py-2 pr-3 text-[#737373]">{row.rateRegimeLabel ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {factorStyleGptOnly.length > 0 && (
            <FactorStyleAiSection
              experimentId={data.active_experiment_id}
              marketFilter={marketFilter}
              factorStyleFiltered={factorStyleGptOnly}
            />
          )}

          <div className="mt-4 space-y-3">
            <SectionHeader>Method notes</SectionHeader>
            <p className="max-w-3xl text-[12px] leading-5 text-[#737373]">
              {FACTOR_DEFINITIONS_BLURB} Each run is collapsed into one full-run selection profile before charting, so the
              main view reflects whole-backtest behavior instead of repeated half-year windows.
            </p>
            <Accordion type="multiple" className="dashboard-panel rounded-[16px] border border-[#ececec] px-3">
              {GPT_STRATEGY_KEYS.map((key) => {
                const g = STRATEGY_GLOSSARY[key];
                const title = g?.title ?? key;
                const summary = g?.summary ?? "Use the count panels above to see what this prompt selects over time.";
                return (
                  <AccordionItem key={key} value={key} className="border-[#ececec]">
                    <AccordionTrigger className="py-3 text-left text-[12px] font-semibold text-[#404040] hover:no-underline">
                      {title}
                    </AccordionTrigger>
                    <AccordionContent className="text-[12px] leading-5 text-[#525252]">{summary}</AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        </>
      )}
    </div>
  );
}
