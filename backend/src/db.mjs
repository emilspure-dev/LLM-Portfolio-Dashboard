import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SQLITE_DB_PATH } from "./config.mjs";

let database;
let schemaVersionCache;
const tableColumnsCache = new Map();

function normalizeRow(row) {
  return row ? Object.fromEntries(Object.entries(row)) : null;
}

function assertSafeIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQLite identifier: ${identifier}`);
  }

  return identifier;
}

function openDatabase() {
  if (database) {
    return database;
  }

  if (!fs.existsSync(SQLITE_DB_PATH)) {
    throw new Error(`SQLite database not found at ${SQLITE_DB_PATH}`);
  }

  database = new DatabaseSync(SQLITE_DB_PATH, {
    readOnly: true,
    timeout: 5000,
    allowExtension: false,
  });

  database.exec(`
    PRAGMA query_only = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);

  return database;
}

export function checkDatabase() {
  try {
    const db = openDatabase();
    db.prepare("SELECT 1 AS ok").get();
    return true;
  } catch {
    return false;
  }
}

export function queryAll(sql, params = {}) {
  const rows = openDatabase().prepare(sql).all(params);
  return rows.map((row) => normalizeRow(row));
}

export function queryGet(sql, params = {}) {
  return normalizeRow(openDatabase().prepare(sql).get(params));
}

export function getSchemaVersion() {
  if (schemaVersionCache !== undefined) {
    return schemaVersionCache;
  }

  try {
    schemaVersionCache =
      queryGet(`
        SELECT CAST(schema_version AS INTEGER) AS schema_version
        FROM schema_meta
        LIMIT 1
      `)?.schema_version ?? null;
  } catch {
    schemaVersionCache = null;
  }

  return schemaVersionCache;
}

export function getTableColumns(tableName) {
  const normalizedTable = assertSafeIdentifier(tableName);

  if (tableColumnsCache.has(normalizedTable)) {
    return tableColumnsCache.get(normalizedTable);
  }

  const rows = queryAll(`
    SELECT name
    FROM pragma_table_info('${normalizedTable}')
    ORDER BY cid
  `);
  const columns = rowsToValues(rows, "name");

  tableColumnsCache.set(normalizedTable, columns);
  return columns;
}

export function closeDatabase() {
  if (!database) {
    return;
  }

  database.close();
  database = undefined;
  schemaVersionCache = undefined;
  tableColumnsCache.clear();
}

function rowsToValues(rows, key) {
  return rows.map((row) => row[key]).filter((value) => value != null);
}
