import { describe, expect, it } from "vitest";

import type { RunRow } from "./types";
import {
  REGIMES_FIXED_MODELS,
  buildBehaviouralResponseRows,
  buildExcessReturnHeatmapCells,
  buildIndexReturnLookup,
  computeRunEquityShare,
  regimesDiagnoseEmptyBehavioural,
  regimesDiagnoseEmptyHeatmap,
  regimesRunIdentity,
} from "./regimes-helpers";

const FIXED_MODEL = REGIMES_FIXED_MODELS[0];

function indexRun(overrides: Partial<RunRow>): RunRow {
  return {
    strategy_key: "index",
    market: "us",
    period: "2024H1",
    period_return: 0.05,
    ...overrides,
  } as RunRow;
}

function gptRun(overrides: Partial<RunRow>): RunRow {
  return {
    strategy_key: "gpt_simple",
    market: "us",
    period: "2024H1",
    model: FIXED_MODEL,
    prompt_type: "simple",
    market_regime_label: "Bull",
    vol_regime_label: "Low",
    period_return: 0.08,
    hhi: 0.2,
    ...overrides,
  } as RunRow;
}

describe("regimes-helpers / buildIndexReturnLookup", () => {
  it("averages multiple index runs that share the same (market, period)", () => {
    const lookup = buildIndexReturnLookup([
      indexRun({ period_return: 0.04 }),
      indexRun({ period_return: 0.06 }),
    ]);
    expect(lookup.get("us::2024H1")).toBeCloseTo(0.05, 10);
  });

  it("ignores index runs without a usable period_return", () => {
    const lookup = buildIndexReturnLookup([
      indexRun({ period_return: null }),
      indexRun({ period_return: 0.07 }),
    ]);
    expect(lookup.get("us::2024H1")).toBeCloseTo(0.07, 10);
  });

  it("produces no entry when every index return is missing", () => {
    const lookup = buildIndexReturnLookup([
      indexRun({ period_return: null }),
      indexRun({ period_return: undefined }),
    ]);
    expect(lookup.has("us::2024H1")).toBe(false);
  });

  it("ignores non-index strategies", () => {
    const lookup = buildIndexReturnLookup([
      gptRun({ period_return: 0.99 }),
    ]);
    expect(lookup.size).toBe(0);
  });
});

describe("regimes-helpers / computeRunEquityShare", () => {
  const lookup = new Map<string, string>([
    ["AAPL", "Equity"],
    ["MSFT", "Equity"],
    ["BND", "Bond"],
  ]);

  it("returns the equity share over classified tickers only", () => {
    const share = computeRunEquityShare(
      gptRun({ portfolio_json: '{"AAPL": 30, "MSFT": 30, "BND": 40}' }),
      lookup
    );
    expect(share).toBeCloseTo(60 / 100, 6);
  });

  it("excludes unmapped tickers from both numerator and denominator", () => {
    const share = computeRunEquityShare(
      gptRun({ portfolio_json: '{"AAPL": 50, "UNKNOWN": 50}' }),
      lookup
    );
    expect(share).toBeCloseTo(1, 6);
  });

  it("returns null when no parsed ticker is in the asset-class lookup", () => {
    const share = computeRunEquityShare(
      gptRun({ portfolio_json: '{"FOO": 100}' }),
      lookup
    );
    expect(share).toBeNull();
  });

  it("returns null when the asset-class lookup is empty", () => {
    const share = computeRunEquityShare(
      gptRun({ portfolio_json: '{"AAPL": 100}' }),
      new Map()
    );
    expect(share).toBeNull();
  });

  it("returns null when no holdings can be parsed", () => {
    const share = computeRunEquityShare(gptRun({ portfolio_json: null }), lookup);
    expect(share).toBeNull();
  });

  it("ignores non-positive weights", () => {
    const share = computeRunEquityShare(
      gptRun({ portfolio_json: '{"AAPL": 80, "MSFT": -20, "BND": 20}' }),
      lookup
    );
    expect(share).toBeCloseTo(80 / 100, 6);
  });
});

