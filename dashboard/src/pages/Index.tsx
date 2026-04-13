import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
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
    <div className="flex-1 px-4 pb-4 pt-4 md:px-6 md:pb-6">
      <div className="dashboard-panel-strong flex h-full min-h-[360px] items-center justify-center rounded-[22px] p-8">
        <div className="animate-fade-in space-y-4 text-center">
          <div className="dashboard-glass-inset mx-auto inline-flex h-16 w-16 items-center justify-center rounded-[20px]">
            <Loader2 className="h-6 w-6 animate-spin text-[#b39a91]" />
          </div>
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.03em] text-[#625c58]">
              Loading dashboard data
            </p>
            <p className="mt-1 text-[12px] leading-5 text-[#a39b93]">
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
    <div className="flex-1 px-4 pb-4 pt-4 md:px-6 md:pb-6">
      <div className="dashboard-panel-strong flex h-full min-h-[360px] items-center justify-center rounded-[22px] p-8">
        <div className="animate-fade-in space-y-4 text-center">
          <div className="dashboard-glass-inset mx-auto inline-flex h-16 w-16 items-center justify-center rounded-[20px]">
            <WifiOff className="h-6 w-6 text-[#b39a91]" />
          </div>
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.03em] text-[#625c58]">
              Unable to load dashboard data
            </p>
            <p className="mt-1 max-w-xl text-[12px] leading-5 text-[#a39b93]">
              {message}
            </p>
          </div>
          <div className="flex justify-center">
            <Button
              variant="outline"
              className="rounded-full border border-white/45 bg-white/50 text-[11px] font-semibold text-[#5d5754] shadow-sm backdrop-blur-sm hover:bg-white/75 hover:text-[#4a4542]"
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
    <div className="min-h-screen px-4 py-4 md:px-8 md:py-7">
      <div className="dashboard-board mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1440px] flex-col overflow-hidden rounded-[28px] lg:h-[calc(100vh-3.5rem)] lg:flex-row">
        <DashboardSidebar
          data={visibleData ?? data}
          meta={metaQuery.data}
          health={healthQuery.data}
          apiHealthPending={healthQuery.isPending && !healthQuery.data}
          selectedExperimentId={selectedExperimentId}
          onExperimentChange={setSelectedExperimentId}
          onRefresh={handleRefresh}
          onReset={handleReset}
        />

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 px-4 pt-4 md:px-6 md:pt-6">
            <div className="dashboard-panel-strong rounded-[20px] px-4 py-4 md:px-6 md:py-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="dashboard-label mb-2">Research Workspace</p>
                  <h1 className="text-[20px] font-semibold tracking-[-0.04em] text-[#5d5754] md:text-[24px]">
                    LLM Portfolio Evaluation Dashboard
                  </h1>
                  <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[#9d958d] md:text-[13px]">
                    Empirical study of AI-based portfolio construction and rebalancing
                    for retail investors
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#7a726c]">
                  <span className="rounded-full border border-white/50 bg-white/55 px-3 py-1.5 shadow-sm backdrop-blur-sm">
                    Experiment: {resolvedExperimentId ?? "Loading"}
                  </span>
                  <span className="rounded-full border border-white/50 bg-white/55 px-3 py-1.5 shadow-sm backdrop-blur-sm">
                    {data
                      ? allRuns.length > 0
                        ? `${allRuns.length} runs loaded`
                        : data.overview_summary
                          ? `${data.overview_summary.valid_runs} run rows available`
                          : runsQuery.isLoading
                            ? "Loading run details"
                            : "Summary ready"
                      : isLoading
                        ? "Loading from API"
                        : "Awaiting API"}
                  </span>
                </div>
              </div>
            </div>
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
              <div className="shrink-0 px-4 pb-2 pt-4 md:px-6">
                <div className="dashboard-tab-bar rounded-[22px] p-2 md:p-2.5">
                  <div className="flex flex-wrap gap-2">
                    {TAB_NAMES.map((name, index) => (
                      <button
                        key={name}
                        onClick={() => setActiveTab(index)}
                        type="button"
                        className={`rounded-full border px-3.5 py-1.5 text-[11px] font-semibold transition-all ${
                          activeTab === index
                            ? "border-[#191513] bg-[#191513] text-[#f9f6f1] shadow-[0_8px_18px_rgba(35,28,22,0.22)]"
                            : "border-white/45 bg-white/45 text-[#6e6762] shadow-sm backdrop-blur-sm hover:bg-white/65 hover:text-[#4a4542]"
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-4 md:px-6 md:pb-6">
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
    </div>
  );
}
