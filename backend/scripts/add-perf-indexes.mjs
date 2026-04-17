#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { SQLITE_DB_PATH } from "../src/config.mjs";

const INDEX_DEFINITIONS = [
  {
    name: "idx_llm_run_results_lookup",
    table: "llm_run_results",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_llm_run_results_lookup
      ON llm_run_results (
        experiment_id,
        market,
        period,
        prompt_type,
        model,
        run_id
      )
    `,
  },
  {
    name: "idx_run_results_lookup",
    table: "run_results",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_run_results_lookup
      ON run_results (
        experiment_id,
        market,
        period,
        prompt_type,
        model,
        run_id
      )
    `,
  },
  {
    name: "idx_paths_experiment_path",
    table: "paths",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_paths_experiment_path
      ON paths (experiment_id, path_id)
    `,
  },
  {
    name: "idx_market_periods_lookup",
    table: "market_periods",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_market_periods_lookup
      ON market_periods (data_snapshot_id, market, period)
    `,
  },
  {
    name: "idx_daily_holdings_lookup",
    table: "daily_holdings",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_daily_holdings_lookup
      ON daily_holdings (experiment_id, market, date)
    `,
  },
];

function parseArgs(argv) {
  const parsed = { dbPath: SQLITE_DB_PATH, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--db") {
      parsed.dbPath = argv[i + 1] ?? parsed.dbPath;
      i += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/add-perf-indexes.mjs [--db PATH] [--dry-run]

Adds idempotent indexes that the dashboard API depends on for the run-results,
paths, market_periods, and daily_holdings joins. Safe to run multiple times.
Skips tables that don't exist in the target snapshot.

Options:
  --db PATH    Path to SQLite database (default: $SQLITE_DB_PATH or /srv/thesis/db/current.sqlite)
  --dry-run    Print the indexes that would be created, don't write
  -h, --help   Show this message
`);
}

function tableExists(db, tableName) {
  const row = db
    .prepare(
      `SELECT 1 AS present FROM sqlite_master
       WHERE type = 'table' AND name = :table_name LIMIT 1`
    )
    .get({ table_name: tableName });
  return Boolean(row?.present);
}

function indexExists(db, indexName) {
  const row = db
    .prepare(
      `SELECT 1 AS present FROM sqlite_master
       WHERE type = 'index' AND name = :index_name LIMIT 1`
    )
    .get({ index_name: indexName });
  return Boolean(row?.present);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(args.dbPath)) {
    console.error(`Database not found: ${args.dbPath}`);
    process.exit(1);
  }

  console.log(`Database: ${args.dbPath}`);
  if (args.dryRun) console.log("(dry run — no writes)");

  const db = new DatabaseSync(args.dbPath, {
    readOnly: args.dryRun,
    timeout: 30000,
    allowExtension: false,
  });

  try {
    db.exec("PRAGMA busy_timeout = 30000;");

    const summary = { created: 0, existing: 0, skipped: 0 };

    for (const def of INDEX_DEFINITIONS) {
      if (!tableExists(db, def.table)) {
        console.log(`  SKIP  ${def.name} (table ${def.table} not present)`);
        summary.skipped += 1;
        continue;
      }
      if (indexExists(db, def.name)) {
        console.log(`  KEEP  ${def.name} (already exists)`);
        summary.existing += 1;
        continue;
      }
      if (args.dryRun) {
        console.log(`  PLAN  ${def.name}`);
        summary.created += 1;
        continue;
      }

      const startedAt = Date.now();
      db.exec(def.sql);
      const elapsedMs = Date.now() - startedAt;
      console.log(`  ADD   ${def.name} (${elapsedMs}ms)`);
      summary.created += 1;
    }

    if (!args.dryRun && summary.created > 0) {
      console.log("Running ANALYZE to refresh planner statistics...");
      const startedAt = Date.now();
      db.exec("ANALYZE;");
      console.log(`  done in ${Date.now() - startedAt}ms`);
    }

    console.log(
      `Summary: ${summary.created} created, ${summary.existing} kept, ${summary.skipped} skipped.`
    );
  } finally {
    db.close();
  }
}

main();
