/** What each strategy represents in the factor-style chart (academic / backtest context). */

export const STRATEGY_GLOSSARY: Record<
  string,
  { title: string; summary: string }
> = {
  gpt_simple: {
    title: "GPT (Simple)",
    summary:
      "Large-language-model chooses portfolio weights using a shorter, simple prompt. Each run can differ by model draw and period; exposures shown are averages over paths and trading days. Compare to benchmarks to see whether the LLM tilts systematically toward size, value, momentum, defensive, or quality factors versus simple rules.",
  },
  gpt_advanced: {
    title: "GPT (Advanced)",
    summary:
      "Same LLM setup with a richer prompt (more context and instructions). Use this row to see if additional prompting changes average factor loadings relative to the simple prompt and to deterministic baselines.",
  },
  mean_variance: {
    title: "Mean-Variance",
    summary:
      "Classic Markowitz-style optimization using estimated means and covariances (implementation depends on your pipeline). Typically produces concentrated tilts when estimates are noisy; factor exposures summarize where that optimization lands on average across paths.",
  },
  equal_weight: {
    title: "Equal Weight",
    summary:
      "Holds every eligible asset with the same weight. Often loads somewhat evenly across names; empirical factor exposures still reflect the universe (e.g. large-cap bias if the universe is cap-heavy) and rebalancing frequency.",
  },
  sixty_forty: {
    title: "60/40 (market-matched)",
    summary:
      "Fixed strategic allocation—roughly 60% equity, 40% bonds—matched to the experiment’s market context. Usually shows higher defensive / low-risk loading than pure equity strategies and lower single-stock factor extremes.",
  },
  index: {
    title: "Market Index",
    summary:
      "Capitalization-weighted benchmark proxy for the market. Factor exposures are whatever the cap-weighted portfolio implies in your data (often size tilted to large caps). A natural reference for “passive” exposure in each market.",
  },
  fama_french: {
    title: "Fama-French",
    summary:
      "A factor-model-based reference portfolio from your experiment configuration. Interpret loadings as how closely this construction aligns with the size, value, momentum, low-risk, and quality metrics used in the chart—not as live Fama–French data products.",
  },
};

export const FACTOR_DEFINITIONS_BLURB =
  "Each bar is the mean portfolio exposure to a style proxy over time and paths: size (small vs large), value (cheap vs rich), momentum (recent winners), low risk (defensive tilt), quality (profitable, stable firms). Read the GPT rows first, then use benchmark rows as comparators for what the model is behaving like. These tilts can help explain returns, but they are not a full causal attribution model.";
