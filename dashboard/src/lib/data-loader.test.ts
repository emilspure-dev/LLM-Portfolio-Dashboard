import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-client", () => ({
  getOverviewSummary: vi.fn(),
  getFilters: vi.fn(),
  getStrategySummary: vi.fn(),
  getBehaviorSummary: vi.fn(),
  getRunQuality: vi.fn(),
  getPeriods: vi.fn(),
  getRunResults: vi.fn(),
  getFactorStyleSummary: vi.fn(),
  getFactorExposureChart: vi.fn(),
}));

import {
  fetchAllRunResults,
  fetchEvaluationData,
} from "./data-loader";
import * as apiClient from "./api-client";

const mockedApi = vi.mocked(apiClient);

describe("data-loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedApi.getOverviewSummary.mockResolvedValue({
      total_runs: 12,
      valid_runs: 10,
      market_count: 3,
      period_count: 4,
      gpt_beat_index_rate: 55,
      mean_gpt_hhi: 0.13,
    });
    mockedApi.getFilters.mockResolvedValue({
      markets: ["us"],
      periods: ["2024H1"],
      strategies: [],
      strategy_keys: [],
      prompt_types: [],
      models: [],
      source_types: [],
      regime_labels: [],
      date_min: null,
      date_max: null,
    });
    mockedApi.getStrategySummary.mockResolvedValue([]);
    mockedApi.getBehaviorSummary.mockResolvedValue([]);
    mockedApi.getRunQuality.mockResolvedValue([]);
    mockedApi.getPeriods.mockResolvedValue([]);
    mockedApi.getFactorStyleSummary.mockResolvedValue([]);
    mockedApi.getFactorExposureChart.mockResolvedValue([]);
  });

  it("loads compact dashboard data without fetching run-result pages", async () => {
    const result = await fetchEvaluationData({
      experimentId: "exp_1",
      meta: {
        latest_experiment_id: "exp_1",
        latest_completed_at: null,
        available_experiments: [],
        available_markets: [],
        available_periods: [],
        available_strategies: [],
        available_prompt_types: [],
        available_models: [],
      },
    });

    expect(mockedApi.getOverviewSummary).toHaveBeenCalledWith({
      experiment_id: "exp_1",
    });
    expect(mockedApi.getRunResults).not.toHaveBeenCalled();
    expect(result.overview_summary?.valid_runs).toBe(10);
    expect(result.runs).toEqual([]);
  });

  it("combines paginated run results into one array", async () => {
    mockedApi.getRunResults
      .mockResolvedValueOnce({
        page: 1,
        page_size: 500,
        total_rows: 3,
        total_pages: 2,
        items: [{ run_id: "run-1" }, { run_id: "run-2" }],
      })
      .mockResolvedValueOnce({
        page: 2,
        page_size: 500,
        total_rows: 3,
        total_pages: 2,
        items: [{ run_id: "run-3" }],
      });

    const rows = await fetchAllRunResults("exp_2");

    expect(mockedApi.getRunResults).toHaveBeenNthCalledWith(1, {
      experiment_id: "exp_2",
      page: 1,
      page_size: 500,
    });
    expect(mockedApi.getRunResults).toHaveBeenNthCalledWith(2, {
      experiment_id: "exp_2",
      page: 2,
      page_size: 500,
    });
    expect(rows).toEqual([
      { run_id: "run-1" },
      { run_id: "run-2" },
      { run_id: "run-3" },
    ]);
  });
});
