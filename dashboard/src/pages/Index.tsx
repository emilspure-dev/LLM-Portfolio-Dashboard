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
      <div className="dashboard-panel-strong flex min-h-[360px] items-center justify-center rounded-[10px] p-8">
        <div className="animate-fade-in space-y-4 text-center">
          <div className="dashboard-glass-inset mx-auto inline-flex h-14 w-14 items-center justify-center rounded-[10px]">
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
      <div className="dashboard-panel-strong flex min-h-[360px] items-center justify-center rounded-[10px] p-8">
        <div className="animate-fade-in space-y-4 text-center">
          <div className="dashboard-glass-inset mx-auto inline-flex h-14 w-14 items-center justify-center rounded-[10px]">
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
              className="rounded-md px-4 text-[12px] font-medium"
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
  const [selectedExperimentId, setSelectedExperimentId] = useState<string>();
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

  const resolvedExperimentId =
    selectedExperimentId ?? metaQuery.data?.latest_experiment_id ?? undefined;

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
  const activeExperiment =
    metaQuery.data?.available_experiments.find(
      (experiment) => experiment.experiment_id === resolvedExperimentId
    ) ?? null;
  const completedAtLabel = formatCompletedAt(
    activeExperiment?.completed_at ?? metaQuery.data?.latest_completed_at
  );
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
  const apiStatusLabel =
    healthQuery.isPending && !healthQuery.data
      ? "Checking read-only API"
      : healthQuery.data?.db_available
        ? "Read-only API online"
        : healthQuery.data
          ? "API degraded"
          : "API unavailable";
  const datasetStatusLabel = data
    ? allRuns.length > 0
      ? `${allRuns.length.toLocaleString()} run details loaded`
      : data.overview_summary
        ? `${data.overview_summary.valid_runs.toLocaleString()} run rows available`
        : runsQuery.isLoading
          ? "Loading run details"
          : "Summary ready"
    : isLoading
      ? "Loading from API"
      : "Awaiting API";
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

  const handleReset = () => {
    setSelectedExperimentId(undefined);
    setActiveTab(0);
    void metaQuery.refetch();
    void dashboardQuery.refetch();
    if (resolvedExperimentId) {
      void runsQuery.refetch();
    }
  };

  return (
    <div className="min-h-screen">
      <main className="dashboard-board mx-auto max-w-[1520px] px-4 py-5 md:px-8 md:py-8">
        <header className="border-b border-[#ececec] pb-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <p className="dashboard-topline">
                Empirical Research
                <span className="px-1.5 text-[#a3a3a3]">·</span>
                Experiment {resolvedExperimentId ?? "Loading"}
              </p>
              <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] text-[#0a0a0a] md:text-[36px]">
                LLM Portfolio Evaluation Dashboard
              </h1>
              <p className="mt-2 max-w-3xl text-[14px] leading-6 text-[#525252]">
                Empirical study of AI-based portfolio construction and rebalancing
                for retail investors.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:min-w-[420px]">
              {headlineStats.map((stat) => (
                <div key={stat.label} className="dashboard-stat">
                  <p className="dashboard-stat-value">{stat.value}</p>
                  <p className="dashboard-stat-label">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:flex-wrap">
              {metaQuery.data && metaQuery.data.available_experiments.length > 0 && (
                <label className="flex min-w-[min(100%,320px)] flex-col gap-2">
                  <span className="dashboard-label">Experiment</span>
                  <select
                    value={resolvedExperimentId ?? ""}
                    onChange={(event) =>
                      setSelectedExperimentId(event.target.value || undefined)
                    }
                    className="dashboard-select-input min-h-[44px] min-w-[220px]"
                  >
                    {metaQuery.data.available_experiments.map((experiment) => (
                      <option
                        key={experiment.experiment_id}
                        value={experiment.experiment_id}
                      >
                        {experiment.experiment_id}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="h-10 rounded-md px-3.5 text-[13px] font-medium"
                  onClick={handleRefresh}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh data
                </Button>
                <Button
                  variant="outline"
                  className="h-10 rounded-md px-3.5 text-[13px] font-medium"
                  onClick={handleReset}
                >
                  Reset view
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="dashboard-pill">{apiStatusLabel}</span>
              <span className="dashboard-pill">{datasetStatusLabel}</span>
              <span className="dashboard-pill">Completed {completedAtLabel}</span>
            </div>
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
              <div className="flex min-w-0 gap-1 overflow-x-auto">
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
