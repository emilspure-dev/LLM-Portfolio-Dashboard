const DEFAULT_ALLOWED_ORIGINS = "http://localhost:8080";

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export const HOST = process.env.HOST?.trim() || "0.0.0.0";
export const PORT = parseInteger(process.env.PORT, 3001);
export const SQLITE_DB_PATH =
  process.env.SQLITE_DB_PATH?.trim() || "/srv/thesis/db/current.sqlite";
export const REGIME_DB_PATH =
  process.env.REGIME_DB_PATH?.trim() || SQLITE_DB_PATH;
export const REGIME_SNAPSHOT_ID =
  process.env.REGIME_SNAPSHOT_ID?.trim() || "";
export const REGIME_VERIFY_FIXTURE_PATH =
  process.env.REGIME_VERIFY_FIXTURE_PATH?.trim() || "";
export const DEFAULT_PAGE_SIZE = clamp(
  parseInteger(process.env.API_DEFAULT_PAGE_SIZE, 100),
  1,
  500
);
export const MAX_PAGE_SIZE = clamp(
  parseInteger(process.env.API_MAX_PAGE_SIZE, 2000),
  1,
  5000
);

const rawOrigins =
  process.env.DASHBOARD_ALLOWED_ORIGINS?.trim() ||
  process.env.CORS_ALLOWED_ORIGIN?.trim() ||
  DEFAULT_ALLOWED_ORIGINS;

export const DASHBOARD_ALLOWED_ORIGINS = rawOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
