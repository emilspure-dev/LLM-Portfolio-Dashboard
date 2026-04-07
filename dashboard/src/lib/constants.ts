export const COLORS = {
  accent: "#C98D86",
  green: "#9CC7A4",
  red: "#D49790",
  amber: "#D8B692",
  cyan: "#9CBBC8",
  purple: "#C0B5D2",
  pink: "#E1BBC1",
  orange: "#D7A489",
  slate: "#B4ACA4",
} as const;

export const CHART_COLORS = [
  COLORS.accent, COLORS.green, COLORS.amber, COLORS.red,
  COLORS.purple, COLORS.cyan, COLORS.orange, "#818CF8", "#2DD4BF", "#E879F9",
];

export const STRATEGY_COLORS: Record<string, string> = {
  gpt_retail: COLORS.accent,
  gpt_advanced: COLORS.orange,
  mean_variance: COLORS.purple,
  equal_weight: COLORS.cyan,
  sixty_forty: COLORS.slate,
  index: COLORS.amber,
  fama_french: "#818CF8",
  "GPT (Retail prompt)": COLORS.accent,
  "GPT (Advanced Prompting)": COLORS.orange,
  "Mean-variance": COLORS.purple,
  "Equal weight (1/N)": COLORS.cyan,
  "60/40 (market-matched)": COLORS.slate,
  "Market index (buy-and-hold)": COLORS.amber,
  "Fama-French": "#818CF8",
};

export const MARKET_LABELS: Record<string, string> = {
  us: "S&P 500 (US)",
  germany: "DAX 40 (Germany)",
  japan: "Nikkei 225 (Japan)",
};

export const STRATEGY_KEY_MAP: Record<string, string> = {
  "gpt (retail": "gpt_retail",
  "gpt (advanced": "gpt_advanced",
  "mean-variance": "mean_variance",
  "equal weight": "equal_weight",
  "60/40": "sixty_forty",
  "market index": "index",
  "fama-french": "fama_french",
  "fama french": "fama_french",
};

export function getStrategyColor(key: string): string {
  return STRATEGY_COLORS[key] ?? COLORS.slate;
}

export function sharpeColor(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return COLORS.slate;
  if (v > 1.0) return COLORS.green;
  if (v > 0.5) return COLORS.amber;
  return COLORS.red;
}

/** Pills for GPT avg Sharpe vs same-period index — cool/warm split avoids reading as “positive/negative Sharpe”. */
export const INDEX_VS_PILL = {
  beat: {
    backgroundColor: "rgba(156, 187, 200, 0.42)",
    color: "#3a5866",
  },
  miss: {
    backgroundColor: "rgba(218, 198, 176, 0.48)",
    color: "#6b5b48",
  },
} as const;

export function fmt(v: number | null | undefined, d = 1): string {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(d);
}

export function fmtp(v: number | null | undefined, d = 1): string {
  if (v == null || isNaN(v)) return "—";
  return `${v.toFixed(d)}%`;
}