describe("regimes-helpers / regimesRunIdentity", () => {
  it("prefers run_id when present", () => {
    expect(regimesRunIdentity({ run_id: "r1", path_id: "p1" } as RunRow)).toBe("r1");
  });

  it("falls back through path_id and trajectory_id", () => {
    expect(regimesRunIdentity({ path_id: "p1" } as RunRow)).toBe("p1");
    expect(regimesRunIdentity({ trajectory_id: "t1" } as RunRow)).toBe("t1");
  });

  it("synthesises a tuple key when no id is present", () => {
    expect(
      regimesRunIdentity({
        market: "us",
        period: "2024H1",
        model: "gpt-4",
        prompt_type: "simple",
        strategy_key: "gpt_simple",
      } as RunRow)
    ).toBe("us::2024H1::gpt-4::simple::gpt_simple");
  });
});

describe("regimes-helpers / buildExcessReturnHeatmapCells", () => {
  const indexLookup = new Map([["us::2024H1", 0.05]]);
  const filters = { market: "All", model: "All", prompt: "All" } as const;

  it("computes excess return in percentage points relative to the matched index", () => {
    const cells = buildExcessReturnHeatmapCells(
      [
        gptRun({
          period_return: 0.08,
          market: "us",
          period: "2024H1",
          market_regime_label: "Bull",
          vol_regime_label: "Low",
        }),
      ],
      indexLookup,
      filters
    );
    const overall = cells.find(
      (c) => c.model === FIXED_MODEL && c.prompt === "simple" && c.equity === "Bull" && c.vol === "Overall"
    );
    expect(overall?.meanExcessPp).toBeCloseTo(3, 6);
  });

  it("emits a fixed grid covering all (model, prompt, equity, vol) combinations for known models", () => {
    const cells = buildExcessReturnHeatmapCells([], indexLookup, filters);
    // 3 models x 2 prompts x 3 equity labels x 4 vol buckets (3 + Overall) = 72.
    expect(cells.length).toBe(3 * 2 * 3 * 4);
    expect(cells.every((c) => c.nRuns === 0 && c.meanExcessPp == null)).toBe(true);
  });

  it("does not emit empty cells for unknown models", () => {
    const cells = buildExcessReturnHeatmapCells(
      [
        gptRun({
          model: "future-model",
          period_return: 0.08,
          market_regime_label: "Bull",
          vol_regime_label: "Low",
        }),
      ],
      indexLookup,
      filters
    );
    const futureCells = cells.filter((c) => c.model === "future-model");
    expect(futureCells.length).toBeGreaterThan(0);
    expect(futureCells.every((c) => c.nRuns > 0)).toBe(true);
  });

  it("drops runs whose prompt does not match a non-All prompt filter", () => {
    const cells = buildExcessReturnHeatmapCells(
      [
        gptRun({ prompt_type: "advanced", strategy_key: "gpt_advanced", period_return: 0.20 }),
        gptRun({ prompt_type: "simple", period_return: 0.10 }),
      ],
      indexLookup,
      { market: "All", model: "All", prompt: "simple" }
    );
    const cell = cells.find(
      (c) => c.model === FIXED_MODEL && c.prompt === "simple" && c.equity === "Bull" && c.vol === "Overall"
    );
    const advanced = cells.find(
      (c) => c.model === FIXED_MODEL && c.prompt === "advanced" && c.equity === "Bull" && c.vol === "Overall"
    );
    expect(cell?.nRuns).toBe(1);
    // The advanced cell should still exist in the fixed grid but be empty.
    expect(advanced?.nRuns).toBe(0);
  });
});

