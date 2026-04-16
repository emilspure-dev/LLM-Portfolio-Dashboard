export interface HealthResponse {
  status: "ok" | "degraded";
  db_available: boolean;
  current_db_path: string;
  /** Present on newer APIs; false means the VPS process is an older build (restart after git pull). */
  routes?: {
    factor_style: boolean;
    /** False when the connected SQLite file does not expose `daily_holdings`. */
    holdings?: boolean;
    /** True when OPENAI_API_KEY is set (POST /api/ai/factor-style-analysis available). */
    ai_factor_style?: boolean;
  };
}

export interface ExperimentOption {
  experiment_id: string;
  completed_at: string | null;
  status: string | null;
}

export interface StrategyOption {
  strategy_key: string;
  strategy: string;
  source_type: string;
  prompt_type: string | null;
}

export interface MetaCurrentResponse {
  latest_experiment_id: string | null;
  latest_completed_at: string | null;
  available_experiments: ExperimentOption[];
  available_markets: string[];
  available_periods: string[];
  available_strategies: StrategyOption[];
  available_prompt_types: string[];
  available_models: string[];
}

export interface FiltersResponse {
  markets: string[];
  periods: string[];
  strategies: string[];
  strategy_keys: string[];
  prompt_types: string[];
  models: string[];
  source_types: string[];
  regime_labels: string[];
  date_min: string | null;
  date_max: string | null;
}

export interface FactorStyleSummaryRow {
  strategy_key: string;
  strategy: string;
  prompt_type: string | null;
  market: string;
  path_count: number;
  mean_size_exposure: number | null;
  mean_value_exposure: number | null;
  mean_momentum_exposure: number | null;
  mean_low_risk_exposure: number | null;
  mean_quality_exposure: number | null;
}

export interface StrategySummaryApiRow {
  experiment_id: string;
  source_type: string;
  strategy_key: string;
  strategy: string;
  market: string;
  prompt_type: string | null;
  observations: number;
  mean_return: number | null;
  mean_annualized_return: number | null;
  mean_volatility: number | null;
  mean_historical_var_95: number | null;
  mean_sharpe: number | null;
  mean_turnover: number | null;
  pct_runs_beating_index_sharpe: number | null;
  pct_runs_beating_sixty_forty_sharpe: number | null;
}

export interface CumulativeReturnSummaryRow {
  date: string;
  strategy_key: string;
  strategy: string | null;
  mean_cumulative_return: number | null;
  path_count: number;
}

export interface OverviewSummaryResponse {
  total_runs: number;
  valid_runs: number;
  market_count: number;
  period_count: number;
  gpt_beat_index_rate: number | null;
  mean_gpt_hhi: number | null;
}

