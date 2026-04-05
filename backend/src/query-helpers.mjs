import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./config.mjs";

export function createHttpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

export function cleanString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function cleanBooleanFlag(value) {
  const normalized = cleanString(value);
  if (normalized == null) {
    return null;
  }

  if (normalized === "1" || normalized.toLowerCase() === "true") {
    return 1;
  }

  if (normalized === "0" || normalized.toLowerCase() === "false") {
    return 0;
  }

  throw createHttpError(400, `Invalid boolean flag: ${value}`);
}

export function parsePagination(searchParams) {
  const pageValue = Number.parseInt(searchParams.get("page") ?? "", 10);
  const pageSizeValue = Number.parseInt(searchParams.get("page_size") ?? "", 10);

  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
  const pageSizeBase =
    Number.isFinite(pageSizeValue) && pageSizeValue > 0
      ? pageSizeValue
      : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(pageSizeBase, MAX_PAGE_SIZE);

  return {
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function addEqualsFilter(clauses, params, column, value, paramName = null) {
  if (value == null) {
    return;
  }

  const name = paramName ?? column.replace(/[^a-zA-Z0-9_]/g, "_");
  clauses.push(`${column} = :${name}`);
  params[name] = value;
}

export function addDateRangeFilter(clauses, params, column, dateFrom, dateTo) {
  if (dateFrom != null) {
    clauses.push(`date(${column}) >= date(:date_from)`);
    params.date_from = dateFrom;
  }

  if (dateTo != null) {
    clauses.push(`date(${column}) <= date(:date_to)`);
    params.date_to = dateTo;
  }
}

export function buildWhereClause(clauses) {
  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

export function rowsToValues(rows, key) {
  return rows.map((row) => row[key]).filter((value) => value != null && value !== "");
}
