import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import {
  BehaviorTab,
  ByMarketTab,
  DataQualityTab,
  DrawdownsTab,
  EquityCurvesTab,
  PortfoliosTab,
  RunExplorerTab,
  SharpeReturnsTab,
  StatisticalTestsTab,
} from "@/components/dashboard/DetailTabs";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { Button } from "@/components/ui/button";
import { getHealth, getMetaCurrent } from "@/lib/api-client";
import {
  buildStrategySummaryView,
  fetchEvaluationData,
} from "@/lib/data-loader";
import type { EvaluationData, RunRow } from "@/lib/types";

const TAB_NAMES = [
  "Overview",
  "Sharpe & Returns",
  "Equity Curves",
  "Portfolios",
  "Run Explorer",
  "By Market",
  "Statistical Tests",
  "Behavior",
  "Drawdowns",
  "Data Quality",
] as const;

function LoadingPanel() {
  return (
    <div className="flex-1 px-4 pb-4 pt-4 md:px-6 md:pb-6">
      <div className="dashboard-panel-strong flex h-full min-h-[360px] items-center justify-center rounded-[22px] p-8">
        <div className="animate-fade-in space-y-4 text-center">
          <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-[20px] border border-white/70 bg-white/50">
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
          <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-[20px] border border-white/70 bg-white/50">
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
              className="rounded-full border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.7)] text-[11px] font-semibold text-[#6e6762] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] hover:bg-white hover:text-[#5d5754]"
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
  const [marketFilter, setMarketFilter] = useState("All");
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

  useEffect(() => {
    setMarketFilter("All");
    setActiveTab(0);
  }, [resolvedExperimentId]);

  const data = (dashboardQuery.data ?? null) as EvaluationData | null;

  const visibleData = useMemo(() => {
    if (!data) {
      return null;
    }

    return {
      ...data,
      summary: buildStrategySummaryView(data.summary_rows, marketFilter),
    };
  }, [data, marketFilter]);

  const filteredRuns: RunRow[] = useMemo(() => {
    if (!data) {
      return [];
    }

    return marketFilter !== "All"
      ? data.runs.filter((run) => run.market === marketFilter)
      : data.runs;
  }, [data, marketFilter]);

  const isLoading =
    healthQuery.isLoading ||
    metaQuery.isLoading ||
    (Boolean(resolvedExperimentId) && dashboardQuery.isLoading);

  const errorMessage =
    (healthQuery.error as Error | null)?.message ??
    (metaQuery.error as Error | null)?.message ??
    (dashboardQuery.error as Error | null)?.message ??
    null;

  const handleRefresh = () => {
    void healthQuery.refetch();
    void metaQuery.refetch();
    void dashboardQuery.refetch();
  };

  const handleReset = () => {
    setSelectedExperimentId(undefined);
    setMarketFilter("All");
    setActiveTab(0);
    void metaQuery.refetch();
    void dashboardQuery.refetch();
  };

  return (
    <div className="min-h-screen px-4 py-4 md:px-8 md:py-7">
      <div className="dashboard-board mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1440px] flex-col overflow-hidden rounded-[28px] lg:h-[calc(100vh-3.5rem)] lg:flex-row">
        <DashboardSidebar
          data={data}
          meta={metaQuery.data}
          health={healthQuery.data}
          isLoading={isLoading}
          marketFilter={marketFilter}
          selectedExperimentId={selectedExperimentId}
          onMarketFilterChange={setMarketFilter}
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
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#aaa29a]">
                  <span className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5">
                    Market: {marketFilter}
                  </span>
                  <span className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5">
                    Experiment: {resolvedExperimentId ?? "Loading"}
                  </span>
                  <span className="rounded-full border border-white/70 bg-white/40 px-3 py-1.5">
                    {data
                      ? `${filteredRuns.length} runs loaded`
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
          ) : isLoading || !visibleData ? (
            <LoadingPanel />
          ) : (
            <>
              <div className="shrink-0 px-4 pb-2 pt-4 md:px-6">
                <div className="flex flex-wrap gap-2">
                  {TAB_NAMES.map((name, index) => (
                    <button
                      key={name}
                      onClick={() => setActiveTab(index)}
                      className={`rounded-full border px-3.5 py-1.5 text-[11px] font-semibold transition-all ${
                        activeTab === index
                          ? "border-[#191513] bg-[#191513] text-[#f9f6f1] shadow-[0_8px_18px_rgba(35,28,22,0.18)]"
                          : "border-[rgba(232,224,217,0.94)] bg-[rgba(255,255,252,0.46)] text-[#b0a8a1] hover:bg-[rgba(255,255,252,0.78)] hover:text-[#7b736e]"
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-4 md:px-6 md:pb-6">
                {activeTab === 0 && (
                  <OverviewTab data={visibleData} runs={filteredRuns} marketFilter={marketFilter} />
                )}
                {activeTab === 1 && (
                  <SharpeReturnsTab
                    data={visibleData}
                    runs={filteredRuns}
                    marketFilter={marketFilter}
                  />
                )}
                {activeTab === 2 && (
                  <EquityCurvesTab
                    data={visibleData}
                    runs={filteredRuns}
                    marketFilter={marketFilter}
                  />
                )}
                {activeTab === 3 && (
                  <PortfoliosTab
                    data={visibleData}
                    runs={filteredRuns}
                    marketFilter={marketFilter}
                  />
                )}
                {activeTab === 4 && (
                  <RunExplorerTab
                    data={visibleData}
                    runs={filteredRuns}
                    marketFilter={marketFilter}
                  />
                )}
                {activeTab === 5 && (
                  <ByMarketTab
                    data={visibleData}
                    runs={filteredRuns}
                    marketFilter={marketFilter}
                  />
                )}
                {activeTab === 6 && (
                  <StatisticalTestsTab
                    data={visibleData}
                    runs={filteredRuns}
                    marketFilter={marketFilter}
                  />
                )}
                {activeTab === 7 && (
                  <BehaviorTab
                    data={visibleData}
                    runs={filteredRuns}
                    marketFilter={marketFilter}
                  />
                )}
                {activeTab === 8 && (
                  <DrawdownsTab
                    data={visibleData}
                    runs={filteredRuns}
                    marketFilter={marketFilter}
                  />
                )}
                {activeTab === 9 && (
                  <DataQualityTab
                    data={visibleData}
                    runs={filteredRuns}
                    marketFilter={marketFilter}
                  />
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
