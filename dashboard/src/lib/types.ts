import type {
  BehaviorSummaryRow,
  FactorStyleSummaryRow,
  FiltersResponse,
  MetaCurrentResponse,
  OverviewSummaryResponse,
  PeriodRow,
  RunQualityRow,
  RunResultRow,
  StrategySummaryApiRow,
} from "./api-types";

export interface StrategyRow {
  Strategy: string;
  strategy_key: string;
  source_type: string;
  mean_sharpe: number | null;
  net_return_mean: number | null;
  n_observations: number;
  pct_runs_beating_index_sharpe: number | null;
  pct_runs_beating_sixty_forty_sharpe: number | null;
  mean_annualized_return: number | null;
  mean_volatility: number | null;
  mean_historical_var_95: number | null;
  mean_turnover: number | null;
  markets: string[];
  prompt_types: string[];
}

export interface RunRow extends RunResultRow {
  path_id?: string | number | null;
  market?: string | null;
  period?: string | null;
  prompt_type?: string | null;
  model?: string | null;
  sharpe_ratio?: number | null;
  net_return?: number | null;
  period_return_net?: number | null;
  period_return?: number | null;
  hhi?: number | null;
  effective_n_holdings?: number | null;
  n_holdings?: number | null;
  valid?: boolean | number | null;
  trajectory_id?: string | null;
  run_id?: string | number | null;
  turnover?: number | null;
}

export type BehaviorRow = BehaviorSummaryRow;

export interface EvaluationData {
  meta: MetaCurrentResponse;
  filters: FiltersResponse;
  active_experiment_id: string;
  overview_summary: OverviewSummaryResponse | null;
  summary_rows: StrategySummaryApiRow[];
  summary: StrategyRow[];
  factor_style_rows: FactorStyleSummaryRow[];
  /** Set when GET /summary/factor-style fails (e.g. 404 on older backends). */
  factor_style_error?: string | null;
  /** True when rows were built from GET /charts/factor-exposures because /summary/factor-style was missing. */
  factor_style_from_exposure_fallback?: boolean;
  runs: RunRow[];
  behavior: BehaviorRow[];
  run_quality: RunQualityRow[];
  periods: PeriodRow[];
  stats: unknown[];
  postloss: unknown[];
  gpt_cells: unknown[];
  gpt_drawdowns: unknown[];
  strategy_paths: unknown[];
  strategy_cells: unknown[];
  periods_data: unknown[];
  benchmarks: unknown[];
  data_quality: unknown[];
  holdings: unknown[];
  runs_long: RunRow[];
  run_details_loading?: boolean;
  run_details_error?: string | null;
}

export type InsightType = "pos" | "neg" | "warn" | "info";

export interface Insight {
  type: InsightType;
  title: string;
  body: string;
}
