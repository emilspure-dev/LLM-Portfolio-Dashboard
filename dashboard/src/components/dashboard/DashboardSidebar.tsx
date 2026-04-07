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
  const markets = data?.filters.markets ?? [];
  const periods = data?.filters.periods ?? [];
  const nPromptTypes = data?.filters.prompt_types.length ?? 0;
  const nModels = data?.filters.models.length ?? 0;
  const resolvedExperimentId =
    selectedExperimentId ?? meta?.latest_experiment_id ?? undefined;

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-white/45 px-4 py-4 lg:w-[280px] lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
      <div className="dashboard-panel-strong rounded-[20px] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[hsl(198_26%_42%_/_0.12)]">
            <BarChart3 className="h-4 w-4 text-[hsl(198_38%_38%)]" />
          </div>
          <div>
            <p className="dashboard-label">Workspace</p>
            <span className="mt-1 block text-[15px] font-semibold tracking-[-0.03em] text-[#5f5955]">
              LLM Portfolio
            </span>
          </div>
        </div>
      </div>

      <div className="dashboard-panel rounded-[18px] p-4">
        <p className="dashboard-label mb-3">Data Source</p>
        <div className="dashboard-glass-inset rounded-[14px] px-4 py-3">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-4 w-4 text-[#b39a91]" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[#6f6863]">
                {apiHealthPending
                  ? "Connecting to API"
                  : health?.db_available
                    ? "Connected to read-only API"
                    : health
                      ? "API unavailable"
                      : "Could not reach API"}
              </p>
              <p className="mt-1 break-all text-[12px] leading-5 text-[#9d958d]">
                {getApiBaseUrl()}
              </p>
              {resolvedExperimentId && (
                <p className="mt-1 text-[12px] text-[#9d958d]">
                  Active experiment:{" "}
                  <span className="font-medium text-[#6f6863]">
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
                  Factor-style tab needs API route <span className="font-mono">GET /api/summary/factor-style</span>.
                  This response has no <span className="font-mono">routes.factor_style</span> flag or it is false — on
                  the VPS: <span className="font-mono">git pull</span>, restart the Node API, reload.
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 h-10 w-full rounded-full border border-white/45 bg-white/50 text-[11px] font-semibold text-[#5d5754] shadow-sm backdrop-blur-sm hover:bg-white/75 hover:text-[#4a4542]"
            onClick={onRefresh}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Refresh data
          </Button>
        </div>
      </div>

      {meta && meta.available_experiments.length > 0 && (
        <div className="dashboard-panel rounded-[18px] p-4">
          <p className="dashboard-label mb-3">Experiment</p>
          <select
            value={resolvedExperimentId ?? ""}
            onChange={(event) =>
              onExperimentChange(event.target.value || undefined)
            }
            className="dashboard-glass-inset w-full rounded-[14px] px-3 py-2.5 text-[12px] font-medium text-[#5a544f] outline-none"
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
          <p className="mt-2 text-[12px] leading-5 text-[#9d958d]">
            {formatCompletedAt(
              meta.available_experiments.find(
                (experiment) => experiment.experiment_id === resolvedExperimentId
              )?.completed_at ?? meta.latest_completed_at
            )}
          </p>
        </div>
      )}

      {data && (
        <div className="dashboard-panel rounded-[18px] p-4">
          <p className="dashboard-label mb-3">Dataset snapshot</p>
          <div className="space-y-2 text-[12px] text-[#9b938b]">
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
            <p>
              <span className="font-semibold text-[#645e5a]">{nPromptTypes}</span> prompt
              types
            </p>
            <p>
              <span className="font-semibold text-[#645e5a]">{nModels}</span> models
            </p>
          </div>
        </div>
      )}

      <div className="dashboard-panel rounded-[18px] p-3">
        <Button
          variant="outline"
          size="sm"
          className="h-10 w-full rounded-full border border-white/45 bg-white/50 text-[11px] font-semibold text-[#5d5754] shadow-sm backdrop-blur-sm hover:bg-white/75 hover:text-[#4a4542]"
          onClick={onReset}
        >
          <X className="mr-1 h-3 w-3" />
          Reset filters
        </Button>
      </div>

      <div className="dashboard-panel mt-auto rounded-[18px] p-4">
        <p className="dashboard-label mb-3">Thesis scope</p>
        <div className="space-y-1.5 text-[12px] leading-relaxed text-[#9c948c]">
          <p>Markets: S&amp;P 500, DAX 40, Nikkei 225</p>
          <p>Prompts: Retail, Advanced</p>
          <p>Benchmarks: MV, 1/N, 60/40, Index, FF</p>
        </div>
        <p className="mt-3 border-t border-[rgba(232,224,217,0.75)] pt-3 text-[10px] leading-4 text-[#c4bcb4]">
          UI build <span className="font-mono text-[#9a928b]">{__DASHBOARD_BUILD_ID__}</span>
          {" · "}
          Latest tabs include <span className="text-[#9a928b]">Strategies</span> and{" "}
          <span className="text-[#9a928b]">Factor style</span> after Overview. If you do not see them,
          your browser or host is serving an old bundle—hard-refresh, redeploy, or run{" "}
          <code className="rounded bg-[rgba(0,0,0,0.04)] px-1">npm run dev</code> from{" "}
          <code className="rounded bg-[rgba(0,0,0,0.04)] px-1">dashboard/</code>.
        </p>
      </div>
    </aside>
  );
}
