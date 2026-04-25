import test from "node:test";
import assert from "node:assert/strict";
import {
  APPLE_FISCAL_CALENDAR,
  CALENDAR_YEAR_FISCAL,
  MICROSOFT_FISCAL_CALENDAR,
  assertCalendar,
  fiscalQuarterLabel,
  fiscalYearEnd,
  fiscalYearLabel,
  fiscalYearStart,
  type FiscalCalendar,
} from "../src/fiscal-calendar.ts";
import { normalizedStatement } from "../src/statement.ts";
import { aaplIssuer, SEC_EDGAR_SOURCE_ID } from "./fixtures.ts";

// --- Acceptance test: FY25 vs calendar 2025 must be distinguishable -------

test("Apple FY2025 and calendar 2025 carry different period_start/period_end (no silent merge)", () => {
  const apple = fiscalYearLabel(APPLE_FISCAL_CALENDAR, 2025);
  const cal = fiscalYearLabel(CALENDAR_YEAR_FISCAL, 2025);

  assert.equal(apple.fiscal_year, 2025);
  assert.equal(cal.fiscal_year, 2025);

  assert.equal(apple.period_end, "2025-09-27");
  assert.equal(cal.period_end, "2025-12-31");
  assert.notEqual(apple.period_end, cal.period_end);

  assert.equal(apple.period_start, "2024-09-29");
  assert.equal(cal.period_start, "2025-01-01");
  assert.notEqual(apple.period_start, cal.period_start);
});

// --- AAPL fiscal-year-end dates (cross-checked against AAPL filings) ------

test("APPLE_FISCAL_CALENDAR resolves last-Saturday-of-September fiscal-year ends", () => {
  // Filed AAPL 10-K dates: FY2022→2022-09-24, FY2023→2023-09-30 (53-week
  // year), FY2024→2024-09-28, FY2025→2025-09-27.
  assert.equal(fiscalYearEnd(APPLE_FISCAL_CALENDAR, 2022), "2022-09-24");
  assert.equal(fiscalYearEnd(APPLE_FISCAL_CALENDAR, 2023), "2023-09-30");
  assert.equal(fiscalYearEnd(APPLE_FISCAL_CALENDAR, 2024), "2024-09-28");
  assert.equal(fiscalYearEnd(APPLE_FISCAL_CALENDAR, 2025), "2025-09-27");
});

test("APPLE FY start = day after prior FY end", () => {
  assert.equal(fiscalYearStart(APPLE_FISCAL_CALENDAR, 2024), "2023-10-01");
  assert.equal(fiscalYearStart(APPLE_FISCAL_CALENDAR, 2025), "2024-09-29");
});

// --- AAPL FY2024 quarters (52-week year) -----------------------------------

test("APPLE FY2024 quarter ends fall 13 weeks apart, matching the 10-K", () => {
  // Filed AAPL 10-Q / 10-K dates for FY2024:
  //   Q1 ended 2023-12-30; Q2 ended 2024-03-30; Q3 ended 2024-06-29;
  //   Q4 ended 2024-09-28. Each quarter is exactly 91 days.
  const q1 = fiscalQuarterLabel(APPLE_FISCAL_CALENDAR, 2024, 1);
  const q2 = fiscalQuarterLabel(APPLE_FISCAL_CALENDAR, 2024, 2);
  const q3 = fiscalQuarterLabel(APPLE_FISCAL_CALENDAR, 2024, 3);
  const q4 = fiscalQuarterLabel(APPLE_FISCAL_CALENDAR, 2024, 4);

  assert.equal(q1.period_end, "2023-12-30");
  assert.equal(q2.period_end, "2024-03-30");
  assert.equal(q3.period_end, "2024-06-29");
  assert.equal(q4.period_end, "2024-09-28");

  assert.equal(q1.period_start, "2023-10-01"); // FY2024 start
  assert.equal(q2.period_start, "2023-12-31"); // day after Q1
  assert.equal(q3.period_start, "2024-03-31"); // day after Q2
  assert.equal(q4.period_start, "2024-06-30"); // day after Q3
});

// --- AAPL FY2023 quarters (53-week year — the special case) ---------------

