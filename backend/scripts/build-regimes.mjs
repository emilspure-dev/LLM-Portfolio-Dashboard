import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REGIME_DB_PATH,
  REGIME_SNAPSHOT_ID,
  REGIME_VERIFY_FIXTURE_PATH,
} from "../src/config.mjs";
import { fetchRawMarketInputs } from "./regime-data-sources.mjs";
import {
  compareAgainstFixture,
  computeRegimeRows,
  summarizeRegimeRows,
} from "./regime-compute.mjs";
import {
  inspectMarketPeriodsSchema,
  loadSnapshotPeriodRows,
  writeRegimeRows,
} from "./regime-write-sqlite.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FIXTURE_PATH = path.resolve(
  __dirname,
  "../../dashboard/public/data/regime_labels.json"
);

function parseArgs(argv) {
  const parsed = {
    dbPath: REGIME_DB_PATH,
    snapshotId: REGIME_SNAPSHOT_ID || "",
    fixturePath: REGIME_VERIFY_FIXTURE_PATH || DEFAULT_FIXTURE_PATH,
    shouldWrite: false,
    outputPath: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--write") {
      parsed.shouldWrite = true;
    } else if (arg === "--db") {
      parsed.dbPath = argv[index + 1] ?? parsed.dbPath;
      index += 1;
    } else if (arg === "--snapshot-id") {
      parsed.snapshotId = argv[index + 1] ?? parsed.snapshotId;
      index += 1;
    } else if (arg === "--fixture") {
      parsed.fixturePath = argv[index + 1] ?? parsed.fixturePath;
      index += 1;
    } else if (arg === "--out") {
      parsed.outputPath = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`
Usage:
  npm run regime:build -- --snapshot-id <data_snapshot_id> [--db <path>] [--fixture <path>] [--out <json-path>] [--write]

Examples:
  npm run regime:build -- --snapshot-id snapshot_20260407
  npm run regime:build -- --snapshot-id snapshot_20260407 --write --db /tmp/current.sqlite
  `);
}

async function readFixtureRows(fixturePath) {
  const raw = await fs.readFile(fixturePath, "utf8");
  return JSON.parse(raw);
}

async function maybeWriteOutput(outputPath, regimeRows) {
  if (!outputPath) return;
  await fs.writeFile(outputPath, `${JSON.stringify(regimeRows, null, 2)}\n`, "utf8");
}

function validatePeriodRows(periodRows, snapshotId) {
  if (!periodRows.length) {
    throw new Error(`No market_periods rows found for snapshot ${snapshotId}`);
  }

  const missingDates = periodRows.filter(
    (row) => !row.period_start_date || !row.period_end_date
  );
  if (missingDates.length) {
    throw new Error("market_periods rows are missing period boundary dates.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!args.snapshotId) {
    throw new Error("Missing required --snapshot-id (or REGIME_SNAPSHOT_ID env var).");
  }

  const schema = inspectMarketPeriodsSchema(args.dbPath);
  console.log(`market_periods columns: ${schema.columns.join(", ")}`);

  const periodRows = loadSnapshotPeriodRows(args.dbPath, args.snapshotId);
  validatePeriodRows(periodRows, args.snapshotId);
  console.log(`Loaded ${periodRows.length} market_periods rows for snapshot ${args.snapshotId}.`);

  const rawInputs = await fetchRawMarketInputs(periodRows);
  const regimeRows = computeRegimeRows(periodRows, rawInputs);
  console.log(`Computed ${regimeRows.length} regime rows from raw market inputs.`);

  if (args.fixturePath) {
    const fixtureRows = await readFixtureRows(args.fixturePath);
    const parity = compareAgainstFixture(regimeRows, fixtureRows);
    if (parity.mismatches.length) {
      console.error("Parity check failed:");
      for (const mismatch of parity.mismatches) {
        console.error(JSON.stringify(mismatch));
      }
      throw new Error(`Fixture parity failed with ${parity.mismatches.length} mismatches.`);
    }
    console.log(`Parity check passed against ${args.fixturePath}.`);
  }

  await maybeWriteOutput(args.outputPath, regimeRows);
  if (args.outputPath) {
    console.log(`Wrote computed regime rows to ${args.outputPath}.`);
  }

  if (args.shouldWrite) {
    const writeResult = writeRegimeRows(args.dbPath, args.snapshotId, regimeRows);
    console.log(
      `Attempted ${writeResult.attemptedRows} row updates; SQLite reported ${writeResult.changedRows} changed rows. Columns: ${writeResult.updateColumns.join(", ")}`
    );
  } else {
    console.log("Dry run only; no database rows were updated.");
  }

  const summaryRows = summarizeRegimeRows(regimeRows);
  console.log(JSON.stringify(summaryRows, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
