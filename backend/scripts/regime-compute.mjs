import { MARKET_SOURCE_CONFIG } from "./regime-data-sources.mjs";

const MARKET_LABELS = {
  us: "US",
  germany: "DE",
  japan: "JP",
};

const MARKET_ORDER = {
  Bear: 0,
  Flat: 1,
  Bull: 2,
};

const VOL_ORDER = {
  Low: 0,
  Elevated: 1,
  High: 2,
};

const RATE_ORDER = {
  Easing: 0,
  Stable: 1,
  Tightening: 2,
};

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdDev(values) {
  if (values.length < 2) return null;
  const avg = mean(values);
  if (avg == null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function periodDisplayLabel(period) {
  const match = /^(\d{4})H([12])$/i.exec(String(period ?? "").trim());
  if (!match) return String(period ?? "");
  return `H${match[2]} ${match[1]}`;
}

function nearestObservation(rows, targetDate) {
  const targetMs = new Date(`${targetDate}T00:00:00Z`).getTime();
  let bestRow = null;
  let bestDistance = Infinity;

  for (const row of rows) {
    const dateMs = new Date(`${row.date}T00:00:00Z`).getTime();
    const distance = Math.abs(dateMs - targetMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestRow = row;
    }
  }

  return bestRow;
}

function rowsInWindow(rows, startDate, endDate) {
  return rows.filter((row) => row.date >= startDate && row.date <= endDate);
}

function buildRealizedVolSeries(priceRows, window = 21) {
  const ordered = [...priceRows].sort((left, right) => left.date.localeCompare(right.date));
  const logReturns = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1].value;
    const current = ordered[index].value;
    if (!(previous > 0) || !(current > 0)) continue;
    logReturns.push({
      date: ordered[index].date,
      value: Math.log(current / previous),
    });
  }

  const realized = [];
  for (let index = window - 1; index < logReturns.length; index += 1) {
    const slice = logReturns.slice(index - window + 1, index + 1).map((row) => row.value);
    const vol = sampleStdDev(slice);
    if (vol == null) continue;
    realized.push({
      date: logReturns[index].date,
      value: vol * Math.sqrt(252) * 100,
    });
  }

  return realized;
}

function classifyThreeWay(zScore, { low, middle, high }) {
  if (zScore < -0.5) return low;
  if (zScore > 0.5) return high;
  return middle;
}

function formatRegimeCode(label) {
  return String(label).trim().toLowerCase().replace(/\s+/g, "_");
}

function computePeriodMetricRow(periodRow, rawInputs) {
  const market = periodRow.market;
  const marketConfig = MARKET_SOURCE_CONFIG[market];
  if (!marketConfig) {
    throw new Error(`Unsupported market ${market}`);
  }

  const priceRows = rawInputs.pricesByMarket.get(market) ?? [];
  const startPrice = nearestObservation(priceRows, periodRow.period_start_date);
  const endPrice = nearestObservation(priceRows, periodRow.period_end_date);
  if (!startPrice || !endPrice || startPrice.value === 0) {
    throw new Error(`Missing price boundary rows for ${market} ${periodRow.period}`);
  }
  const returnPct = ((endPrice.value / startPrice.value) - 1) * 100;

  let avgVol = null;
  if (marketConfig.volatility.kind === "fred") {
    const volRows = rowsInWindow(
      rawInputs.volatilityByMarket.get(market) ?? [],
      periodRow.period_start_date,
      periodRow.period_end_date
    ).map((row) => row.value);
    avgVol = mean(volRows);
  } else {
    const realizedVolRows = rowsInWindow(
      buildRealizedVolSeries(priceRows),
      periodRow.period_start_date,
      periodRow.period_end_date
    ).map((row) => row.value);
    avgVol = mean(realizedVolRows);
  }
  if (avgVol == null) {
    throw new Error(`Missing volatility data for ${market} ${periodRow.period}`);
  }

  const yieldRows = rawInputs.yieldsByMarket.get(market) ?? [];
  const startYield = nearestObservation(yieldRows, periodRow.period_start_date);
  const endYield = nearestObservation(yieldRows, periodRow.period_end_date);
  if (!startYield || !endYield) {
    throw new Error(`Missing yield boundary rows for ${market} ${periodRow.period}`);
  }
  const yieldChangeBp = (endYield.value - startYield.value) * 100;

  return {
    period: periodRow.period,
    Period: periodDisplayLabel(periodRow.period),
    market,
    Market: MARKET_LABELS[market] ?? market.toUpperCase(),
    period_order: periodRow.period_order,
    period_start_date: periodRow.period_start_date,
    period_end_date: periodRow.period_end_date,
    asof_cutoff_date: periodRow.asof_cutoff_date,
    Return_%: returnPct,
    Avg_Vol: avgVol,
    Yield_Chg_bp: yieldChangeBp,
  };
}