describe("regimes-helpers / buildBehaviouralResponseRows", () => {
  const filters = { market: "All", model: "All", prompt: "All" } as const;

  it("summarises equity_share and HHI across runs in a regime cell", () => {
    const runA = gptRun({ run_id: "a", hhi: 0.25 });
    const runB = gptRun({ run_id: "b", hhi: 0.35 });
    const equityShares = new Map<string, number | null>([
      ["a", 0.6],
      ["b", 0.8],
    ]);

    const rows = buildBehaviouralResponseRows([runA, runB], equityShares, filters);
    const equityRow = rows.find(
      (r) =>
        r.model === FIXED_MODEL &&
        r.prompt === "simple" &&
        r.equity === "Bull" &&
        r.feature === "equity_share"
    );
    const hhiRow = rows.find(
      (r) =>
        r.model === FIXED_MODEL &&
        r.prompt === "simple" &&
        r.equity === "Bull" &&
        r.feature === "hhi"
    );
    expect(equityRow?.mean).toBeCloseTo(0.7, 6);
    expect(equityRow?.nRuns).toBe(2);
    expect(hhiRow?.mean).toBeCloseTo(0.3, 6);
    expect(hhiRow?.nRuns).toBe(2);
  });

  it("excludes runs from the other prompt when filtering on a single prompt", () => {
    const runs: RunRow[] = [
      gptRun({ run_id: "s", prompt_type: "simple", hhi: 0.2 }),
      gptRun({
        run_id: "a",
        prompt_type: "advanced",
        strategy_key: "gpt_advanced",
        hhi: 0.6,
      }),
    ];
    const equityShares = new Map<string, number | null>([
      ["s", 0.5],
      ["a", 0.9],
    ]);

    const rows = buildBehaviouralResponseRows(runs, equityShares, {
      market: "All",
      model: "All",
      prompt: "simple",
    });
    const advancedRow = rows.find(
      (r) =>
        r.model === FIXED_MODEL &&
        r.prompt === "advanced" &&
        r.equity === "Bull" &&
        r.feature === "hhi"
    );
    const simpleRow = rows.find(
      (r) =>
        r.model === FIXED_MODEL &&
        r.prompt === "simple" &&
        r.equity === "Bull" &&
        r.feature === "hhi"
    );
    expect(advancedRow?.nRuns).toBe(0);
    expect(simpleRow?.nRuns).toBe(1);
  });
});

describe("regimes-helpers / regimesDiagnoseEmptyHeatmap", () => {
  const indexLookup = new Map([["us::2024H1", 0.05]]);
  const allFilters = { market: "All", model: "All", prompt: "All" } as const;

  it("flags 'no_runs' when the runs array is empty", () => {
    expect(regimesDiagnoseEmptyHeatmap([], indexLookup, allFilters)).toBe("no_runs");
  });

  it("flags 'no_gpt_runs' when only non-GPT strategies are present", () => {
    expect(
      regimesDiagnoseEmptyHeatmap([indexRun({})], indexLookup, allFilters)
    ).toBe("no_gpt_runs");
  });

  it("flags 'no_labels' when GPT runs exist but lack market_regime_label", () => {
    expect(
      regimesDiagnoseEmptyHeatmap(
        [gptRun({ market_regime_label: null })],
        indexLookup,
        allFilters
      )
    ).toBe("no_labels");
  });

  it("flags 'no_index' when GPT runs are well-labelled but no index strategy is paired", () => {
    expect(
      regimesDiagnoseEmptyHeatmap([gptRun({})], new Map(), allFilters)
    ).toBe("no_index");
  });

  it("flags 'filters_too_narrow' when filters drop every otherwise-valid GPT run", () => {
    expect(
      regimesDiagnoseEmptyHeatmap(
        [gptRun({})],
        indexLookup,
        { market: "All", model: "future-model", prompt: "All" }
      )
    ).toBe("filters_too_narrow");
  });
});

describe("regimes-helpers / regimesDiagnoseEmptyBehavioural", () => {
  const allFilters = { market: "All", model: "All", prompt: "All" } as const;

  it("flags 'no_runs' when the runs array is empty", () => {
    expect(regimesDiagnoseEmptyBehavioural([], [], allFilters)).toBe("no_runs");
  });

  it("flags 'no_gpt_runs' when only non-GPT strategies are present", () => {
    expect(
      regimesDiagnoseEmptyBehavioural([indexRun({})], [], allFilters)
    ).toBe("no_gpt_runs");
  });

  it("flags 'no_labels' when GPT runs exist but lack market_regime_label", () => {
    expect(
      regimesDiagnoseEmptyBehavioural(
        [gptRun({ market_regime_label: null })],
        [],
        allFilters
      )
    ).toBe("no_labels");
  });

  it("flags 'no_features' when GPT runs survive filters but no row has a value", () => {
    const runs = [gptRun({ run_id: "a", hhi: null })];
    const rows = buildBehaviouralResponseRows(
      runs,
      new Map<string, number | null>(),
      allFilters
    );
    expect(regimesDiagnoseEmptyBehavioural(runs, rows, allFilters)).toBe("no_features");
  });

  it("flags 'filters_too_narrow' when filters drop every otherwise-valid GPT run", () => {
    expect(
      regimesDiagnoseEmptyBehavioural(
        [gptRun({})],
        [],
        { market: "All", model: "future-model", prompt: "All" }
      )
    ).toBe("filters_too_narrow");
  });
});
