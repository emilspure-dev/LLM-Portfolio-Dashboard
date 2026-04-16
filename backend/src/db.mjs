import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SQLITE_DB_PATH } from "./config.mjs";

let database;
let schemaVersionCache;
const tableColumnsCache = new Map();
const tableExistsCache = new Map();

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

  database = openDatabaseAt(SQLITE_DB_PATH, { readOnly: true, queryOnly: true });

  return database;
}

function assertDatabaseExists(databasePath) {
  if (!fs.existsSync(databasePath)) {
    throw new Error(`SQLite database not found at ${databasePath}`);
  }
}

function openDatabaseAt(
  databasePath,
  {
    readOnly = true,
    queryOnly = false,
  } = {}
) {
  assertDatabaseExists(databasePath);
  const db = new DatabaseSync(databasePath, {
    readOnly,
    timeout: 5000,
    allowExtension: false,
  });

  db.exec(`
    ${queryOnly ? "PRAGMA query_only = ON;" : ""}
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);

  return db;
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

export function tableExists(tableName) {
  const normalizedTable = assertSafeIdentifier(tableName);

  if (tableExistsCache.has(normalizedTable)) {
    return tableExistsCache.get(normalizedTable);
  }

  const exists = tableExistsInDatabase(openDatabase(), normalizedTable);

  tableExistsCache.set(normalizedTable, exists);
  return exists;
}

export function openWritableDatabase(databasePath = SQLITE_DB_PATH) {
  return openDatabaseAt(databasePath, { readOnly: false, queryOnly: false });
}

export function openReadOnlyDatabase(databasePath = SQLITE_DB_PATH) {
  return openDatabaseAt(databasePath, { readOnly: true, queryOnly: true });
}

export function getTableColumnsFromDatabase(db, tableName) {
  const normalizedTable = assertSafeIdentifier(tableName);
  const rows = db.prepare(`
    SELECT name
    FROM pragma_table_info('${normalizedTable}')
    ORDER BY cid
  `).all();
  return rowsToValues(rows.map((row) => normalizeRow(row)), "name");
}

export function tableExistsInDatabase(db, tableName) {
  const normalizedTable = assertSafeIdentifier(tableName);
  return Boolean(
    db.prepare(`
      SELECT 1 AS table_exists
      FROM sqlite_master
      WHERE type = 'table'
        AND name = :table_name
      LIMIT 1
    `).get({ table_name: normalizedTable })?.table_exists
  );
}

export function closeDatabase() {
  if (!database) {
    return;
  }

  database.close();
  database = undefined;
  schemaVersionCache = undefined;
  tableColumnsCache.clear();
  tableExistsCache.clear();
}

function rowsToValues(rows, key) {
  return rows.map((row) => row[key]).filter((value) => value != null);
}