function addLabelsForMetric(rows, metricKey, zKey, labelKey, labels) {
  const values = rows.map((row) => row[metricKey]);
  const avg = mean(values);
  const std = sampleStdDev(values);
  if (avg == null || std == null || std === 0) {
    throw new Error(`Unable to compute z-scores for ${metricKey}`);
  }

  return rows.map((row) => {
    const zScore = (row[metricKey] - avg) / std;
    return {
      ...row,
      [zKey]: zScore,
      [labelKey]: classifyThreeWay(zScore, labels),
    };
  });
}

function addChangedFlags(rows, labelKey, changedKey) {
  let previous = null;
  return rows.map((row) => {
    const changed = previous != null && previous !== row[labelKey] ? 1 : 0;
    previous = row[labelKey];
    return {
      ...row,
      [changedKey]: changed,
    };
  });
}

export function computeRegimeRows(periodRows, rawInputs) {
  const metricRows = periodRows.map((row) => computePeriodMetricRow(row, rawInputs));
  const byMarket = new Map();

  for (const row of metricRows) {
    const bucket = byMarket.get(row.market) ?? [];
    bucket.push(row);
    byMarket.set(row.market, bucket);
  }

  return Array.from(byMarket.values()).flatMap((marketRows) => {
    const ordered = [...marketRows].sort((left, right) => {
      const leftOrder =
        left.period_order != null ? Number(left.period_order) : Number.POSITIVE_INFINITY;
      const rightOrder =
        right.period_order != null ? Number(right.period_order) : Number.POSITIVE_INFINITY;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return String(left.period).localeCompare(String(right.period));
    });
    let classified = addLabelsForMetric(ordered, "Return_%", "Z_Return", "Market_Label", {
      low: "Bear",
      middle: "Flat",
      high: "Bull",
    });
    classified = addLabelsForMetric(classified, "Avg_Vol", "Z_Vol", "Vol_Label", {
      low: "Low",
      middle: "Elevated",
      high: "High",
    });
    classified = addLabelsForMetric(classified, "Yield_Chg_bp", "Z_Rate_bp", "Rate_Label", {
      low: "Easing",
      middle: "Stable",
      high: "Tightening",
    });

    classified = addChangedFlags(classified, "Market_Label", "market_regime_changed");
    classified = addChangedFlags(classified, "Vol_Label", "vol_regime_changed");
    classified = addChangedFlags(classified, "Rate_Label", "rate_regime_changed");

    return classified.map((row) => ({
      ...row,
      market_regime_label: row.Market_Label,
      vol_regime_label: row.Vol_Label,
      rate_regime_label: row.Rate_Label,
      regime_code: [
        formatRegimeCode(row.Market_Label),
        formatRegimeCode(row.Vol_Label),
        formatRegimeCode(row.Rate_Label),
      ].join("__"),
      market_regime_order: MARKET_ORDER[row.Market_Label],
      vol_regime_order: VOL_ORDER[row.Vol_Label],
      rate_regime_order: RATE_ORDER[row.Rate_Label],
      any_regime_changed:
        row.market_regime_changed || row.vol_regime_changed || row.rate_regime_changed ? 1 : 0,
    }));
  });
}

export function summarizeRegimeRows(regimeRows) {
  return regimeRows.map((row) => ({
    Period: row.Period,
    Market: row.Market,
    Market_Label: row.Market_Label,
    Vol_Label: row.Vol_Label,
    Rate_Label: row.Rate_Label,
    period: row.period,
    market: row.market,
  }));
}

export function compareAgainstFixture(regimeRows, fixtureRows) {
  const computedKeys = new Set(regimeRows.map((row) => `${row.market}::${row.period}`));
  const fixtureLookup = new Map(
    fixtureRows.map((row) => [
      `${row.market}::${row.period}`,
      {
        market: row.market,
        period: row.period,
        Market_Label: row.Market_Label,
        Vol_Label: row.Vol_Label,
        Rate_Label: row.Rate_Label,
      },
    ])
  );

  const mismatches = [];
  for (const row of regimeRows) {
    const fixture = fixtureLookup.get(`${row.market}::${row.period}`);
    if (!fixture) {
      mismatches.push({
        market: row.market,
        period: row.period,
        reason: "missing_fixture_row",
      });
      continue;
    }

    for (const key of ["Market_Label", "Vol_Label", "Rate_Label"]) {
      if (row[key] !== fixture[key]) {
        mismatches.push({
          market: row.market,
          period: row.period,
          field: key,
          expected: fixture[key],
          actual: row[key],
        });
      }
    }
  }

  for (const fixture of fixtureRows) {
    const key = `${fixture.market}::${fixture.period}`;
    if (!computedKeys.has(key)) {
      mismatches.push({
        market: fixture.market,
        period: fixture.period,
        reason: "missing_computed_row",
      });
    }
  }

  return {
    compared: regimeRows.length,
    mismatches,
  };
}
