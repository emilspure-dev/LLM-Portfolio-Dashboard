const FACTOR_LABEL_FIELDS = {
  size: "size_label",
  value: "value_label",
  momentum: "momentum_label",
  low_risk: "low_risk_label",
  quality: "quality_label",
};

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizePromptType(value) {
  const promptType = normalizeString(value).toLowerCase();
  if (!promptType) {
    return "";
  }
  return promptType === "retail" ? "simple" : promptType;
}

function normalizeStrategyKey(value) {
  const strategyKey = normalizeString(value).toLowerCase().replace(/-/g, "_");
  if (!strategyKey) {
    return "";
  }
  return strategyKey === "gpt_retail" ? "gpt_simple" : strategyKey;
}

function normalizeLabel(value) {
  const label = normalizeString(value);
  return label.length > 0 ? label : null;
}

function mean(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function compareLabels(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}

export function getFactorLabelField(factorKey) {
  return FACTOR_LABEL_FIELDS[factorKey] ?? null;
}

export function getRunKey(row) {
  const runId = normalizeString(row.run_id);
  if (runId) {
    return `run:${runId}`;
  }

  const pathId = normalizeString(row.path_id);
  if (pathId) {
    return `path:${pathId}`;
  }

  const trajectoryId = normalizeString(row.trajectory_id);
  if (trajectoryId) {
    return `trajectory:${trajectoryId}`;
  }

  return [
    normalizeStrategyKey(row.strategy_key) || "unknown-strategy",
    normalizeString(row.market) || "unknown-market",
    normalizePromptType(row.prompt_type) || "unknown-prompt",
    normalizeString(row.model) || "unknown-model",
  ].join("::");
}

export function getSelectionPeriodKey(row) {
  const period = normalizeString(row.period) || "unknown-period";
  const pathId = normalizeString(row.path_id);
  if (pathId) {
    return `path:${pathId}:${period}`;
  }

  const runId = normalizeString(row.run_id);
  if (runId) {
    return `run:${runId}:${period}`;
  }

  const trajectoryId = normalizeString(row.trajectory_id);
  if (trajectoryId) {
    return `trajectory:${trajectoryId}:${period}`;
  }

  return [
    normalizeStrategyKey(row.strategy_key) || "unknown-strategy",
    normalizeString(row.market) || "unknown-market",
    normalizePromptType(row.prompt_type) || "unknown-prompt",
    normalizeString(row.model) || "unknown-model",
    period,
  ].join("::");
}

export function buildFactorSelectionSummary({
  holdingsRows,
  outcomeRows,
  regimeRows,
  factorKey,
}) {
  const factorField = getFactorLabelField(factorKey);
  if (!factorField) {
    throw new Error(`Unsupported factor key: ${factorKey}`);
  }

  const runsByStrategy = new Map();
  const promptDates = new Map();
  const promptPeriods = new Map();

  for (const row of holdingsRows) {
    const label = normalizeLabel(row[factorField]);
    if (!label) {
      continue;
    }

    const strategyKey = normalizeStrategyKey(row.strategy_key);
    const promptType = normalizePromptType(row.prompt_type);
    const runKey = getRunKey(row);
    const profileKey = `${strategyKey}::${promptType}::${runKey}`;
    const profile =
      runsByStrategy.get(profileKey) ??
      {
        strategy_key: strategyKey,
        prompt_type: promptType,
        run_key: runKey,
        counts: new Map(),
        totalSelections: 0,
      };

    profile.counts.set(label, (profile.counts.get(label) ?? 0) + 1);
    profile.totalSelections += 1;
    runsByStrategy.set(profileKey, profile);

    const promptKey = `${strategyKey}::${promptType}`;
    const dateBucket = promptDates.get(promptKey) ?? new Set();
    const periodBucket = promptPeriods.get(promptKey) ?? new Set();
    if (normalizeString(row.date)) {
      dateBucket.add(normalizeString(row.date));
    }
    if (normalizeString(row.period)) {
      periodBucket.add(normalizeString(row.period));
    }
    promptDates.set(promptKey, dateBucket);
    promptPeriods.set(promptKey, periodBucket);
  }

  const promptRuns = new Map();
  const labelUniverse = new Set();
  for (const profile of runsByStrategy.values()) {
    const labels = Array.from(profile.counts.entries()).sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return compareLabels(left[0], right[0]);
    });
    const dominantLabel = labels[0]?.[0] ?? "Other";
    labelUniverse.add(dominantLabel);

    const enrichedProfile = {
      ...profile,
      dominant_label: dominantLabel,
    };

    const promptKey = `${profile.strategy_key}::${profile.prompt_type}`;
    const bucket = promptRuns.get(promptKey) ?? [];
    bucket.push(enrichedProfile);
    promptRuns.set(promptKey, bucket);
  }

  const prompt_summaries = [];
  const aggregateBuckets = new Map();
  const mixBuckets = new Map();

  for (const [promptKey, profiles] of promptRuns.entries()) {
    const [strategyKey, promptType] = promptKey.split("::");
    const dominantCounts = new Map();
    for (const profile of profiles) {
      dominantCounts.set(
        profile.dominant_label,
        (dominantCounts.get(profile.dominant_label) ?? 0) + 1
      );

      const aggregateBucket =
        aggregateBuckets.get(profile.dominant_label) ??
        { label: profile.dominant_label, simple: 0, advanced: 0 };
      if (strategyKey === "gpt_simple") {
        aggregateBucket.simple += 1;
      }
      if (strategyKey === "gpt_advanced") {
        aggregateBucket.advanced += 1;
      }
      aggregateBuckets.set(profile.dominant_label, aggregateBucket);

      for (const [label, count] of profile.counts.entries()) {
        labelUniverse.add(label);
        const share =
          profile.totalSelections > 0 ? count / profile.totalSelections : 0;
        const mixBucket =
          mixBuckets.get(label) ?? { label, simple: [], advanced: [] };
        if (strategyKey === "gpt_simple") {
          mixBucket.simple.push(share);
        }
        if (strategyKey === "gpt_advanced") {
          mixBucket.advanced.push(share);
        }
        mixBuckets.set(label, mixBucket);
      }
    }

    const dominantEntry = Array.from(dominantCounts.entries()).sort(
      (left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return compareLabels(left[0], right[0]);
      }
    )[0];

    prompt_summaries.push({
      strategy_key: strategyKey,
      prompt_type: promptType,
      run_count: profiles.length,
      dominant_label: dominantEntry?.[0] ?? "Other",
      dominant_count: dominantEntry?.[1] ?? 0,
      dominant_share:
        profiles.length > 0 ? (dominantEntry?.[1] ?? 0) / profiles.length : 0,
      date_count: promptDates.get(promptKey)?.size ?? 0,
      period_count: promptPeriods.get(promptKey)?.size ?? 0,
    });
  }

  const labelOrder = Array.from(labelUniverse).sort(compareLabels);
  const aggregate_counts = labelOrder
    .map((label) => aggregateBuckets.get(label))
    .filter(Boolean);

  const run_mix = labelOrder.map((label) => {
    const bucket = mixBuckets.get(label) ?? { label, simple: [], advanced: [] };
    return {
      label,
      simple: mean(bucket.simple) ?? 0,
      advanced: mean(bucket.advanced) ?? 0,
    };
  });

  const dominantByRunKey = new Map();
  for (const profiles of promptRuns.values()) {
    for (const profile of profiles) {
      dominantByRunKey.set(
        `${profile.strategy_key}::${profile.prompt_type}::${profile.run_key}`,
        profile.dominant_label
      );
    }
  }

  const outcomeBuckets = new Map();
  for (const row of outcomeRows) {
    const strategyKey = normalizeStrategyKey(row.strategy_key);
    const promptType = normalizePromptType(row.prompt_type);
    const dominantLabel = dominantByRunKey.get(
      `${strategyKey}::${promptType}::${normalizeString(row.run_key)}`
    );
    if (!dominantLabel) {
      continue;
    }

    const model = normalizeString(row.model) || "unknown";
    const key = `${dominantLabel}::${model}::${promptType}`;
    const bucket =
      outcomeBuckets.get(key) ??
      {
        dominant_label: dominantLabel,
        model,
        prompt_type: promptType,
        sharpeValues: [],
        returnValues: [],
        count: 0,
      };
    if (typeof row.mean_sharpe === "number" && Number.isFinite(row.mean_sharpe)) {
      bucket.sharpeValues.push(row.mean_sharpe);
    }
    if (typeof row.mean_return === "number" && Number.isFinite(row.mean_return)) {
      bucket.returnValues.push(row.mean_return);
    }
    bucket.count += 1;
    outcomeBuckets.set(key, bucket);
  }

  const outcome_linkage = Array.from(outcomeBuckets.values())
    .map((bucket) => ({
      dominant_label: bucket.dominant_label,
      model: bucket.model,
      prompt_type: bucket.prompt_type,
      count: bucket.count,
      mean_sharpe: mean(bucket.sharpeValues),
      mean_return: mean(bucket.returnValues),
    }))
    .sort((left, right) => (right.mean_sharpe ?? -Infinity) - (left.mean_sharpe ?? -Infinity));

  const regime_context = [...regimeRows].sort((left, right) => {
    const leftStart = normalizeString(left.period_start_date) || normalizeString(left.period);
    const rightStart = normalizeString(right.period_start_date) || normalizeString(right.period);
    const byStart = leftStart.localeCompare(rightStart);
    if (byStart !== 0) {
      return byStart;
    }
    return compareLabels(left.market, right.market);
  });

  return {
    factor_key: factorKey,
    prompt_summaries: prompt_summaries.sort((left, right) =>
      compareLabels(left.strategy_key, right.strategy_key)
    ),
    aggregate_counts,
    run_mix,
    outcome_linkage,
    regime_context,
  };
}

