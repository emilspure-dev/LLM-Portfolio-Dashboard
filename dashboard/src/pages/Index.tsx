import { useState, useCallback } from "react";
import { Upload } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { loadEvaluationData } from "@/lib/data-loader";
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

export default function Index() {
  const [data, setData] = useState<EvaluationData | null>(null);
  const [marketFilter, setMarketFilter] = useState("All");
  const [activeTab, setActiveTab] = useState(0);

  const handleFileLoad = useCallback((buffer: ArrayBuffer) => {
    const parsed = loadEvaluationData(buffer);
    setData(parsed);
    setMarketFilter("All");
    setActiveTab(0);
  }, []);

  const handleClear = useCallback(() => {
    setData(null);
    setMarketFilter("All");
  }, []);

  const filteredRuns: RunRow[] =
    data && marketFilter !== "All"
      ? data.runs.filter((r) => r.market === marketFilter)
      : data?.runs ?? [];

  return (
    <div className="min-h-screen px-4 py-4 md:px-8 md:py-7">
      <div className="dashboard-board mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1440px] flex-col overflow-hidden rounded-[28px] lg:h-[calc(100vh-3.5rem)] lg:flex-row">
      <DashboardSidebar
        data={data}
        marketFilter={marketFilter}
        onMarketFilterChange={setMarketFilter}
        onFileLoad={handleFileLoad}
        onClear={handleClear}
      />

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 px-4 pt-4 md:px-6 md:pt-6">
            <div className="dashboard-panel-strong rounded-[20px] px-4 py-4 md:px-6 md:py-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="dashboard-label mb-2">Research Workspace</p>
                  <h1 className="text-[20px] font-semibold tracking-[-0.04em] text-[#5d5754] md:text-[24px]">
                    AI Portfolio Evaluation Dashboard
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
                    {data ? `${filteredRuns.length} runs loaded` : "Awaiting file"}
                  </span>
                </div>
              </div>
            </div>
          </header>

          {!data ? (
            <div className="flex-1 px-4 pb-4 pt-4 md:px-6 md:pb-6">
              <div className="dashboard-panel-strong flex h-full min-h-[360px] items-center justify-center rounded-[22px] p-8">
                <div className="animate-fade-in space-y-4 text-center">
                  <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-[20px] border border-white/70 bg-white/50">
                    <Upload className="h-6 w-6 text-[#b39a91]" />
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold tracking-[-0.03em] text-[#625c58]">
                      Upload your evaluation package
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-[#a39b93]">
                      Drop your evaluation_package_all_*.xlsx file in the sidebar to
                      get started.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="shrink-0 px-4 pb-2 pt-4 md:px-6">
                <div className="flex flex-wrap gap-2">
                  {TAB_NAMES.map((name, i) => (
                    <button
                      key={name}
                      onClick={() => setActiveTab(i)}
                      className={`rounded-full border px-3.5 py-1.5 text-[11px] font-semibold transition-all ${
                        activeTab === i
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
                  <OverviewTab data={data} runs={filteredRuns} />
                )}
                {activeTab > 0 && (
                  <div className="dashboard-panel-strong flex h-64 items-center justify-center rounded-[22px] text-sm text-[#9a918a]">
                    {TAB_NAMES[activeTab]} — coming in Phase{" "}
                    {activeTab <= 2 ? 2 : activeTab <= 4 ? 3 : activeTab <= 8 ? 4 : 5}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
