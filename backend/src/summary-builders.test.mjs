import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBehaviorHoldingsSummary,
  buildFactorSelectionSummary,
} from "./summary-builders.mjs";

test("buildFactorSelectionSummary compacts holdings into prompt-level summaries", () => {
  const summary = buildFactorSelectionSummary({
    factorKey: "value",
    holdingsRows: [
      {
        strategy_key: "gpt_retail",
        prompt_type: "retail",
        run_id: "r1",
        path_id: "p1",
        date: "2024-01-01",
        period: "2024H1",
        market: "us",
        value_label: "Value",
      },
      {
        strategy_key: "gpt_retail",
        prompt_type: "retail",
        run_id: "r1",
        path_id: "p1",
        date: "2024-01-02",
        period: "2024H1",
        market: "us",
        value_label: "Value",
      },
      {
        strategy_key: "gpt_advanced",
        prompt_type: "advanced",
        run_id: "a1",
        path_id: "p2",
        date: "2024-01-01",
        period: "2024H1",
        market: "us",
        value_label: "Growth",
      },
      {
        strategy_key: "gpt_advanced",
        prompt_type: "advanced",
        run_id: "a1",
        path_id: "p2",
        date: "2024-01-02",
        period: "2024H1",
        market: "us",
        value_label: "Growth",
      },
    ],
    outcomeRows: [
      {
        strategy_key: "gpt_retail",
        prompt_type: "retail",
        model: "gpt-4o-mini",
        run_key: "run:r1",
        mean_sharpe: 1.2,
        mean_return: 0.08,
      },
      {
        strategy_key: "gpt_advanced",
        prompt_type: "advanced",
        model: "gpt-4o",
        run_key: "run:a1",
        mean_sharpe: 1.5,
        mean_return: 0.1,
      },
    ],
    regimeRows: [
      {
        market: "us",
        period: "2024H1",
        period_start_date: "2024-01-01",
        period_end_date: "2024-06-30",
        market_regime_label: "Bull",
        vol_regime_label: "Low",
        rate_regime_label: "Stable",
      },
    ],
  });

  assert.equal(summary.prompt_summaries.length, 2);
  assert.deepEqual(summary.aggregate_counts, [
    { label: "Growth", retail: 0, advanced: 1 },
    { label: "Value", retail: 1, advanced: 0 },
  ]);
  assert.equal(summary.outcome_linkage[0].dominant_label, "Growth");
  assert.equal(summary.regime_context[0].market_regime_label, "Bull");
});

test("buildBehaviorHoldingsSummary returns compact sector and asset summaries", () => {
  const summary = buildBehaviorHoldingsSummary({
    holdingsRows: [
      {
        prompt_type: "retail",
        sector: "Tech",
        market: "us",
        ticker: "AAPL",
        name: "Apple",
        run_id: "r1",
        path_id: "p1",
        period: "2024H1",
      },
      {
        prompt_type: "retail",
        sector: "Tech",
        market: "us",
        ticker: "AAPL",
        name: "Apple",
        run_id: "r2",
        path_id: "p2",
        period: "2024H1",
      },
      {
        prompt_type: "advanced",
        sector: "Health",
        market: "us",
        ticker: "PFE",
        name: "Pfizer",
        run_id: "a1",
        path_id: "p3",
        period: "2024H1",
      },
    ],
    runRows: [
      {
        market: "us",
        prompt_type: "retail",
        run_id: "r1",
        path_id: "p1",
        period: "2024H1",
      },
      {
        market: "us",
        prompt_type: "retail",
        run_id: "r2",
        path_id: "p2",
        period: "2024H1",
      },
      {
        market: "us",
        prompt_type: "advanced",
        run_id: "a1",
        path_id: "p3",
        period: "2024H1",
      },
    ],
  });

  assert.equal(summary.sector_rows.length, 2);
  assert.equal(summary.asset_frequency_rows[0].ticker, "AAPL");
  assert.equal(summary.asset_frequency_rows[0].cells[0].selection_rate, 2 / 3);
});
