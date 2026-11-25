import assert from "node:assert/strict";
import test from "node:test";
import { classifyDuration, endsQuartersApart, endsStepsApart, periodDays, periodsContiguous, periodsIdentical, periodsOverlap, type PeriodIdentity } from "../src/periods.ts";

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

test("a prior period is found by its end date, so a fiscal-year-end change is not a year back", () => {
  // A year that follows a normal one, and Apple's 53-week FY2023 after its 52-week FY2022.
  assert.equal(endsStepsApart("2024-12-31", "2023-12-31", 12), true);
  assert.equal(endsStepsApart("2023-09-30", "2022-09-24", 12), true);
  // NVIDIA's 53-week FY2021 (ended 2021-01-31) after FY2020 (ended 2020-01-26).
  assert.equal(endsStepsApart("2021-01-31", "2020-01-26", 12), true);
  // Apple's 14-week Q1 FY2023 after Q4 FY2022: seven days off three calendar months.
  assert.equal(endsStepsApart("2022-12-31", "2022-09-24", 3), true);
  // Year end moved from June to December: FY2023 and FY2024 end 18 months apart.
  assert.equal(endsStepsApart("2024-12-31", "2023-06-30", 12), false);
  // #479: Q4 FY2025 and Q1 FY2026 end nine months apart.
  assert.equal(endsStepsApart("2025-10-26", "2025-01-26", 3), false);
  assert.equal(endsStepsApart("2023-12-31", "2024-12-31", 12), false);
  // A step count that is not a positive whole number never pairs.
  assert.equal(endsStepsApart("2023-12-31", "2024-12-31", -12), false);
  assert.equal(endsStepsApart("2024-12-31", "2025-01-05", 0), false);
  // Month ends step to month ends: Oracle-style quarters ending May 31 and Feb 28.
  assert.equal(endsStepsApart("2023-05-31", "2023-02-15", 3), true);
  assert.equal(endsStepsApart("2023-05-31", "2023-03-17", 3), false);
  // Feb 28, 2025 steps a year back to Feb 29, 2024: 14 days before that pairs, 15 does not.
  assert.equal(endsStepsApart("2025-02-28", "2024-02-15", 12), true);
  assert.equal(endsStepsApart("2025-02-28", "2024-02-14", 12), false);
});

test("a prior quarter is found by its end date, 16- and 17-week retail quarters included", () => {
  // Costco's 16-week Q4 FY2024 and 17-week Q4 FY2023, and Kroger's 16-week Q1, end 20 to 27 days off three calendar months.
  assert.equal(endsStepsApart("2024-09-01", "2024-05-12", 3), false);
  assert.equal(endsQuartersApart("2025-03-31", "2025-02-28", 1 / 3), false, "a fraction of a quarter is not a step");
  assert.equal(endsQuartersApart("2024-09-01", "2024-05-12", 1), true);
  assert.equal(endsQuartersApart("2023-09-03", "2023-05-07", 1), true);
  assert.equal(endsQuartersApart("2023-05-20", "2023-01-28", 1), true);
  // Costco's quarters back from Q4 FY2024: Q2, Q1, the 17-week Q4 FY2023 and Q3 FY2023.
  assert.deepEqual([["2024-02-18", 2], ["2023-11-26", 3], ["2023-09-03", 4], ["2023-05-07", 5]].map(([end, quarters]) => endsQuartersApart("2024-09-01", end as string, quarters as number)), [true, true, true, true]);
  // Apple's 14-week Q1 FY2023 after Q4 FY2022.
  assert.equal(endsQuartersApart("2022-12-31", "2022-09-24", 1), true);
  // #479: Q4 FY2025 ended three quarters before the period labelled Q1 FY2026.
  assert.equal(endsQuartersApart("2025-10-26", "2025-01-26", 1), false);
  assert.equal(endsQuartersApart("2025-10-26", "2025-01-26", 3), true);
  // One quarter more or less never pairs, even beside a 16-week quarter.
  assert.equal(endsQuartersApart("2024-09-01", "2024-02-18", 1), false);
  assert.equal(endsQuartersApart("2024-09-01", "2023-09-03", 1), false);
  assert.equal(endsQuartersApart("2024-09-01", "2024-05-12", 2), false);
  assert.deepEqual([0, -1, 1.5].map((quarters) => endsQuartersApart("2024-09-01", "2024-05-12", quarters)), [false, false, false]);
});
