import type {
  FactorExposureRow,
  FiltersResponse,
  HealthResponse,
  HoldingDailyRow,
  MetaCurrentResponse,
  PaginatedResponse,
  PeriodRow,
  PriceRow,
  RegimeRow,
  RunQualityRow,
  RunResultRow,
  StrategyDailyRow,
  StrategySummaryApiRow,
} from "./api-types";

type QueryValue = string | number | boolean | null | undefined;

function normalizeApiRoot(rawBaseUrl: string | undefined): string {
  const trimmed = rawBaseUrl?.trim();
  if (!trimmed) {
    return "http://localhost:3001/api";
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/api")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api`;
}

const API_ROOT = normalizeApiRoot(
  import.meta.env.NEXT_PUBLIC_API_BASE_URL ?? import.meta.env.VITE_API_BASE_URL
);

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${API_ROOT}${normalizedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === "") {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function requestJson<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
  const response = await fetch(buildUrl(path, query), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const payload = await response.json();
      if (typeof payload?.message === "string") {
        message = payload.message;
      }
    } catch {
      // Ignore JSON parsing errors for failed responses.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function getApiBaseUrl() {
  return API_ROOT;
}

export function getHealth() {
  return requestJson<HealthResponse>("/health");
}

export function getMetaCurrent() {
  return requestJson<MetaCurrentResponse>("/meta/current");
}

export function getFilters(query?: Record<string, QueryValue>) {
  return requestJson<FiltersResponse>("/filters", query);
}

export function getStrategySummary(query?: Record<string, QueryValue>) {
  return requestJson<StrategySummaryApiRow[]>("/summary/strategies", query);
}

export function getRunQuality(query?: Record<string, QueryValue>) {
  return requestJson<RunQualityRow[]>("/summary/run-quality", query);
}

export function getEquityChart(query?: Record<string, QueryValue>) {
  return requestJson<StrategyDailyRow[]>("/charts/equity", query);
}

export function getFactorExposureChart(query?: Record<string, QueryValue>) {
  return requestJson<FactorExposureRow[]>("/charts/factor-exposures", query);
}

export function getRegimeChart(query?: Record<string, QueryValue>) {
  return requestJson<RegimeRow[]>("/charts/regimes", query);
}

export function getDailyHoldings(query?: Record<string, QueryValue>) {
  return requestJson<PaginatedResponse<HoldingDailyRow>>("/holdings/daily", query);
}

export function getPrices(query?: Record<string, QueryValue>) {
  return requestJson<PriceRow[]>("/prices", query);
}

export function getRunResults(query?: Record<string, QueryValue>) {
  return requestJson<PaginatedResponse<RunResultRow>>("/run-results", query);
}

export function getPeriods(query?: Record<string, QueryValue>) {
  return requestJson<PeriodRow[]>("/periods", query);
}
