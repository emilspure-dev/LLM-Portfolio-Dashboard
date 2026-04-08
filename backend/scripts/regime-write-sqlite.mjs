import {
  openReadOnlyDatabase,
  openWritableDatabase,
  getTableColumnsFromDatabase,
} from "../src/db.mjs";

const WRITABLE_COLUMNS = [
  "market_regime_label",
  "vol_regime_label",
  "rate_regime_label",
  "regime_code",
  "market_regime_order",
  "vol_regime_order",
  "rate_regime_order",
  "market_regime_changed",
  "vol_regime_changed",
  "rate_regime_changed",
  "any_regime_changed",
];

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row));
}

export function inspectMarketPeriodsSchema(databasePath) {
  const db = openReadOnlyDatabase(databasePath);
  try {
    return {
      columns: getTableColumnsFromDatabase(db, "market_periods"),
      rows: db.prepare(`
        SELECT name, type, "notnull" AS not_null, dflt_value, pk
        FROM pragma_table_info('market_periods')
        ORDER BY cid
      `).all().map((row) => normalizeRow(row)),
    };
  } finally {
    db.close();
  }
}

export function loadSnapshotPeriodRows(databasePath, snapshotId) {
  const db = openReadOnlyDatabase(databasePath);
  try {
    return db.prepare(`
      SELECT
        data_snapshot_id,
        market,
        period,
        period_start_date,
        period_end_date,
        asof_cutoff_date,
        period_order
      FROM market_periods
      WHERE data_snapshot_id = :snapshotId
      ORDER BY market, period_order
    `).all({ snapshotId }).map((row) => normalizeRow(row));
  } finally {
    db.close();
  }
}

export function writeRegimeRows(databasePath, snapshotId, regimeRows) {
  const db = openWritableDatabase(databasePath);
  try {
    const availableColumns = new Set(getTableColumnsFromDatabase(db, "market_periods"));
    const updateColumns = WRITABLE_COLUMNS.filter((column) => availableColumns.has(column));
    if (!updateColumns.length) {
      throw new Error("No writable regime columns found on market_periods.");
    }

    const existingKeys = new Set(
      db.prepare(`
        SELECT market, period
        FROM market_periods
        WHERE data_snapshot_id = :snapshotId
      `).all({ snapshotId }).map((row) => `${row.market}::${row.period}`)
    );

    const assignments = updateColumns.map((column) => `${column} = :${column}`).join(", ");
    const statement = db.prepare(`
      UPDATE market_periods
      SET ${assignments}
      WHERE data_snapshot_id = :data_snapshot_id
        AND market = :market
        AND period = :period
    `);

    db.exec("BEGIN");
    let attemptedRows = 0;
    let changedRows = 0;
    for (const regimeRow of regimeRows) {
      const rowKey = `${regimeRow.market}::${regimeRow.period}`;
      if (!existingKeys.has(rowKey)) {
        throw new Error(`Missing market_periods row for snapshot ${snapshotId}, ${rowKey}`);
      }

      const info = statement.run({
        data_snapshot_id: snapshotId,
        market: regimeRow.market,
        period: regimeRow.period,
        ...Object.fromEntries(updateColumns.map((column) => [column, regimeRow[column]])),
      });
      attemptedRows += 1;
      changedRows += Number(info.changes ?? 0);
    }
    db.exec("COMMIT");

    return {
      attemptedRows,
      changedRows,
      updateColumns,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors after failed begin/commit flows.
    }
    throw error;
  } finally {
    db.close();
  }
}
