export interface StrategyRow {
  Strategy: string;
  strategy_key: string;
  mean_sharpe: number;
  net_return_mean: number;
  n_observations: number;
  pct_runs_beating_index_sharpe: number;
  pct_runs_beating_sixty_forty_sharpe: number;
}

export interface RunRow {
  [key: string]: any;
  market?: string;
  period?: string;
  prompt_type?: string;
  model?: string;
  sharpe_ratio?: number;
  net_return?: number;
  period_return_net?: number;
  period_return?: number;
  hhi?: number;
  effective_n_holdings?: number;
  n_holdings?: number;
  valid?: boolean;
  trajectory_id?: string;
  run_id?: string;
  turnover?: number;
}

export interface BehaviorRow {
  prompt_type: string;
  mean_hhi: number;
  mean_effective_n_holdings: number;
  mean_turnover: number;
  median_turnover: number;
  mean_expected_portfolio_return_6m: number;
  mean_realized_net_return: number;
  mean_forecast_bias: number;
  mean_forecast_abs_error: number;
}

export interface EvaluationData {
  summary: StrategyRow[];
  runs: RunRow[];
  behavior: BehaviorRow[];
  stats: any[];
  postloss: any[];
  gpt_cells: any[];
  gpt_drawdowns: any[];
  strategy_paths: any[];
  strategy_cells: any[];
  periods_data: any[];
  benchmarks: any[];
  data_quality: any[];
  holdings: any[];
  runs_long: RunRow[];
}

export type InsightType = "pos" | "neg" | "warn" | "info";

export interface Insight {
  type: InsightType;
  title: string;
  body: string;
}
