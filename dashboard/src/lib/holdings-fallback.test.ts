import { describe, expect, it } from "vitest";

import {
  buildFallbackHoldingSnapshot,
  buildFallbackHoldingsConcentrationRows,
  getLatestFallbackDailyMetrics,
  resolveHoldingsViewMode,
} from "./holdings-fallback";

describe("holdings-fallback", () => {
  it("parses portfolio_json ticker maps and normalizes weights", () => {
    const snapshot = buildFallbackHoldingSnapshot({
      portfolio_json: '{"AAPL": 40, "MSFT": 60}',
      path_id: "path-1",
      run_id: "run-1",
      period: "2024H1",
      market: "us",
      prompt_type: "advanced",
      model: "gpt-4o",
      strategy_key: "gpt_advanced",
      strategy: "GPT Advanced",
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.rows.map((row) => [row.ticker, row.weight])).toEqual([
      ["MSFT", 0.6],
      ["AAPL", 0.4],
    ]);
    expect(snapshot?.hhi).toBeCloseTo(0.52, 6);
    expect(snapshot?.effectiveN).toBeCloseTo(1 / 0.52, 6);
  });

  it("returns null for empty or malformed portfolio_json", () => {
    expect(buildFallbackHoldingSnapshot({ portfolio_json: null })).toBeNull();
    expect(buildFallbackHoldingSnapshot({ portfolio_json: "{not json}" })).toBeNull();
  });

  it("parses python-style object-literal holdings strings", () => {
    const snapshot = buildFallbackHoldingSnapshot({
      portfolio_json: "{'AAPL': 0.55, 'MSFT': 0.45}",
    });

    expect(snapshot?.rows.map((row) => [row.ticker, row.weight])).toEqual([
      ["AAPL", 0.55],
      ["MSFT", 0.45],
    ]);
  });

  it("falls back to alternate holdings fields on the run row", () => {
    const snapshot = buildFallbackHoldingSnapshot({
      portfolio_json: null,
      holdings: '{"NVDA": 75, "META": 25}',
    });

    expect(snapshot?.rows.map((row) => [row.ticker, row.weight])).toEqual([
      ["NVDA", 0.75],
      ["META", 0.25],
    ]);
  });

  it("skips invalid portfolio_json and uses a later valid holdings field", () => {
    const snapshot = buildFallbackHoldingSnapshot({
      portfolio_json: "{not json}",
      holdings: '{"NVDA": 75, "META": 25}',
    });

    expect(snapshot?.rows.map((row) => [row.ticker, row.weight])).toEqual([
      ["NVDA", 0.75],
      ["META", 0.25],
    ]);
  });

  it("aggregates reduced concentration rows across runs", () => {
    const rows = buildFallbackHoldingsConcentrationRows([
      {
        market: "us",
        model: "gpt-4o",
        prompt_type: "retail",
        strategy_key: "gpt_simple",
        portfolio_json: '{"AAPL": 50, "MSFT": 50}',
      },
      {
        market: "us",
        model: "gpt-4o",
        prompt_type: "retail",
        strategy_key: "gpt_simple",
        portfolio_json: '{"NVDA": 70, "META": 30}',
      },
      {
        market: "us",
        model: "benchmark",
        prompt_type: null,
        strategy_key: "index",
        portfolio_json: '{"SPY": 100}',
      },
    ], "us");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      model: "gpt-4o",
      prompt_type: "simple",
      portfolio_count: 2,
    });
    expect(rows[0].mean_hhi).toBeCloseTo(((0.5 ** 2 + 0.5 ** 2) + (0.7 ** 2 + 0.3 ** 2)) / 2, 6);
  });

  it("selects latest fallback daily metrics and parses numeric strings", () => {
    const metrics = getLatestFallbackDailyMetrics([
      {
        date: "2024-01-02",
        experiment_id: "exp",
        path_id: "path",
        source_type: "generated",
        strategy_key: "gpt_simple",
        strategy: "GPT Simple",
        market: "us",
        prompt_type: "simple",
        model: "gpt-4o",
        trajectory_id: null,
        run_id: "run-1",
        period: "2024H1",
        period_start_date: null,
        period_end_date: null,
        asof_cutoff_date: null,
        market_regime_label: null,
        vol_regime_label: null,
        rate_regime_label: null,
        regime_code: null,
        portfolio_value: null,
        daily_return: null,
        running_peak: null,
        drawdown: null,
        drifted_hhi: "0.18" as unknown as number,
        drifted_effective_n_holdings: "5.6" as unknown as number,
        active_holdings: "6" as unknown as number,
        top1_weight: "0.24" as unknown as number,
        top3_weight: "0.55" as unknown as number,
        portfolio_size_exposure: null,
        portfolio_value_exposure: null,
        portfolio_momentum_exposure: null,
        portfolio_low_risk_exposure: null,
        portfolio_quality_exposure: null,
      },
      {
        date: "2024-01-03",
        experiment_id: "exp",
        path_id: "path",
        source_type: "generated",
        strategy_key: "gpt_simple",
        strategy: "GPT Simple",
        market: "us",
        prompt_type: "simple",
        model: "gpt-4o",
        trajectory_id: null,
        run_id: "run-1",
        period: "2024H1",
        period_start_date: null,
        period_end_date: null,
        asof_cutoff_date: null,
        market_regime_label: null,
        vol_regime_label: null,
        rate_regime_label: null,
        regime_code: null,
        portfolio_value: null,
        daily_return: null,
        running_peak: null,
        drawdown: null,
        drifted_hhi: 0.21,
        drifted_effective_n_holdings: 4.8,
        active_holdings: 5,
        top1_weight: 0.28,
        top3_weight: 0.61,
        portfolio_size_exposure: null,
        portfolio_value_exposure: null,
        portfolio_momentum_exposure: null,
        portfolio_low_risk_exposure: null,
        portfolio_quality_exposure: null,
      },
    ]);

    expect(metrics).toEqual({
      date: "2024-01-03",
      activeHoldings: 5,
      driftedHhi: 0.21,
      driftedEffectiveN: 4.8,
      top1Weight: 0.28,
      top3Weight: 0.61,
    });
  });

  it("gates the holdings view between reduced and unavailable modes", () => {
    expect(
      resolveHoldingsViewMode({
        holdingsCapabilityUnavailable: true,
        fallbackSnapshot: buildFallbackHoldingSnapshot({
          portfolio_json: '{"AAPL": 100}',
        }),
      })
    ).toBe("reduced");

    expect(
      resolveHoldingsViewMode({
        holdingsCapabilityUnavailable: true,
        fallbackSnapshot: null,
      })
    ).toBe("unavailable");
  });

  it("prefers explicit weight_pct over raw value fields", () => {
    const snapshot = buildFallbackHoldingSnapshot({
      portfolio_json: JSON.stringify({
        holdings: [
          { ticker: "AAPL", value: 150000, weight_pct: 60 },
          { ticker: "MSFT", value: 50000, weight_pct: 40 },
        ],
      }),
    });

    expect(snapshot?.rows.map((row) => [row.ticker, row.weight])).toEqual([
      ["AAPL", 0.6],
      ["MSFT", 0.4],
    ]);
  });

  it("rejects value-only payloads without an allocation field", () => {
    expect(
      buildFallbackHoldingSnapshot({
        portfolio_json: JSON.stringify({
          holdings: [
            { ticker: "AAPL", value: 150000 },
            { ticker: "MSFT", value: 50000 },
          ],
        }),
      })
    ).toBeNull();
  });
});
