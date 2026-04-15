import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import {
  BehaviorTab,
  DiagnosticsTab,
  ByMarketTab,
  FactorStyleTab,
  PathsTab,
  RegimesTab,
  StrategiesTab,
} from "@/components/dashboard/DetailTabs";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { Button } from "@/components/ui/button";
import { getHealth, getMetaCurrent } from "@/lib/api-client";
import {
  buildStrategySummaryWithRunSharpe,
  computeBehavior,
  fetchEvaluationData,
  fetchAllRunResults,
} from "@/lib/data-loader";
import type { EvaluationData, RunRow } from "@/lib/types";

const TAB_NAMES = [
  "Overview",
  "Performance",
  "Factor Style",
  "Paths",
  "Markets",
  "Regimes",
  "Behavior",
  "Diagnostics",
] as const;

function LoadingPanel() {
  return (
    <div className="py-8">
      <div className="dashboard-panel-strong flex min-h-[360px] items-center justify-center rounded-none p-8">
        <div className="animate-fade-in space-y-4 text-center">
          <div className="dashboard-glass-inset mx-auto inline-flex h-14 w-14 items-center justify-center rounded-none">
            <Loader2 className="h-6 w-6 animate-spin text-[#525252]" />
          </div>
          <div>
            <p className="text-[15px] font-medium tracking-[-0.01em] text-[#0a0a0a]">
              Loading dashboard data
            </p>
            <p className="mt-1 text-[13px] leading-5 text-[#737373]">
              Pulling the latest experiment from the read-only API.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ErrorPanelProps {
  message: string;
  onRetry: () => void;
}

function ErrorPanel({ message, onRetry }: ErrorPanelProps) {
  return (
    <div className="py-8">
      <div className="dashboard-panel-strong flex min-h-[360px] items-center justify-center rounded-none p-8">
        <div className="animate-fade-in space-y-4 text-center">
          <div className="dashboard-glass-inset mx-auto inline-flex h-14 w-14 items-center justify-center rounded-none">
            <WifiOff className="h-6 w-6 text-[#525252]" />
          </div>
          <div>
            <p className="text-[15px] font-medium tracking-[-0.01em] text-[#0a0a0a]">
              Unable to load dashboard data
            </p>
            <p className="mt-1 max-w-xl text-[13px] leading-5 text-[#737373]">
              {message}
            </p>
          </div>
          <div className="flex justify-center">
            <Button
              variant="outline"
              className="rounded-none px-4 text-[12px] font-medium"
              onClick={onRetry}
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCompletedAt(value: string | null | undefined) {
  if (!value) {
    return "Unknown completion";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function Index() {
  const [activeTab, setActiveTab] = useState(0);

  const healthQuery = useQuery({
    queryKey: ["api-health"],
    queryFn: getHealth,
    staleTime: 60_000,
    retry: 1,
  });

  const metaQuery = useQuery({
    queryKey: ["meta-current"],
    queryFn: getMetaCurrent,
    staleTime: 60_000,
  });

  const resolvedExperimentId = metaQuery.data?.latest_experiment_id ?? undefined;

  const dashboardQuery = useQuery({
    queryKey: ["dashboard-data", resolvedExperimentId],
    queryFn: () =>
      fetchEvaluationData({
        experimentId: resolvedExperimentId!,
        meta: metaQuery.data!,
      }),
    enabled: Boolean(resolvedExperimentId && metaQuery.data),
    staleTime: 30_000,
  });

  const runsQuery = useQuery({
    queryKey: ["dashboard-runs", resolvedExperimentId],
    queryFn: () => fetchAllRunResults(resolvedExperimentId!),
    enabled:
      Boolean(resolvedExperimentId && metaQuery.data) &&
      dashboardQuery.status === "success",
    staleTime: 30_000,
  });

  useEffect(() => {
    setActiveTab(0);
  }, [resolvedExperimentId]);

  const data = (dashboardQuery.data ?? null) as EvaluationData | null;

  // Summary and runs are always unfiltered (all markets); each tab manages its own market filter.
  const allRuns: RunRow[] = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);

  const visibleData = useMemo(() => {
    if (!data) {
      return null;
    }
    return {
      ...data,
      runs: allRuns,
      run_details_loading: runsQuery.isLoading || runsQuery.isFetching,
      behavior:
        data.behavior.length > 0 ? data.behavior : computeBehavior(allRuns),
      summary: buildStrategySummaryWithRunSharpe(
        data.summary_rows,
        "All",
        allRuns
      ),
    };
  }, [allRuns, data, runsQuery.isFetching, runsQuery.isLoading]);

  const isLoading =
    healthQuery.isLoading ||
    metaQuery.isLoading ||
    (Boolean(resolvedExperimentId) && dashboardQuery.isLoading);
  const errorMessage =
    (healthQuery.error as Error | null)?.message ??
    (metaQuery.error as Error | null)?.message ??
    (dashboardQuery.error as Error | null)?.message ??
    (runsQuery.error as Error | null)?.message ??
    null;
  const noExperimentAvailable =
    !isLoading &&
    !errorMessage &&
    metaQuery.status === "success" &&
    !resolvedExperimentId;
  const completedAtLabel = formatCompletedAt(metaQuery.data?.latest_completed_at);
  const runCount =
    allRuns.length > 0
      ? allRuns.length
      : data?.overview_summary?.valid_runs ?? 0;
  const periodCount =
    data?.filters.periods.length ?? metaQuery.data?.available_periods.length ?? 0;
  const marketCount =
    data?.filters.markets.length ?? metaQuery.data?.available_markets.length ?? 0;
  const modelCount =
    data?.filters.models.length ?? metaQuery.data?.available_models.length ?? 0;
  const headlineStats = [
    { label: "Runs", value: runCount.toLocaleString() },
    { label: "Periods", value: periodCount.toLocaleString() },
    { label: "Markets", value: marketCount.toLocaleString() },
    { label: "Models", value: modelCount.toLocaleString() },
  ];

  const handleRefresh = () => {
    void healthQuery.refetch();
    void metaQuery.refetch();
    void dashboardQuery.refetch();
    if (resolvedExperimentId) {
      void runsQuery.refetch();
    }
  };

  return (
    <div className="min-h-screen">
      <main className="dashboard-board mx-auto max-w-[1520px] px-4 py-5 md:px-8 md:py-8">
        <header className="border-b border-[#111111] pb-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <p className="dashboard-topline">Empirical Research</p>
              <h1 className="mt-3 text-[34px] font-semibold leading-[1.15] text-[#111111] md:text-[44px]">
                LLMs in Portfolio Construction
              </h1>
              <p className="mt-3 max-w-3xl text-[15px] leading-[1.6] text-[#333333]">
                An empirical study of AI-based portfolio construction and
                rebalancing for retail investors.
              </p>
              <p className="mt-2 max-w-3xl text-[14px] leading-[1.6] text-[#444444]">
                <span className="italic">Authors:</span> Jonathan K. Mogensen and Emil S. Olsen
              </p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:mt-10 xl:min-w-[420px] xl:self-end">
              {headlineStats.map((stat) => (
                <div key={stat.label} className="dashboard-stat">
                  <p className="dashboard-stat-value">{stat.value}</p>
                  <p className="dashboard-stat-label">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="dashboard-pill">Completed {completedAtLabel}</span>
          </div>

          {healthQuery.data &&
            healthQuery.data.routes?.factor_style !== true &&
            !(
              (data?.factor_style_rows?.length ?? 0) > 0 && !data?.factor_style_error
            ) && (
            <p className="mt-4 text-[12px] leading-5 text-[#b45309]">
              Factor Style needs the backend route{" "}
              <code className="rounded bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[11px]">
                GET /api/summary/factor-style
              </code>{" "}
              on the active API process.
            </p>
          )}
        </header>

        {errorMessage ? (
          <ErrorPanel message={errorMessage} onRetry={handleRefresh} />
        ) : noExperimentAvailable ? (
          <ErrorPanel
            message="No completed experiment is currently available from the API."
            onRetry={handleRefresh}
          />
        ) : isLoading || !visibleData ? (
          <LoadingPanel />
        ) : (
          <>
            <div className="dashboard-tab-bar mt-4">
              <div className="flex flex-wrap gap-1">
                {TAB_NAMES.map((name, index) => (
                  <button
                    key={name}
                    onClick={() => setActiveTab(index)}
                    type="button"
                    className={`dashboard-tab-button ${
                      activeTab === index ? "dashboard-tab-button-active" : ""
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-6">
              {activeTab === 0 && <OverviewTab data={visibleData} runs={allRuns} />}
              {activeTab === 1 && (
                <StrategiesTab data={visibleData} runs={allRuns} />
              )}
              {activeTab === 2 && (
                <FactorStyleTab data={visibleData} />
              )}
              {activeTab === 3 && (
                <PathsTab data={visibleData} runs={allRuns} />
              )}
              {activeTab === 4 && (
                <ByMarketTab data={visibleData} runs={allRuns} />
              )}
              {activeTab === 5 && (
                <RegimesTab data={visibleData} runs={allRuns} />
              )}
              {activeTab === 6 && (
                <BehaviorTab data={visibleData} runs={allRuns} />
              )}
              {activeTab === 7 && (
                <DiagnosticsTab data={visibleData} runs={allRuns} />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
