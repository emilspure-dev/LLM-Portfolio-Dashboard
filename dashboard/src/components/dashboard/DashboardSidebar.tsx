import { useCallback } from "react";
import { Upload, BarChart3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MARKET_LABELS } from "@/lib/constants";
import type { EvaluationData, RunRow } from "@/lib/types";

interface DashboardSidebarProps {
  data: EvaluationData | null;
  marketFilter: string;
  onMarketFilterChange: (v: string) => void;
  onFileLoad: (buffer: ArrayBuffer) => void;
  onClear: () => void;
}

export function DashboardSidebar({
  data,
  marketFilter,
  onMarketFilterChange,
  onFileLoad,
  onClear,
}: DashboardSidebarProps) {
  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result instanceof ArrayBuffer) {
          onFileLoad(ev.target.result);
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [onFileLoad]
  );

  const runs = data?.runs ?? [];
  const markets = runs.length
    ? Array.from(new Set(runs.map((r: RunRow) => r.market).filter(Boolean)))
    : [];
  const periods = runs.length
    ? Array.from(new Set(runs.map((r: RunRow) => r.period).filter(Boolean))).sort()
    : [];
  const nTickers =
    data?.runs_long?.length
      ? new Set(data.runs_long.map((r: any) => r.holding_ticker).filter(Boolean)).size
      : 0;

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-white/45 px-4 py-4 lg:w-[280px] lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
      <div className="dashboard-panel-strong rounded-[20px] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[rgba(201,141,134,0.14)]">
            <BarChart3 className="h-4 w-4 text-[#c0837c]" />
          </div>
          <div>
            <p className="dashboard-label">Workspace</p>
            <span className="mt-1 block text-[15px] font-semibold tracking-[-0.03em] text-[#5f5955]">
              AI Portfolio Eval
            </span>
          </div>
        </div>
      </div>

      {/* File upload */}
      <div className="dashboard-panel rounded-[18px] p-4">
        <p className="dashboard-label mb-3">
          Data Source
        </p>
        <label className="flex cursor-pointer items-center gap-3 rounded-[14px] border border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.72)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] transition-colors hover:bg-[rgba(255,255,255,0.9)]">
          <Upload className="h-4 w-4 text-[#b39a91]" />
          <span className="text-[12px] font-medium text-[#8f8780]">
            {data ? "Replace file" : "Upload .xlsx"}
          </span>
          <input
            type="file"
            accept=".xlsx"
            onChange={handleFile}
            className="hidden"
          />
        </label>
      </div>

      {/* Market filter */}
      {data && markets.length > 0 && (
        <div className="dashboard-panel rounded-[18px] p-4">
          <p className="dashboard-label mb-3">
            Market filter
          </p>
          <select
            value={marketFilter}
            onChange={(e) => onMarketFilterChange(e.target.value)}
            className="w-full rounded-[14px] border border-[rgba(232,224,217,0.96)] bg-[rgba(255,255,252,0.72)] px-3 py-2.5 text-[12px] font-medium text-[#6f6863] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] outline-none"
          >
            <option value="All">All</option>
            {markets.sort().map((m) => (
              <option key={m} value={m}>
                {MARKET_LABELS[m as string] ?? m}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Stats badges */}
      {data && (
        <div className="dashboard-panel rounded-[18px] p-4">
          <p className="dashboard-label mb-3">Dataset snapshot</p>
          <div className="space-y-2 text-[11px] text-[#9b938b]">
            <p>
              <span className="font-semibold text-[#645e5a]">{runs.length}</span> runs
            </p>
            <p>
              <span className="font-semibold text-[#645e5a]">{markets.length}</span> markets
            </p>
            <p>
              <span className="font-semibold text-[#645e5a]">{periods.length}</span> periods
              {periods.length > 0 && (
                <span className="ml-1">
                  ({periods[0]} → {periods[periods.length - 1]})
                </span>
              )}
            </p>
            {nTickers > 0 && (
              <p>
                <span className="font-semibold text-[#645e5a]">{nTickers}</span> unique tickers
              </p>
            )}
          </div>
        </div>
      )}

      {data && (
        <div className="dashboard-panel rounded-[18px] p-3">
          <Button
            variant="outline"
            size="sm"
            className="h-10 w-full rounded-full border-[rgba(232,224,217,0.95)] bg-[rgba(255,255,252,0.7)] text-[11px] font-semibold text-[#6e6762] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] hover:bg-white hover:text-[#5d5754]"
            onClick={onClear}
          >
            <X className="mr-1 h-3 w-3" />
            Clear data
          </Button>
        </div>
      )}

      {/* Thesis scope */}
      <div className="dashboard-panel mt-auto rounded-[18px] p-4">
        <p className="dashboard-label mb-3">
          Thesis scope
        </p>
        <div className="space-y-1.5 text-[11px] leading-relaxed text-[#9c948c]">
          <p>Markets: S&amp;P 500, DAX 40, Nikkei 225</p>
          <p>Prompts: Retail, Advanced</p>
          <p>Benchmarks: MV, 1/N, 60/40, Index, FF</p>
        </div>
      </div>
    </aside>
  );
}
