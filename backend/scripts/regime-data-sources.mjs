const DAY_MS = 24 * 60 * 60 * 1000;

export const MARKET_SOURCE_CONFIG = {
  us: {
    market: "us",
    displayMarket: "US",
    indexSymbol: "^GSPC",
    volatility: { kind: "fred", seriesId: "VIXCLS" },
    yield10y: { kind: "fred", seriesId: "DGS10" },
  },
  germany: {
    market: "germany",
    displayMarket: "DE",
    indexSymbol: "^GDAXI",
    volatility: { kind: "realized" },
    yield10y: { kind: "fred", seriesId: "IRLTLT01DEM156N" },
  },
  japan: {
    market: "japan",
    displayMarket: "JP",
    indexSymbol: "^N225",
    volatility: { kind: "realized" },
    yield10y: { kind: "fred", seriesId: "IRLTLT01JPM156N" },
  },
};

function parseNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function shiftDays(dateString, days) {
  const date = new Date(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function toUnixSeconds(dateString) {
  return Math.floor(new Date(`${dateString}T00:00:00Z`).getTime() / 1000);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "thesis-dashboard-regime-etl/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain,text/csv",
      "User-Agent": "thesis-dashboard-regime-etl/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }
  return response.text();
}

export async function fetchYahooDailyCloses(symbol, startDate, endDate) {
  const period1 = toUnixSeconds(startDate);
  const period2 = toUnixSeconds(shiftDays(endDate, 1));
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false&events=div%2Csplits`;
  const payload = await fetchJson(url);
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length === 0) {
    throw new Error(`No Yahoo Finance chart data returned for ${symbol}`);
  }

  return timestamps
    .map((timestamp, index) => {
      const value = parseNumber(closes[index]);
      if (value == null) return null;
      return {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        value,
      };
    })
    .filter((row) => row != null);
}

export async function fetchFredSeries(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  const csv = await fetchText(url);
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error(`No FRED data returned for ${seriesId}`);
  }

  return lines
    .slice(1)
    .map((line) => {
      const [dateRaw, valueRaw] = line.split(",", 2);
      const value = parseNumber(valueRaw);
      if (!dateRaw || value == null) return null;
      return {
        date: dateRaw.trim(),
        value,
      };
    })
    .filter((row) => row != null);
}

function getRangeBounds(periodRows) {
  const startDates = periodRows.map((row) => row.period_start_date).filter(Boolean);
  const endDates = periodRows.map((row) => row.period_end_date).filter(Boolean);
  if (!startDates.length || !endDates.length) {
    throw new Error("Period rows are missing boundary dates required for regime computation.");
  }
  const minStart = [...startDates].sort()[0];
  const maxEnd = [...endDates].sort().at(-1);
  return {
    startDate: shiftDays(minStart, -45),
    endDate: shiftDays(maxEnd, 5),
  };
}

export async function fetchRawMarketInputs(periodRows) {
  const { startDate, endDate } = getRangeBounds(periodRows);
  const markets = Array.from(new Set(periodRows.map((row) => row.market)));

  const priceEntries = await Promise.all(
    markets.map(async (market) => {
      const config = MARKET_SOURCE_CONFIG[market];
      if (!config) throw new Error(`Unsupported market code: ${market}`);
      const prices = await fetchYahooDailyCloses(config.indexSymbol, startDate, endDate);
      return [market, prices];
    })
  );

  const volatilityEntries = await Promise.all(
    markets
      .filter((market) => MARKET_SOURCE_CONFIG[market].volatility.kind === "fred")
      .map(async (market) => {
        const config = MARKET_SOURCE_CONFIG[market];
        const values = await fetchFredSeries(config.volatility.seriesId);
        return [market, values];
      })
  );

  const yieldEntries = await Promise.all(
    markets.map(async (market) => {
      const config = MARKET_SOURCE_CONFIG[market];
      const yields = await fetchFredSeries(config.yield10y.seriesId);
      return [market, yields];
    })
  );

  return {
    range: { startDate, endDate },
    pricesByMarket: new Map(priceEntries),
    volatilityByMarket: new Map(volatilityEntries),
    yieldsByMarket: new Map(yieldEntries),
  };
}

export { DAY_MS };