export function buildBehaviorHoldingsSummary({
  holdingsRows,
  runRows,
}) {
  const grouped = new Map();
  const totals = new Map();
  for (const row of holdingsRows) {
    const promptType = normalizePromptType(row.prompt_type);
    const sector = normalizeString(row.sector) || "Unknown";
    if (promptType !== "simple" && promptType !== "advanced") {
      continue;
    }
    const key = `${promptType}::${sector}`;
    const bucket = grouped.get(key) ?? { prompt_type: promptType, sector, count: 0 };
    bucket.count += 1;
    totals.set(promptType, (totals.get(promptType) ?? 0) + 1);
    grouped.set(key, bucket);
  }

  const sector_rows = Array.from(grouped.values())
    .map((row) => ({
      ...row,
      share:
        (totals.get(row.prompt_type) ?? 0) > 0
          ? row.count / (totals.get(row.prompt_type) ?? 1)
          : null,
      cap_violation:
        (totals.get(row.prompt_type) ?? 0) > 0
          ? row.count / (totals.get(row.prompt_type) ?? 1) > 0.25
          : false,
    }))
    .sort((left, right) => (right.share ?? 0) - (left.share ?? 0))
    .slice(0, 12);

  const marketRunTotals = new Map();
  for (const row of runRows) {
    const market = normalizeString(row.market);
    if (!market) {
      continue;
    }
    const bucket = marketRunTotals.get(market) ?? new Set();
    bucket.add(getSelectionPeriodKey(row));
    marketRunTotals.set(market, bucket);
  }

  const tickerBuckets = new Map();
  for (const row of holdingsRows) {
    const market = normalizeString(row.market);
    const ticker = normalizeString(row.ticker);
    if (!market || !ticker || !marketRunTotals.has(market)) {
      continue;
    }

    const bucket =
      tickerBuckets.get(ticker) ??
      {
        ticker,
        name: normalizeString(row.name) || ticker,
        selectedByMarket: new Map(),
      };

    const selectedRuns = bucket.selectedByMarket.get(market) ?? new Set();
    selectedRuns.add(getSelectionPeriodKey(row));
    bucket.selectedByMarket.set(market, selectedRuns);
    tickerBuckets.set(ticker, bucket);
  }

  const market_keys = Array.from(marketRunTotals.keys()).sort(compareLabels);
  const asset_frequency_rows = Array.from(tickerBuckets.values())
    .map((bucket) => {
      const cells = market_keys.map((market) => {
        const selectedRunCount = bucket.selectedByMarket.get(market)?.size ?? 0;
        const totalRuns = marketRunTotals.get(market)?.size ?? 0;
        return {
          market,
          selected_run_count: selectedRunCount,
          total_runs: totalRuns,
          selection_rate: totalRuns > 0 ? selectedRunCount / totalRuns : null,
        };
      });

      const totalSelectedRuns = cells.reduce(
        (sum, cell) => sum + cell.selected_run_count,
        0
      );
      const totalRuns = cells.reduce((sum, cell) => sum + cell.total_runs, 0);
      const bestCell = cells.reduce((best, cell) => {
        if (!best) {
          return cell;
        }
        return (cell.selection_rate ?? 0) > (best.selection_rate ?? 0)
          ? cell
          : best;
      }, null);

      return {
        ticker: bucket.ticker,
        name: bucket.name,
        cells,
        total_selected_runs: totalSelectedRuns,
        total_runs: totalRuns,
        weighted_rate: totalRuns > 0 ? totalSelectedRuns / totalRuns : null,
        best_market: bestCell?.market ?? null,
        best_market_rate: bestCell?.selection_rate ?? null,
      };
    })
    .filter((row) => row.total_selected_runs > 0)
    .sort((left, right) => {
      const rateDiff = (right.weighted_rate ?? 0) - (left.weighted_rate ?? 0);
      if (Math.abs(rateDiff) > 1e-9) {
        return rateDiff;
      }
      return right.total_selected_runs - left.total_selected_runs;
    })
    .slice(0, 15);

  return {
    sector_rows,
    market_keys,
    asset_frequency_rows,
  };
}
