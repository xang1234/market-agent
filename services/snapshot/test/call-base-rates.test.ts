// The base-rate tables a Call's seal can read: every file in the directory,
// each named by the sha256 of its text, and the one CURRENT names.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { loadBaseRateTables } from "../src/call.ts";

const outcomes = { non_positive_base: 0, ended_early: 0, missing_end: 0, incompatible_definition: 0, mismatched_period: 0, missing_shares: 0 };
const rates = (points: ReadonlyArray<string>) => ({ n: points.length, points, non_positive_end: 0, outcomes });
const tableText = (point: string) => `${JSON.stringify({
  version: "growth_base_rates.v1",
  archive: { file: "companyfacts-2026-11-24.zip", date: "2026-11-24", sha256: "a".repeat(64) },
  horizon_years: 5, start_years: { first: 2009, last: 2020 }, filers_read: 1, unbucketed: {},
  buckets: [{ id: "all", revenue_min: "0", revenue_max: null, filers: 1, metrics: { fcf_per_share: rates([point]), fcf: rates([point]), revenue: rates([]) } }],
})}\n`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function directory(files: Readonly<Record<string, string>>): URL {
  const path = mkdtempSync(join(tmpdir(), "growth-base-rates-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(path, name), text);
  return pathToFileURL(`${path}/`);
}

test("every table loads by its sha256, and a new Call reads the one CURRENT names", () => {
  const [first, second] = [tableText("0.0100"), tableText("0.0200")];
  const tables = loadBaseRateTables(directory({ [`${sha(first)}.json`]: first, [`${sha(second)}.json`]: second, CURRENT: `${sha(second)}\n` }));
  assert.deepEqual([...tables.bySha.keys()].sort(), [sha(first), sha(second)].sort());
  assert.equal(tables.current.table_sha256, sha(second));
  assert.equal(tables.bySha.get(sha(first))!.table_sha256, sha(first), "the earlier table stays readable after another is added");
});

test("a table not named by its sha256, or a CURRENT naming none, fails at load", () => {
  const text = tableText("0.0100");
  assert.throws(() => loadBaseRateTables(directory({ [`${"0".repeat(64)}.json`]: text, CURRENT: "0".repeat(64) })), /is not a growth_base_rates\.v1 table named by its sha256/u);
  assert.throws(() => loadBaseRateTables(directory({ [`${sha(text)}.json`]: text, CURRENT: "1".repeat(64) })), /CURRENT names no table there/u);
});
