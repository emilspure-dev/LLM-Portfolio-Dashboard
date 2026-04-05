import * as XLSX from "xlsx";
import type { EvaluationData, StrategyRow, RunRow, BehaviorRow } from "./types";
import { STRATEGY_KEY_MAP } from "./constants";

function sheetToArray(workbook: XLSX.WorkBook, sheetName: string): any[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

function toStrategyKey(name: string): string {
  const lower = name.toLowerCase();
  for (const [pattern, key] of Object.entries(STRATEGY_KEY_MAP)) {
    if (lower.includes(pattern)) return key;
  }
  return "";
}

function pctMaybeFraction(val: number | null): number | null {
  if (val == null || isNaN(val)) return null;
  if (Math.abs(val) <= 1.0) return val * 100;
  return val;
}

function getReturnCol(row: RunRow): number | null {
  return row.net_return ?? row.period_return_net ?? row.period_return ?? null;
}

function parseOverviewSnapshot(workbook: XLSX.WorkBook): StrategyRow[] {
  const raw = XLSX.utils.sheet_to_json<any[]>(
    workbook.Sheets["Overview"] ?? {},
    { header: 1, defval: null }
  );
  if (!raw || raw.length === 0) return [];

  let hdrIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as any[];
    if (!row || !row[0]) continue;
    const v0 = String(row[0]).trim();
    const rowTxt = row.filter((x: any) => x != null).join(" ");
    if (v0 === "Strategy" && rowTxt.includes("Mean Sharpe") && rowTxt.includes("Beat")) {
      hdrIdx = i;
      break;
    }
  }
  if (hdrIdx === -1) return [];

  const hdr = (raw[hdrIdx] as any[]).map((c: any) => (c != null ? String(c).trim() : ""));
  const rows: StrategyRow[] = [];

  for (let j = hdrIdx + 1; j < raw.length; j++) {
    const r = raw[j] as any[];
    if (!r || r[0] == null || String(r[0]).trim() === "") break;

    const findCol = (substr: string) => hdr.findIndex((h) => h.toLowerCase().includes(substr.toLowerCase()));
    const stratCol = findCol("strategy");
    const stratName = String(r[stratCol >= 0 ? stratCol : 0]);

    const msIdx = findCol("mean sharpe");
    const biIdx = findCol("beat market index");
    const b60Idx = findCol("beat 60/40") >= 0 ? findCol("beat 60/40") : findCol("beat sixty");
    const nrIdx = findCol("net return");
    const obsIdx = findCol("observations");

    rows.push({
      Strategy: stratName,
      strategy_key: toStrategyKey(stratName),
      mean_sharpe: msIdx >= 0 ? Number(r[msIdx]) || 0 : 0,
      pct_runs_beating_index_sharpe: biIdx >= 0 ? pctMaybeFraction(Number(r[biIdx])) ?? 0 : 0,
      pct_runs_beating_sixty_forty_sharpe: b60Idx >= 0 ? pctMaybeFraction(Number(r[b60Idx])) ?? 0 : 0,
      net_return_mean: nrIdx >= 0 ? Number(r[nrIdx]) || 0 : 0,
      n_observations: obsIdx >= 0 ? Number(r[obsIdx]) || 0 : 0,
    });
  }
  return rows;
}

function normalizeRuns(rows: RunRow[]): RunRow[] {
  return rows.map((r) => {
    if (r.net_return == null && r.period_return_net != null) {
      r.net_return = r.period_return_net;
    }
    return r;
  });
}

function computeBehavior(runs: RunRow[]): BehaviorRow[] {
  const gptRuns = runs.filter(
    (r) => r.prompt_type === "retail" || r.prompt_type === "advanced"
  );
  const result: BehaviorRow[] = [];

  for (const pt of ["retail", "advanced"] as const) {
    const sub = gptRuns.filter((r) => r.prompt_type === pt);
    if (sub.length === 0) continue;

    const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const median = (arr: number[]) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };

    const hhis = sub.map((r) => r.hhi).filter((v): v is number => v != null && !isNaN(v));
    const effN = sub.map((r) => r.effective_n_holdings).filter((v): v is number => v != null && !isNaN(v));
    const turns = sub.map((r) => r.turnover).filter((v): v is number => v != null && !isNaN(v));
    const rets = sub.map((r) => getReturnCol(r)).filter((v): v is number => v != null && !isNaN(v));

    result.push({
      prompt_type: pt,
      mean_hhi: mean(hhis),
      mean_effective_n_holdings: mean(effN),
      mean_turnover: mean(turns),
      median_turnover: median(turns),
      mean_expected_portfolio_return_6m: 0,
      mean_realized_net_return: mean(rets),
      mean_forecast_bias: 0,
      mean_forecast_abs_error: 0,
    });
  }
  return result;
}