test("APPLE FY2023 is a 53-week year with the extra week absorbed into Q1", () => {
  // Filed AAPL FY2023 quarter ends: Q1=2022-12-31, Q2=2023-04-01,
  // Q3=2023-07-01, Q4=2023-09-30. Q1 spans 14 weeks (98 days) because the
  // FY started on 2022-09-25 (day after the 2022-09-24 FY2022 end).
  const q1 = fiscalQuarterLabel(APPLE_FISCAL_CALENDAR, 2023, 1);
  const q2 = fiscalQuarterLabel(APPLE_FISCAL_CALENDAR, 2023, 2);
  const q3 = fiscalQuarterLabel(APPLE_FISCAL_CALENDAR, 2023, 3);
  const q4 = fiscalQuarterLabel(APPLE_FISCAL_CALENDAR, 2023, 4);

  assert.equal(q1.period_end, "2022-12-31");
  assert.equal(q2.period_end, "2023-04-01");
  assert.equal(q3.period_end, "2023-07-01");
  assert.equal(q4.period_end, "2023-09-30");

  assert.equal(q1.period_start, "2022-09-25");
  assert.equal(daysBetween(q1.period_start, q1.period_end), 98);
  assert.equal(daysBetween(q2.period_start, q2.period_end), 91);
  assert.equal(daysBetween(q3.period_start, q3.period_end), 91);
  assert.equal(daysBetween(q4.period_start, q4.period_end), 91);
});

// --- Non-Apple fiscal calendars --------------------------------------------

test("CALENDAR_YEAR_FISCAL produces calendar-aligned quarters", () => {
  const fy = fiscalYearLabel(CALENDAR_YEAR_FISCAL, 2024);
  assert.equal(fy.period_start, "2024-01-01");
  assert.equal(fy.period_end, "2024-12-31");

  assert.equal(fiscalQuarterLabel(CALENDAR_YEAR_FISCAL, 2024, 1).period_end, "2024-03-31");
  assert.equal(fiscalQuarterLabel(CALENDAR_YEAR_FISCAL, 2024, 2).period_end, "2024-06-30");
  assert.equal(fiscalQuarterLabel(CALENDAR_YEAR_FISCAL, 2024, 3).period_end, "2024-09-30");
  assert.equal(fiscalQuarterLabel(CALENDAR_YEAR_FISCAL, 2024, 4).period_end, "2024-12-31");
});

test("MICROSOFT_FISCAL_CALENDAR (June fiscal year end) resolves quarters as last day of month", () => {
  const fy = fiscalYearLabel(MICROSOFT_FISCAL_CALENDAR, 2024);
  assert.equal(fy.period_start, "2023-07-01");
  assert.equal(fy.period_end, "2024-06-30");

  assert.equal(fiscalQuarterLabel(MICROSOFT_FISCAL_CALENDAR, 2024, 1).period_end, "2023-09-30");
  assert.equal(fiscalQuarterLabel(MICROSOFT_FISCAL_CALENDAR, 2024, 2).period_end, "2023-12-31");
  assert.equal(fiscalQuarterLabel(MICROSOFT_FISCAL_CALENDAR, 2024, 3).period_end, "2024-03-31");
  assert.equal(fiscalQuarterLabel(MICROSOFT_FISCAL_CALENDAR, 2024, 4).period_end, "2024-06-30");
});

// --- Output shape & frozen discipline --------------------------------------

test("fiscalYearLabel returns a frozen FY label with period_kind=fiscal_y", () => {
  const label = fiscalYearLabel(APPLE_FISCAL_CALENDAR, 2024);
  assert.equal(Object.isFrozen(label), true);
  assert.equal(label.fiscal_period, "FY");
  assert.equal(label.period_kind, "fiscal_y");
});

test("fiscalQuarterLabel returns a frozen quarter label with period_kind=fiscal_q", () => {
  for (const q of [1, 2, 3, 4] as const) {
    const label = fiscalQuarterLabel(APPLE_FISCAL_CALENDAR, 2024, q);
    assert.equal(Object.isFrozen(label), true);
    assert.equal(label.fiscal_period, `Q${q}`);
    assert.equal(label.period_kind, "fiscal_q");
  }
});

