// The base-rate lookup a Call reads: the bucket a starting revenue falls in,
// how many of its windows delivered a growth, and its 25th and 50th percentiles.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { growthBaseRate, MIN_BASE_RATE_WINDOWS, parseFinancialDecimal, parseGrowthBaseRates, rationalFromDecimal, roundRational, canonicalDecimalString, type ExactRational, type GrowthBaseRates } from "../src/index.ts";

function exact(text: string): ExactRational {
  const parsed = parseFinancialDecimal(text);
  assert.ok(parsed.ok);
  return rationalFromDecimal(parsed.value)!;
}
const text = (value: ExactRational) => canonicalDecimalString(roundRational(value, 4));

const outcomes = { non_positive_base: 3, ended_early: 4, missing_end: 0, incompatible_definition: 0, mismatched_period: 1, missing_shares: 2 };
const rates = (points: ReadonlyArray<string>) => ({ n: points.length, points, non_positive_end: 1, outcomes });
const bucket = (id: string, min: string, max: string | null, points: ReadonlyArray<string>) => ({
  id, revenue_min: min, revenue_max: max, filers: 9, metrics: { fcf_per_share: rates(points), fcf: rates(points), revenue: rates([]) },
});
// 0.0000, 0.0010, ... : MIN_BASE_RATE_WINDOWS points, a tenth of a point apart.
const ladder = Array.from({ length: MIN_BASE_RATE_WINDOWS }, (_, index) => (index / 1000).toFixed(4));

function table(buckets: ReadonlyArray<ReturnType<typeof bucket>>): GrowthBaseRates {
  const parsed = parseGrowthBaseRates(JSON.stringify({
    version: "growth_base_rates.v1",
    archive: { file: "companyfacts-2026-11-24.zip", date: "2026-11-24", sha256: "a".repeat(64) },
    horizon_years: 5, start_years: { first: 2009, last: 2020 }, filers_read: 1, unbucketed: {}, buckets,
  }));
  assert.ok(parsed);
  return parsed;
}

const TABLE = table([bucket("small", "0", "1000000000", ["-1.0000", ...ladder.slice(1)]), bucket("large", "1000000000", null, ladder)]);

test("a revenue on a bucket's lower edge is in that bucket, one just below is in the one under it", () => {
  const at = growthBaseRate(TABLE, "fcf_per_share", exact("1000000000"), exact("0.05"));
  const below = growthBaseRate(TABLE, "fcf_per_share", exact("999999999.99"), exact("0.05"));
  assert.equal(at.kind === "value" && at.bucket.id, "large");
  assert.equal(below.kind === "value" && below.bucket.id, "small");
});

test("at or above counts a point equal to the growth, the 25th percentile is the point at rank ceil(n / 4) and the median the one at ceil(n / 2)", () => {
  const result = growthBaseRate(TABLE, "fcf_per_share", exact("5000000000"), exact("0.05"));
  assert.equal(result.kind, "value");
  if (result.kind !== "value") return;
  // 0.050 is the 51st of 100 points, so it and the 49 above it: 50.
  assert.deepEqual([result.n, result.at_or_above, text(result.p25), text(result.p50)], [100, 50, "0.024", "0.049"]);
  assert.deepEqual([result.non_positive_end, result.outcomes], [1, outcomes]);
  const between = growthBaseRate(TABLE, "fcf_per_share", exact("5000000000"), exact("0.05001"));
  assert.equal(between.kind === "value" && between.at_or_above, 49);
  const floor = growthBaseRate(TABLE, "fcf_per_share", exact("5"), exact("-2"));
  assert.equal(floor.kind === "value" && floor.at_or_above, 100);
});

test("an empty or thin bucket, or a revenue no bucket holds, declines with the count it had", () => {
  assert.deepEqual(growthBaseRate(TABLE, "revenue", exact("5000000000"), exact("0.05")), { kind: "outcome", outcome: "thin_bucket", bucket: TABLE.buckets[1], n: 0 });
  const thin = table([bucket("only", "0", null, ladder.slice(1))]);
  const result = growthBaseRate(thin, "fcf_per_share", exact("5"), exact("0.05"));
  assert.deepEqual(result.kind === "outcome" && [result.outcome, result.n], ["thin_bucket", MIN_BASE_RATE_WINDOWS - 1]);
  assert.deepEqual(growthBaseRate(TABLE, "fcf_per_share", exact("0"), exact("0.05")), { kind: "outcome", outcome: "no_bucket", bucket: null, n: 0 });
  const above = growthBaseRate(table([bucket("mid", "100", "200", ladder)]), "fcf_per_share", exact("200"), exact("0.05"));
  assert.equal(above.kind === "outcome" && above.outcome, "no_bucket", "an upper edge belongs to the bucket above");
});

test("a table out of order, with a count that is not its points', or with a point past 4 places, does not parse", () => {
  const raw = (buckets: unknown) => JSON.stringify({ version: "growth_base_rates.v1", archive: { file: "f", date: "2026-11-24", sha256: "a".repeat(64) }, horizon_years: 5, start_years: { first: 2009, last: 2020 }, buckets });
  assert.equal(parseGrowthBaseRates(raw([bucket("x", "0", null, ["0.2000", "0.1000"])])), null);
  assert.equal(parseGrowthBaseRates(raw([{ ...bucket("x", "0", null, ladder), metrics: { ...bucket("x", "0", null, ladder).metrics, fcf: { ...rates(ladder), n: 3 } } }])), null);
  // A Call rounds the growth it counts to the stored places, so a point stored past them would be miscounted.
  assert.equal(parseGrowthBaseRates(raw([bucket("x", "0", null, ["0.10001"])])), null);
  assert.ok(parseGrowthBaseRates(raw([bucket("x", "0", null, ["0.1000"])])));
  // Text that is not JSON, such as a truncated file, is not a table either.
  assert.equal(parseGrowthBaseRates(raw([bucket("x", "0", null, ["0.1000"])]).slice(0, -2)), null);
  assert.equal(parseGrowthBaseRates(""), null);
});

test("every committed table parses and is named by its text's sha256, CURRENT names one, and every bucket of it gives free cash flow and per share a base rate", () => {
  const directory = new URL("../data/growth-base-rates/", import.meta.url);
  const names = readdirSync(directory).filter((name) => name.endsWith(".json"));
  for (const name of names) {
    const text = readFileSync(new URL(name, directory), "utf8");
    const table = parseGrowthBaseRates(text);
    assert.ok(table, name);
    assert.equal(name, `${createHash("sha256").update(text).digest("hex")}.json`);
    assert.equal(table.table_sha256, name.slice(0, -5));
  }
  const current = readFileSync(new URL("CURRENT", directory), "utf8").trim();
  assert.ok(names.includes(`${current}.json`));
  const table = parseGrowthBaseRates(readFileSync(new URL(`${current}.json`, directory), "utf8"))!;
  for (const entry of table.buckets) {
    for (const metric of ["fcf", "fcf_per_share"] as const) assert.ok(entry.metrics[metric].points.length >= MIN_BASE_RATE_WINDOWS, `${entry.id} ${metric}`);
  }
});
