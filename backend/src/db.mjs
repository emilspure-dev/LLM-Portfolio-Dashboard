import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SQLITE_DB_PATH } from "./config.mjs";

let database;

function normalizeRow(row) {
  return row ? Object.fromEntries(Object.entries(row)) : null;
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

export function closeDatabase() {
  if (!database) {
    return;
  }

  database.close();
  database = undefined;
}