// --- Integration: label feeds normalizedStatement --------------------------

test("fiscalYearLabel output plugs into normalizedStatement (income statement, FY)", () => {
  const label = fiscalYearLabel(APPLE_FISCAL_CALENDAR, 2024);
  const s = normalizedStatement({
    subject: aaplIssuer,
    family: "income",
    basis: "as_reported",
    period_kind: label.period_kind,
    period_start: label.period_start,
    period_end: label.period_end,
    fiscal_year: label.fiscal_year,
    fiscal_period: label.fiscal_period,
    reporting_currency: "USD",
    as_of: "2024-11-01T20:30:00.000Z",
    source_id: SEC_EDGAR_SOURCE_ID,
    lines: [],
  });
  assert.equal(s.fiscal_year, 2024);
  assert.equal(s.fiscal_period, "FY");
  assert.equal(s.period_start, "2023-10-01");
  assert.equal(s.period_end, "2024-09-28");
});

test("fiscalQuarterLabel output plugs into normalizedStatement (income statement, Q3)", () => {
  const label = fiscalQuarterLabel(APPLE_FISCAL_CALENDAR, 2024, 3);
  const s = normalizedStatement({
    subject: aaplIssuer,
    family: "income",
    basis: "as_reported",
    period_kind: label.period_kind,
    period_start: label.period_start,
    period_end: label.period_end,
    fiscal_year: label.fiscal_year,
    fiscal_period: label.fiscal_period,
    reporting_currency: "USD",
    as_of: "2024-08-02T20:30:00.000Z",
    source_id: SEC_EDGAR_SOURCE_ID,
    lines: [],
  });
  assert.equal(s.fiscal_period, "Q3");
  assert.equal(s.period_kind, "fiscal_q");
  assert.equal(s.period_end, "2024-06-29");
});

// --- Calendar contract -----------------------------------------------------

test("assertCalendar rejects unknown kinds, out-of-range months, missing/forbidden weekdays", () => {
  assert.throws(
    () => assertCalendar({ kind: "weekly", fiscal_year_end_month: 6 }, "c"),
    /kind/,
  );
  assert.throws(
    () =>
      assertCalendar({ kind: "calendar", fiscal_year_end_month: 0 }, "c"),
    /fiscal_year_end_month: must be 1\.\.12/,
  );
  assert.throws(
    () =>
      assertCalendar({ kind: "calendar", fiscal_year_end_month: 13 }, "c"),
    /fiscal_year_end_month: must be 1\.\.12/,
  );
  assert.throws(
    () =>
      assertCalendar(
        { kind: "last_weekday", fiscal_year_end_month: 9 },
        "c",
      ),
    /fiscal_year_end_weekday: required for kind="last_weekday"/,
  );
  assert.throws(
    () =>
      assertCalendar(
        {
          kind: "calendar",
          fiscal_year_end_month: 12,
          fiscal_year_end_weekday: 6,
        },
        "c",
      ),
    /must be omitted unless kind="last_weekday"/,
  );
  assert.throws(
    () =>
      assertCalendar(
        {
          kind: "last_weekday",
          fiscal_year_end_month: 9,
          fiscal_year_end_weekday: 7,
        },
        "c",
      ),
    /fiscal_year_end_weekday/,
  );
});

test("fiscalYearLabel rejects non-integer fiscal_year and bad calendar shape", () => {
  assert.throws(
    () => fiscalYearLabel(APPLE_FISCAL_CALENDAR, 2024.5),
    /fiscal_year/,
  );
  assert.throws(
    () => fiscalYearLabel({} as unknown as FiscalCalendar, 2024),
    /kind/,
  );
});

test("fiscalQuarterLabel rejects quarters outside 1..4", () => {
  for (const bad of [0, 5, -1, 1.5]) {
    assert.throws(
      () =>
        fiscalQuarterLabel(
          APPLE_FISCAL_CALENDAR,
          2024,
          bad as unknown as 1 | 2 | 3 | 4,
        ),
      /quarter/,
      `expected q=${bad} to be rejected`,
    );
  }
});

// --- helpers ---------------------------------------------------------------

function daysBetween(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}