export interface BehaviorSummaryRow {
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

export interface RunQualityRow {
  experiment_id: string;
  market: string;
  period: string;
  prompt_type: string | null;
  model: string | null;
  failure_type: string | null;
  execution_mode: string | null;
  row_count: number;
  valid_rows: number;
  repaired_rows: number;
  avg_repair_attempts: number | null;
}

export interface FactorSelectionPromptSummaryRow {
  strategy_key: string;
  prompt_type: string;
  run_count: number;
  dominant_label: string;
  dominant_count: number;
  dominant_share: number;
  date_count: number;
  period_count: number;
}

export interface FactorSelectionAggregateRow {
  label: string;
  simple: number;
  advanced: number;
}

export interface FactorSelectionMixRow {
  label: string;
  simple: number;
  advanced: number;
}

export interface FactorSelectionOutcomeRow {
  dominant_label: string;
  model: string;
  prompt_type: string;
  count: number;
  mean_sharpe: number | null;
  mean_return: number | null;
}

export interface FactorSelectionRegimeRow {
  market: string;
  period: string;
  period_start_date: string | null;
  period_end_date: string | null;
  market_regime_label: string | null;
  vol_regime_label: string | null;
  rate_regime_label: string | null;
}

export interface FactorSelectionSummaryResponse {
  factor_key: string;
  prompt_summaries: FactorSelectionPromptSummaryRow[];
  aggregate_counts: FactorSelectionAggregateRow[];
  run_mix: FactorSelectionMixRow[];
  outcome_linkage: FactorSelectionOutcomeRow[];
  regime_context: FactorSelectionRegimeRow[];
}

export interface BehaviorSectorRow {
  prompt_type: string;
  sector: string;
  count: number;
  share: number | null;
  cap_violation: boolean;
}

export interface BehaviorAssetSelectionCell {
  market: string;
  selected_run_count: number;
  total_runs: number;
  selection_rate: number | null;
}

export interface BehaviorAssetSelectionRow {
  ticker: string;
  name: string;
  cells: BehaviorAssetSelectionCell[];
  total_selected_runs: number;
  total_runs: number;
  weighted_rate: number | null;
  best_market: string | null;
  best_market_rate: number | null;
}

export interface BehaviorHoldingsSummaryResponse {
  sector_rows: BehaviorSectorRow[];
  market_keys: string[];
  asset_frequency_rows: BehaviorAssetSelectionRow[];
}

export interface HoldingsConcentrationRow {
  model: string;
  prompt_type: string;
  portfolio_count: number;
  mean_hhi: number | null;
  mean_effective_n: number | null;
  mean_weight_gini: number | null;
  mean_top_5_share: number | null;
  mean_top_10_share: number | null;
}

export interface HoldingsConcentrationSummaryResponse {
  rows: HoldingsConcentrationRow[];
}

export interface StrategyDailyRow {
  experiment_id: string;
  path_id: string;
  source_type: string;
  strategy_key: string;
  strategy: string;
  market: string;
  prompt_type: string | null;
  model: string | null;
  trajectory_id: string | null;
  run_id: string | number | null;
  date: string;
  period: string;
  period_start_date: string | null;
  period_end_date: string | null;
  asof_cutoff_date: string | null;
  market_regime_label: string | null;
  vol_regime_label: string | null;
  rate_regime_label: string | null;
  regime_code: string | null;
  portfolio_value: number | null;
  daily_return: number | null;
  running_peak: number | null;
  drawdown: number | null;
  drifted_hhi: number | null;
  drifted_effective_n_holdings: number | null;
  active_holdings: number | null;
  top1_weight: number | null;
  top3_weight: number | null;
  portfolio_size_exposure: number | null;
  portfolio_value_exposure: number | null;
  portfolio_momentum_exposure: number | null;
  portfolio_low_risk_exposure: number | null;
  portfolio_quality_exposure: number | null;
}

export interface FactorExposureRow {
  experiment_id: string;
  path_id: string;
  source_type: string;
  strategy_key: string;
  strategy: string;
  market: string;
  prompt_type: string | null;
  model: string | null;
  trajectory_id: string | null;
  run_id: string | number | null;
  date: string;
  period: string;
  market_regime_label: string | null;
  vol_regime_label: string | null;
  rate_regime_label: string | null;
  regime_code: string | null;
  portfolio_size_exposure: number | null;
  portfolio_value_exposure: number | null;
  portfolio_momentum_exposure: number | null;
  portfolio_low_risk_exposure: number | null;
  portfolio_quality_exposure: number | null;
}

export interface RegimeRow {
  experiment_id: string;
  path_id: string;
  source_type: string;
  strategy_key: string;
  strategy: string;
  market: string;
  prompt_type: string | null;
  model: string | null;
  trajectory_id: string | null;
  run_id: string | number | null;
  date: string;
  period: string;
  period_start_date: string | null;
  period_end_date: string | null;
  asof_cutoff_date: string | null;
  market_regime_label: string | null;
  vol_regime_label: string | null;
  rate_regime_label: string | null;
  regime_code: string | null;
  market_regime_changed: number | null;
  vol_regime_changed: number | null;
  rate_regime_changed: number | null;
  any_regime_changed: number | null;
  portfolio_value: number | null;
  daily_return: number | null;
  drawdown: number | null;
}

export interface HoldingDailyRow {
  experiment_id: string;
  path_id: string;
  source_type: string;
  strategy_key: string;
  strategy: string;
  market: string;
  prompt_type: string | null;
  model: string | null;
  trajectory_id: string | null;
  run_id: string | number | null;
  date: string;
  period: string;
  period_start_date: string | null;
  period_end_date: string | null;
  asof_cutoff_date: string | null;
  market_regime_label: string | null;
  vol_regime_label: string | null;
  rate_regime_label: string | null;
  regime_code: string | null;
  ticker: string;
  name: string | null;
  asset_class: string | null;
  sector: string | null;
  market_cap: number | null;
  pb_ratio: number | null;
  roe: number | null;
  debt_to_equity: number | null;
  trailing_return_6m: number | null;
  trailing_vol_6m: number | null;
  net_margin_proxy: number | null;
  size_rank_pct: number | null;
  value_rank_pct: number | null;
  momentum_rank_pct: number | null;
  low_risk_rank_pct: number | null;
  quality_rank_pct: number | null;
  size_label: string | null;
  value_label: string | null;
  momentum_label: string | null;
  low_risk_label: string | null;
  quality_label: string | null;
  close: number | null;
  start_close: number | null;
  price_relative: number | null;
  target_weight: number | null;
  effective_weight_period_start: number | null;
  drifted_weight: number | null;
  weighted_value: number | null;
  value_contribution_pct: number | null;
}

export interface PriceRow {
  experiment_id: string;
  market: string;
  period: string;
  date: string;
  ticker: string;
  close: number | null;
}

export interface PeriodRow {
  experiment_id: string;
  market: string;
  period: string;
  period_start_date: string;
  period_end_date: string;
  asof_cutoff_date: string;
  period_order: string;
  market_regime_label: string | null;
  vol_regime_label: string | null;
  rate_regime_label: string | null;
  regime_code: string | null;
  market_regime_order: number | null;
  vol_regime_order: number | null;
  rate_regime_order: number | null;
  market_regime_changed: number | null;
  vol_regime_changed: number | null;
  rate_regime_changed: number | null;
  any_regime_changed: number | null;
}

export interface PaginatedResponse<T> {
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
  items: T[];
}

export interface RunResultRow {
  [key: string]: unknown;
  valid?: number | boolean | null;
  period_return?: number | null;
  annualized_return?: number | null;
  volatility?: number | null;
  sharpe_ratio?: number | null;
  n_holdings?: number | null;
  hhi?: number | null;
  effective_n_holdings?: number | null;
  turnover?: number | null;
  expected_portfolio_return_6m?: number | null;
  forecast_bias?: number | null;
  forecast_abs_error?: number | null;
  period?: string | null;
  market?: string | null;
  model?: string | null;
  prompt_type?: string | null;
  prompt_stage?: string | null;
  execution_mode?: string | null;
  run_id?: number | string | null;
  trajectory_id?: string | null;
  experiment_id?: string | null;
  failure_type?: string | null;
  repair_attempts?: number | null;
  repaired?: number | boolean | null;
  strategy_key?: string | null;
  strategy?: string | null;
  market_regime_label?: string | null;
  vol_regime_label?: string | null;
  rate_regime_label?: string | null;
  regime_code?: string | null;
}
