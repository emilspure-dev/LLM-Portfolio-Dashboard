import type {
  BehaviorHoldingsSummaryResponse,
  BehaviorSummaryRow,
  CumulativeReturnSummaryRow,
  FactorExposureRow,
  FactorSelectionSummaryResponse,
  FactorStyleSummaryRow,
  FiltersResponse,
  HealthResponse,
  HoldingDailyRow,
  MetaCurrentResponse,
  OverviewSummaryResponse,
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

function isAbsoluteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function normalizeApiRoot(rawBaseUrl: string | undefined): string {
  const trimmed = rawBaseUrl?.trim();
  if (!trimmed) {
    return "/api";
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/api")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api`;
}

const API_ROOT = normalizeApiRoot(
  import.meta.env.NEXT_PUBLIC_API_BASE_URL ?? import.meta.env.VITE_API_BASE_URL
);

function resolveApiRoot() {
  if (isAbsoluteUrl(API_ROOT)) {
    return API_ROOT;
  }

  if (typeof window !== "undefined") {
    const normalizedRoot = API_ROOT.startsWith("/") ? API_ROOT : `/${API_ROOT}`;
    return `${window.location.origin}${normalizedRoot}`;
  }

  return API_ROOT;
}

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${resolveApiRoot()}${normalizedPath}`);

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
  const requestUrl = buildUrl(path, query);
  let response: Response;

  try {
    response = await fetch(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
  } catch {
    throw new Error(
      `Unable to reach API at ${requestUrl}. Start the backend API or set NEXT_PUBLIC_API_BASE_URL.`
    );
  }

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

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    const bodyPreview = await response.text().catch(() => "");
    const normalizedPreview = bodyPreview.trim().slice(0, 120).toLowerCase();

    if (normalizedPreview.startsWith("<!doctype") || normalizedPreview.startsWith("<html")) {
      throw new Error(
        `API at ${requestUrl} returned HTML instead of JSON. Check the deployed /api proxy configuration.`
      );
    }

    throw new Error(`API at ${requestUrl} returned an unexpected response type: ${contentType || "unknown"}.`);
  }

  return (await response.json()) as T;
}

export function getApiBaseUrl() {
  return resolveApiRoot();
}

export interface FactorStyleAnalysisRow {
  strategy_key: string;
  strategy: string;
  prompt_type: string | null;
  market: string;
  path_count: number;
  size: number | null;
  value: number | null;
  momentum: number | null;
  low_risk: number | null;
  quality: number | null;
}

export interface FactorStyleAnalysisRequest {
  experiment_id: string;
  market_scope: string;
  rows: FactorStyleAnalysisRow[];
  /** Shipped from the dashboard so the model shares the same definitions as the UI. */
  glossary?: Record<string, { title: string; summary: string }>;
  factor_definitions?: string;
}

export interface FactorStyleAnalysisResponse {
  analysis: string;
  model: string;
}

export async function postFactorStyleAnalysis(
  body: FactorStyleAnalysisRequest
): Promise<FactorStyleAnalysisResponse> {
  const requestUrl = buildUrl("/ai/factor-style-analysis");
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Unable to reach API at ${requestUrl}. Start the backend API or set NEXT_PUBLIC_API_BASE_URL.`
    );
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = await response.json();
      if (typeof payload?.message === "string") {
        message = payload.message;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`API returned unexpected content type: ${contentType || "unknown"}.`);
  }

  return (await response.json()) as FactorStyleAnalysisResponse;
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

export function getOverviewSummary(query?: Record<string, QueryValue>) {
  return requestJson<OverviewSummaryResponse>("/summary/overview", query);
}

export function getCumulativeReturnSummary(query?: Record<string, QueryValue>) {
  return requestJson<CumulativeReturnSummaryRow[]>("/summary/cumulative-return", query);
}

export function getFactorStyleSummary(query?: Record<string, QueryValue>) {
  return requestJson<FactorStyleSummaryRow[]>("/summary/factor-style", query);
}

export function getBehaviorSummary(query?: Record<string, QueryValue>) {
  return requestJson<BehaviorSummaryRow[]>("/summary/behavior", query);
}

export function getFactorSelectionSummary(query?: Record<string, QueryValue>) {
  return requestJson<FactorSelectionSummaryResponse>("/summary/factor-selections", query);
}

export function getBehaviorHoldingsSummary(query?: Record<string, QueryValue>) {
  return requestJson<BehaviorHoldingsSummaryResponse>("/summary/behavior-holdings", query);
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