function computeSummaryFromRuns(
  runs: RunRow[],
  existingSummary: StrategyRow[]
): StrategyRow[] {
  if (existingSummary.length > 0) return existingSummary;

  const gptRuns = runs.filter(
    (r) => r.prompt_type === "retail" || r.prompt_type === "advanced"
  );
  const result: StrategyRow[] = [];

  for (const [pt, label, sk] of [
    ["retail", "GPT (Retail prompt)", "gpt_retail"],
    ["advanced", "GPT (Advanced Prompting)", "gpt_advanced"],
  ] as const) {
    const sub = gptRuns.filter((r) => r.prompt_type === pt);
    if (sub.length === 0) continue;

    const sharpes = sub.map((r) => r.sharpe_ratio).filter((v): v is number => v != null);
    const rets = sub.map((r) => getReturnCol(r)).filter((v): v is number => v != null);
    const meanSharpe = sharpes.length ? sharpes.reduce((a, b) => a + b, 0) / sharpes.length : 0;
    const meanRet = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;

    result.push({
      Strategy: label,
      strategy_key: sk,
      mean_sharpe: meanSharpe,
      net_return_mean: meanRet,
      n_observations: sub.length,
      pct_runs_beating_index_sharpe: 0,
      pct_runs_beating_sixty_forty_sharpe: 0,
    });
  }
  return result;
}

export function loadEvaluationData(buffer: ArrayBuffer): EvaluationData {
  const workbook = XLSX.read(buffer, { type: "array" });

  const sheetMap: Record<string, string> = {
    summary: "calc_strategy_summary",
    runs: "Portfolio runs",
    behavior: "Portfolio behavior",
    benchmarks: "Benchmarks",
    stats: "Stats tests",
    postloss: "Post-loss rebalance",
    gpt_cells: "calc_gpt_cells",
    gpt_drawdowns: "calc_gpt_drawdowns",
    strategy_paths: "calc_strategy_paths",
    strategy_cells: "calc_strategy_cells",
    periods_data: "calc_strategy_periods_data",
    data_quality: "Data quality",
    holdings: "Portfolio holdings",
  };

  const data: EvaluationData = {
    summary: [],
    runs: [],
    behavior: [],
    stats: [],
    postloss: [],
    gpt_cells: [],
    gpt_drawdowns: [],
    strategy_paths: [],
    strategy_cells: [],
    periods_data: [],
    benchmarks: [],
    data_quality: [],
    holdings: [],
    runs_long: [],
  };

  // Load sheets
  for (const [key, sheet] of Object.entries(sheetMap)) {
    const rows = sheetToArray(workbook, sheet);
    if (key === "summary") {
      data.summary = rows.map((r) => ({
        ...r,
        strategy_key: toStrategyKey(r.Strategy ?? ""),
      }));
    } else if (key === "runs") {
      data.runs = normalizeRuns(rows);
    } else if (key === "behavior") {
      data.behavior = rows;
    } else {
      (data as any)[key] = rows;
    }
  }

  // Augment from Overview if summary is empty
  if (data.summary.length === 0) {
    const overviewSummary = parseOverviewSnapshot(workbook);
    if (overviewSummary.length > 0) {
      data.summary = overviewSummary;
    }
  }

  // Compute summary from runs if still empty
  if (data.summary.length === 0 && data.runs.length > 0) {
    data.summary = computeSummaryFromRuns(data.runs, data.summary);
  }

  // Compute behavior if empty
  if (data.behavior.length === 0 && data.runs.length > 0) {
    data.behavior = computeBehavior(data.runs);
  }

  return data;
}
