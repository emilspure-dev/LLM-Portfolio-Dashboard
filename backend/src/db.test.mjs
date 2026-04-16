import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openWritableDatabase, tableExistsInDatabase } from "./db.mjs";

test("tableExistsInDatabase detects whether a table is present", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-portfolio-db-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  fs.writeFileSync(dbPath, "");
  const db = openWritableDatabase(dbPath);

  try {
    db.exec(`
      CREATE TABLE daily_holdings (
        path_id TEXT
      );
    `);

    assert.equal(tableExistsInDatabase(db, "daily_holdings"), true);
    assert.equal(tableExistsInDatabase(db, "decision_holdings"), false);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
