// The base-rate builder's pure parts: one filer's windows from its companyfacts,
// and the table those windows make.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { baseRateTable, filerWindows, readWindowsCache, writeWindowsCache, type Companyfacts, type Window } from "../src/growth-base-rates.ts";

// A null value removes the concept's year. `period` replaces the calendar year's [start, end]; a null start is an instant.
type Row = Readonly<{ concept: string; unit?: string; year: number; value: number | null; filedIn: number; period?: readonly [string | null, string]; accn?: string }>;

// Each fiscal year is a calendar year; filing `a-Y` is FY Y's 10-K, filed the next February.
function companyfacts(rows: ReadonlyArray<Row>): Companyfacts {
  const usGaap: Record<string, { units: Record<string, unknown[]> }> = {};
  for (const { concept, unit = "USD", year, value, filedIn, period = [`${year}-01-01`, `${year}-12-31`], accn = `a-${filedIn}` } of rows) {
    if (value === null) continue;
    const units = (usGaap[concept] ??= { units: {} }).units;
    const [start, end] = period;
    (units[unit] ??= []).push({ ...(start === null ? {} : { start }), end, val: value, accn, form: "10-K", filed: `${filedIn + 1}-02-15` });
  }
  return { cik: 7, facts: { "us-gaap": usGaap } } as Companyfacts;
}

// FY2015 to FY2020: free cash flow doubles, revenue grows 10% a year, and a 2-for-1 split in 2017 doubles the share count,
// which FY2017's 10-K states for FY2016 too.
function sample(overrides: ReadonlyArray<Row> = []): Companyfacts {
  const rows: Row[] = [];
  for (let year = 2015; year <= 2020; year += 1) {
    const fcf = 1000 * 2 ** ((year - 2015) / 5);
    for (const filedIn of [year, year + 1]) {
      rows.push(
        { concept: "Revenues", year, value: 1_000_000_000 * 1.1 ** (year - 2015), filedIn },
        { concept: "NetCashProvidedByUsedInOperatingActivities", year, value: fcf + 100, filedIn },
        { concept: "PaymentsToAcquirePropertyPlantAndEquipment", year, value: 100, filedIn },
        { concept: "WeightedAverageNumberOfDilutedSharesOutstanding", unit: "shares", year, value: year >= 2017 || filedIn >= 2017 ? 200 : 100, filedIn },
      );
    }
  }
  const replaced = rows.filter((row) => !overrides.some((override) => override.concept === row.concept && override.year === row.year));
  return companyfacts([...replaced, ...overrides]);
}

const result = (windows: ReadonlyArray<Window>, year: number) => windows.find((window) => window.start_year === year)!.results;
const growth = (value: unknown) => (value as { growth: number }).growth;

test("a split between the ends restates the start count through each next 10-K, so per-share growth is free cash flow's", () => {
  const windows = filerWindows(sample(), 2015);
  assert.deepEqual(windows.map((window) => [window.start_year, window.revenue]), [[2015, 1_000_000_000]]);
  const { fcf, fcf_per_share, revenue } = result(windows, 2015);
  assert.ok(Math.abs(growth(fcf) - (2 ** 0.2 - 1)) < 1e-12);
  assert.ok(Math.abs(growth(fcf_per_share) - (2 ** 0.2 - 1)) < 1e-12);
  assert.ok(Math.abs(growth(revenue) - 0.1) < 1e-12);
});

test("a filer whose last 10-K is before year 5 ended early, and its window is an outcome, not dropped", () => {
  const windows = filerWindows(sample(), 2016);
  assert.deepEqual(result(windows, 2016), { revenue: { outcome: "ended_early" }, fcf: { outcome: "ended_early" }, fcf_per_share: { outcome: "ended_early" } });
});

test("a filer whose year-5 10-K lacks the tracked figures reached year 5, so its window is missing_end, not ended_early", () => {
  const missing = { revenue: { outcome: "missing_end" }, fcf: { outcome: "missing_end" }, fcf_per_share: { outcome: "missing_end" } };
  // FY2021's 10-K states only total assets, a balance at the year's end, and no annual period.
  const balanceOnly = sample([{ concept: "Assets", year: 2021, value: 5000, filedIn: 2021, period: [null, "2021-12-31"], accn: "b-2021" }]);
  assert.deepEqual(result(filerWindows(balanceOnly, 2016), 2016), missing);
  // Or only a figure the builder does not track.
  const untracked = sample([{ concept: "NetIncomeLoss", year: 2021, value: 70, filedIn: 2021 }]);
  assert.deepEqual(result(filerWindows(untracked, 2016), 2016), missing);
  // A balance dated after a 10-K's latest annual period is a subsequent event, not a later year.
  const subsequent = sample([{ concept: "Assets", year: 2021, value: 5000, filedIn: 2021, period: [null, "2021-02-10"] }]);
  assert.deepEqual(result(filerWindows(subsequent, 2016), 2016).revenue, { outcome: "ended_early" });
});

