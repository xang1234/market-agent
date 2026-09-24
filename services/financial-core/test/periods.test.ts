import assert from "node:assert/strict";
import test from "node:test";
import { classifyDuration, periodDays, periodsContiguous, periodsIdentical, periodsOverlap, type PeriodIdentity } from "../src/periods.ts";

function duration(start: string, end: string, fiscal_period: PeriodIdentity["fiscal_period"] = "FY", fiscal_year = Number(end.slice(0, 4))): PeriodIdentity {
  return { kind: "duration", start, end, fiscal_year, fiscal_period, calendar_version: "fiscal-calendar.v1" };
}

test("durations count days inclusively from exact dates", () => {
  assert.equal(periodDays(duration("2023-01-01", "2023-12-31")), 365);
  assert.equal(periodDays(duration("2024-01-01", "2024-12-31")), 366);
  assert.equal(periodDays(duration("2023-01-01", "2023-03-31", "Q1")), 90);
  assert.equal(periodDays({ kind: "instant", start: null, end: "2023-12-31", fiscal_year: 2023, fiscal_period: "FY", calendar_version: "v1" }), null);
});

test("52/53-week fiscal years and 13/14-week quarters keep exact period semantics", () => {
  // Apple FY2023: 53 weeks ending 2023-09-30; FY2022: 52 weeks ending 2022-09-24.
  const fy2023 = duration("2022-09-25", "2023-09-30", "FY", 2023);
  const fy2022 = duration("2021-09-26", "2022-09-24", "FY", 2022);
  assert.equal(periodDays(fy2023), 371);
  assert.equal(periodDays(fy2022), 364);
  assert.equal(classifyDuration(fy2023), "annual");
  assert.equal(classifyDuration(fy2022), "annual");
  assert.equal(classifyDuration(duration("2022-09-25", "2022-12-31", "Q1", 2023)), "quarter"); // 14 weeks
  assert.equal(classifyDuration(duration("2023-01-01", "2023-04-01", "Q2", 2023)), "quarter"); // 13 weeks
  assert.equal(classifyDuration(duration("2023-01-01", "2023-06-30", "Q2")), "other"); // year-to-date
  assert.equal(classifyDuration({ ...fy2023, kind: "instant", start: null }), "instant");
});

test("fiscal labels alone never establish period equality", () => {
  const calendar = duration("2023-01-01", "2023-12-31", "FY", 2023);
  const fiscal = duration("2022-10-01", "2023-09-30", "FY", 2023);
  assert.equal(periodsIdentical(calendar, calendar), true);
  assert.equal(periodsIdentical(calendar, fiscal), false);
  assert.equal(periodsIdentical(calendar, { ...calendar, calendar_version: "fiscal-calendar.v2" }), false);
  assert.equal(periodsIdentical(calendar, { ...calendar, fiscal_period: "Q4" }), false);
});

test("overlap and contiguity use exact dates", () => {
  const q1 = duration("2023-01-01", "2023-03-31", "Q1");
  const q2 = duration("2023-04-01", "2023-06-30", "Q2");
  const ytd = duration("2023-01-01", "2023-06-30", "Q2");
  assert.equal(periodsContiguous(q1, q2), true);
  assert.equal(periodsContiguous(q2, q1), false);
  assert.equal(periodsOverlap(q1, q2), false);
  assert.equal(periodsOverlap(ytd, q2), true);
  assert.equal(periodsContiguous(q1, duration("2023-04-02", "2023-06-30", "Q2")), false);
});
