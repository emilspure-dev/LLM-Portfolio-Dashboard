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
    <div className="flex h-screen overflow-hidden">
      <DashboardSidebar
        data={data}
        marketFilter={marketFilter}
        onMarketFilterChange={setMarketFilter}
        onFileLoad={handleFileLoad}
        onClear={handleClear}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="shrink-0 border-b border-border px-6 py-4">
          <h1 className="text-lg font-bold text-foreground">
            AI Portfolio Evaluation Dashboard
          </h1>
          <p className="text-xs text-muted-foreground">
            Empirical study of AI-based portfolio construction and rebalancing
            for retail investors
          </p>
        </header>

        {!data ? (
          /* Empty state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4 animate-fade-in">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary">
                <Upload className="h-7 w-7 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Upload your evaluation package
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Drop your evaluation_package_all_*.xlsx file in the sidebar to
                  get started.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="shrink-0 border-b border-border px-6 overflow-x-auto">
              <div className="flex gap-0">
                {TAB_NAMES.map((name, i) => (
                  <button
                    key={name}
                    onClick={() => setActiveTab(i)}
                    className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                      activeTab === i
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 0 && (
                <OverviewTab data={data} runs={filteredRuns} />
              )}
              {activeTab > 0 && (
                <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                  {TAB_NAMES[activeTab]} — coming in Phase{" "}
                  {activeTab <= 2 ? 2 : activeTab <= 4 ? 3 : activeTab <= 8 ? 4 : 5}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