test("cash flow and capex covering different periods in one year are mismatched_period, at either end, never subtracted", () => {
  const mismatched = { outcome: "mismatched_period" };
  // FY2020's operating cash flow is for the year to September; its capex is for the calendar year.
  const atEnd = sample([{ concept: "NetCashProvidedByUsedInOperatingActivities", year: 2020, value: 2100, filedIn: 2020, period: ["2019-10-01", "2020-09-30"] }]);
  const end = result(filerWindows(atEnd, 2015), 2015);
  assert.deepEqual([end.fcf, end.fcf_per_share], [mismatched, mismatched]);
  assert.equal(typeof growth(end.revenue), "number", "revenue reads no cash flow");
  const atStart = sample([{ concept: "PaymentsToAcquirePropertyPlantAndEquipment", year: 2015, value: 100, filedIn: 2015, period: ["2014-10-01", "2015-09-30"] }]);
  const start = result(filerWindows(atStart, 2015), 2015);
  assert.deepEqual([start.fcf, start.fcf_per_share], [mismatched, mismatched]);
});

test("the windows cache is read only for the archive it was built from", () => {
  const path = join(mkdtempSync(join(tmpdir(), "growth-windows-")), "windows.json");
  const windows = filerWindows(sample(), 2015);
  writeWindowsCache(path, "a".repeat(64), 1, windows);
  assert.deepEqual(readWindowsCache(path, "a".repeat(64))?.windows, windows);
  assert.equal(readWindowsCache(path, "b".repeat(64)), null, "another archive reads the archive again");
  assert.equal(readWindowsCache(join(path, "..", "absent.json"), "a".repeat(64)), null);
});

test("ends in different capex concepts are incompatible_definition; a missing link in the share chain is missing_shares", () => {
  const productive = sample([
    { concept: "PaymentsToAcquireProductiveAssets", year: 2020, value: 100, filedIn: 2020 },
    { concept: "PaymentsToAcquirePropertyPlantAndEquipment", year: 2020, value: null, filedIn: 2020 },
  ]);
  assert.deepEqual(result(filerWindows(productive, 2015), 2015).fcf, { outcome: "incompatible_definition" });
  // FY2018's 10-K states no FY2017 count, so the start count can't be carried past it.
  const unchained = sample([{ concept: "WeightedAverageNumberOfDilutedSharesOutstanding", unit: "shares", year: 2017, value: 200, filedIn: 2017 }]);
  const { fcf, fcf_per_share } = result(filerWindows(unchained, 2015), 2015);
  assert.equal(typeof growth(fcf), "number");
  assert.deepEqual(fcf_per_share, { outcome: "missing_shares" });
});

test("a zero or negative end is the -100% floor; a non-positive start is non_positive_base", () => {
  const negativeEnd = sample([{ concept: "NetCashProvidedByUsedInOperatingActivities", year: 2020, value: 50, filedIn: 2020 }]);
  assert.deepEqual(result(filerWindows(negativeEnd, 2015), 2015).fcf, { growth: -1, non_positive_end: true });
  const negativeStart = sample([{ concept: "NetCashProvidedByUsedInOperatingActivities", year: 2015, value: 50, filedIn: 2015 }]);
  assert.deepEqual(result(filerWindows(negativeStart, 2015), 2015).fcf_per_share, { outcome: "non_positive_base" });
});

test("starting revenue picks the bucket, an edge belonging to the bucket above, and outcomes are counted beside the points", () => {
  const window = (revenue: number | null, value: number | "ended_early"): Window => ({
    cik: 1, start_year: 2015, revenue,
    results: { fcf_per_share: value === "ended_early" ? { outcome: "ended_early" } : { growth: value, non_positive_end: value === -1 } },
  });
  const table = baseRateTable(
    [window(1_000_000_000, 0.05), window(999_999_999, 0.2), window(1_000_000_000, -1), window(1_000_000_000, "ended_early"), window(null, 0.1)],
    { file: "companyfacts-2026-11-24.zip", date: "2026-11-24", sha256: "0".repeat(64) },
    1,
  );
  const [, below, at] = table.buckets;
  assert.deepEqual([below!.id, at!.id], ["revenue_100M_to_1B", "revenue_1B_to_10B"]);
  assert.deepEqual(below!.metrics.fcf_per_share.points, ["0.2000"]);
  assert.deepEqual(at!.metrics.fcf_per_share, {
    n: 2, points: ["-1.0000", "0.0500"], non_positive_end: 1,
    outcomes: { non_positive_base: 0, ended_early: 1, missing_end: 0, incompatible_definition: 0, mismatched_period: 0, missing_shares: 0 },
  });
  assert.equal(table.unbucketed.fcf_per_share, 1);
});
