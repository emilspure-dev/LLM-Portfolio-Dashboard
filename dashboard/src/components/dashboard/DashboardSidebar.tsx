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
    <aside className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar p-4 flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <span className="text-sm font-bold text-foreground">AI Portfolio Eval</span>
      </div>

      {/* File upload */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">
          Data Source
        </p>
        <label className="flex items-center gap-2 cursor-pointer rounded-md border border-dashed border-border p-3 hover:border-primary transition-colors">
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
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
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
            Market filter
          </p>
          <select
            value={marketFilter}
            onChange={(e) => onMarketFilterChange(e.target.value)}
            className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground"
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
        <div className="text-[10px] text-muted-foreground space-y-0.5 border border-border rounded-md p-3">
          <p>
            <span className="font-semibold text-foreground">{runs.length}</span> runs
          </p>
          <p>
            <span className="font-semibold text-foreground">{markets.length}</span> markets
          </p>
          <p>
            <span className="font-semibold text-foreground">{periods.length}</span> periods
            {periods.length > 0 && (
              <span className="ml-1">
                ({periods[0]} → {periods[periods.length - 1]})
              </span>
            )}
          </p>
          {nTickers > 0 && (
            <p>
              <span className="font-semibold text-foreground">{nTickers}</span> unique tickers
            </p>
          )}
        </div>
      )}

      {data && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={onClear}
        >
          <X className="h-3 w-3 mr-1" />
          Clear data
        </Button>
      )}

      {/* Thesis scope */}
      <div className="mt-auto pt-4 border-t border-sidebar-border">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
          Thesis scope
        </p>
        <div className="text-[10px] text-muted-foreground leading-relaxed space-y-0.5">
          <p>Markets: S&P 500, DAX 40, Nikkei 225</p>
          <p>Prompts: Retail, Advanced</p>
          <p>Benchmarks: MV, 1/N, 60/40, Index, FF</p>
        </div>
      </div>
    </aside>
  );
}
