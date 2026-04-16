import { Database, BarChart3, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getApiBaseUrl } from "@/lib/api-client";
import type { HealthResponse, MetaCurrentResponse } from "@/lib/api-types";
import type { EvaluationData } from "@/lib/types";

interface DashboardSidebarProps {
  data: EvaluationData | null;
  meta: MetaCurrentResponse | undefined;
  health: HealthResponse | undefined;
  /** True only until /api/health returns — avoids showing "Connecting" while meta/dashboard load */
  apiHealthPending: boolean;
  selectedExperimentId: string | undefined;
  onExperimentChange: (value: string | undefined) => void;
  onRefresh: () => void;
  onReset: () => void;
}

function formatCompletedAt(value: string | null) {
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

export function DashboardSidebar({
  data,
  meta,
  health,
  apiHealthPending,
  selectedExperimentId,
  onExperimentChange,
  onRefresh,
  onReset,
}: DashboardSidebarProps) {
  const runs = data?.runs ?? [];
  const runCount =
    runs.length > 0
      ? runs.length
      : data?.overview_summary?.total_runs ?? 0;
  const markets = data?.filters.markets ?? [];
  const periods = data?.filters.periods ?? [];
  const nPromptTypes = data?.filters.prompt_types.length ?? 0;
  const nModels = data?.filters.models.length ?? 0;
  const resolvedExperimentId =
    selectedExperimentId ?? meta?.latest_experiment_id ?? undefined;

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-white/45 px-4 py-4 lg:w-[280px] lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
      <div className="dashboard-panel-strong rounded-none p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-none bg-[#f5f5f5]">
            <BarChart3 className="h-4 w-4 text-[#0a0a0a]" />
          </div>
          <div>
            <p className="dashboard-label">Research Workspace</p>
            <span className="mt-1 block text-[15px] font-semibold tracking-[-0.03em] text-[#404040]">
              LLM Portfolio
            </span>
          </div>
        </div>
      </div>

      <div className="dashboard-panel rounded-none p-4">
        <p className="dashboard-label mb-3">Data Source</p>
        <div className="dashboard-glass-inset rounded-none px-4 py-3">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-4 w-4 text-[#a3a3a3]" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[#404040]">
                {apiHealthPending
                  ? "Connecting to API"
                  : health?.db_available
                    ? "Connected to read-only API"
                    : health
                      ? "API unavailable"
                      : "Could not reach API"}
              </p>
              <p className="mt-1 break-all text-[12px] leading-5 text-[#737373]">
                {getApiBaseUrl()}
              </p>
              {resolvedExperimentId && (
                <p className="mt-1 text-[12px] text-[#737373]">
                  Active experiment:{" "}
                  <span className="font-medium text-[#404040]">
                    {resolvedExperimentId}
                  </span>
                </p>
              )}
              {health &&
                health.routes?.factor_style !== true &&
                !(
                  (data?.factor_style_rows?.length ?? 0) > 0 && !data?.factor_style_error
                ) && (
                <p className="mt-2 text-[12px] leading-4 text-[#b45309]">
                  Factor Style tab needs API route <span className="font-mono">GET /api/summary/factor-style</span>.
                  This response has no <span className="font-mono">routes.factor_style</span> flag or it is false — on
                  the VPS: <span className="font-mono">git pull</span>, restart the Node API, reload.
                </p>
              )}
              {health?.routes?.holdings === false && (
                <p className="mt-2 text-[12px] leading-4 text-[#b45309]">
                  Holdings snapshots are unavailable because the connected SQLite file does not expose{" "}
                  <span className="font-mono">daily_holdings</span>.
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 h-10 w-full rounded-none border border-white/45 bg-white/50 text-[11px] font-semibold text-[#404040] shadow-sm backdrop-blur-sm hover:bg-white/75 hover:text-[#404040]"
            onClick={onRefresh}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Refresh data
          </Button>
        </div>
      </div>

      {meta && meta.available_experiments.length > 0 && (
        <div className="dashboard-panel rounded-none p-4">
          <p className="dashboard-label mb-3">Experiment</p>
          <select
            value={resolvedExperimentId ?? ""}
            onChange={(event) =>
              onExperimentChange(event.target.value || undefined)
            }
            className="dashboard-glass-inset w-full rounded-none px-3 py-2.5 text-[12px] font-medium text-[#404040] outline-none"
          >
            {meta.available_experiments.map((experiment) => (
              <option
                key={experiment.experiment_id}
                value={experiment.experiment_id}
              >
                {experiment.experiment_id}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[12px] leading-5 text-[#737373]">
            {formatCompletedAt(
              meta.available_experiments.find(
                (experiment) => experiment.experiment_id === resolvedExperimentId
              )?.completed_at ?? meta.latest_completed_at
            )}
          </p>
        </div>
      )}

      {data && (
        <div className="dashboard-panel rounded-none p-4">
          <p className="dashboard-label mb-3">Dataset snapshot</p>
          <div className="space-y-2 text-[12px] text-[#737373]">
            <p>
              <span className="font-semibold text-[#404040]">{runCount}</span> runs
              {data.run_details_loading && runs.length === 0 && (
                <span className="ml-1 text-[#a3a3a3]">(loading details)</span>
              )}
            </p>
            <p>
              <span className="font-semibold text-[#404040]">{markets.length}</span> markets
            </p>
            <p>
              <span className="font-semibold text-[#404040]">{periods.length}</span> periods
              {periods.length > 0 && (
                <span className="ml-1">
                  ({periods[0]} → {periods[periods.length - 1]})
                </span>
              )}
            </p>
            <p>
              <span className="font-semibold text-[#404040]">{nPromptTypes}</span> prompt
              types
            </p>
            <p>
              <span className="font-semibold text-[#404040]">{nModels}</span> models
            </p>
          </div>
        </div>
      )}

      <div className="dashboard-panel rounded-none p-3">
        <Button
          variant="outline"
          size="sm"
          className="h-10 w-full rounded-none border border-white/45 bg-white/50 text-[11px] font-semibold text-[#404040] shadow-sm backdrop-blur-sm hover:bg-white/75 hover:text-[#404040]"
          onClick={onReset}
        >
          <X className="mr-1 h-3 w-3" />
          Reset filters
        </Button>
      </div>

      <div className="dashboard-panel mt-auto rounded-none p-4">
        <p className="dashboard-label mb-3">Research Scope</p>
        <div className="space-y-1.5 text-[12px] leading-relaxed text-[#737373]">
          <p>Markets: S&amp;P 500, DAX 40, Nikkei 225</p>
          <p>Prompts: GPT (Simple), GPT (Advanced)</p>
          <p>Benchmarks: Mean-Variance, Equal Weight, 60/40, Market Index, Fama-French</p>
        </div>
        <p className="mt-3 border-t border-[#ececec] pt-3 text-[10px] leading-4 text-[#d4d4d4]">
          UI build <span className="font-mono text-[#737373]">{__DASHBOARD_BUILD_ID__}</span>
          {" · "}
          Latest tabs include <span className="text-[#737373]">Performance</span>,{" "}
          <span className="text-[#737373]">Factor Style</span>, and <span className="text-[#737373]">Paths</span> after
          Overview. If you do not see them,
          your browser or host is serving an old bundle—hard-refresh, redeploy, or run{" "}
          <code className="rounded bg-[rgba(0,0,0,0.04)] px-1">npm run dev</code> from{" "}
          <code className="rounded bg-[rgba(0,0,0,0.04)] px-1">dashboard/</code>.
        </p>
      </div>
    </aside>
  );
}
