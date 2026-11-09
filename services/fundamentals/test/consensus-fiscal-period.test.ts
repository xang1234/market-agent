import assert from "node:assert/strict";
import test from "node:test";
import { consensusFiscalPeriod, type ReportedPeriods } from "../src/consensus-fiscal-period.ts";

// Apple: fiscal year ends the last Saturday of September; FY2026 reported 2026-10-30.
const APPLE: ReportedPeriods = {
  annual: { fiscal_year: 2026, fiscal_period: "FY", period_end: "2026-09-26" },
  quarter: { fiscal_year: 2026, fiscal_period: "Q3", period_end: "2026-06-27" },
};
// A calendar-year filer two weeks after its third-quarter 10-Q.
const CALENDAR: ReportedPeriods = {
  annual: { fiscal_year: 2025, fiscal_period: "FY", period_end: "2025-12-31" },
  quarter: { fiscal_year: 2026, fiscal_period: "Q3", period_end: "2026-09-30" },
};

test("a September fiscal year: this Y and next Y follow FY2026, and next Q follows the quarter FY2026 closes", () => {
  assert.deepEqual(consensusFiscalPeriod("this_y", APPLE, "2026-11-09"), {
    fiscal_period: "FY2027",
    fiscal_period_basis:
      'Finviz "this Y" read as the fiscal year after FY2026, the latest annual period on file (ended 2026-09-26). Captured 44 days after it ended, so FY2027 is still under way: a fiscal year lasts at least 52 weeks.',
  });
  assert.deepEqual(consensusFiscalPeriod("next_y", APPLE, "2026-11-09"), {
    fiscal_period: "FY2028",
    fiscal_period_basis:
      'Finviz "next Y" read as the second fiscal year after FY2026, the latest annual period on file (ended 2026-09-26). Captured 44 days after it ended, so FY2027 is still under way: a fiscal year lasts at least 52 weeks.',
  });
  assert.deepEqual(consensusFiscalPeriod("next_q", APPLE, "2026-11-09"), {
    fiscal_period: "FY2027 Q1",
    fiscal_period_basis:
      'Finviz "next Q" read as the quarter after FY2026 Q4, the latest quarter on file (ended 2026-09-26, closing the FY2026 annual period). Captured 44 days after it ended, so FY2027 Q1 is still under way: a fiscal quarter lasts at least 12 weeks.',
  });
});

test("a calendar fiscal year: this Y is the year under way and next Q the fourth quarter", () => {
  assert.equal(consensusFiscalPeriod("this_y", CALENDAR, "2026-10-14")?.fiscal_period, "FY2026");
  assert.equal(consensusFiscalPeriod("next_y", CALENDAR, "2026-10-14")?.fiscal_period, "FY2027");
  assert.deepEqual(consensusFiscalPeriod("next_q", CALENDAR, "2026-10-14"), {
    fiscal_period: "FY2026 Q4",
    fiscal_period_basis:
      'Finviz "next Q" read as the quarter after FY2026 Q3, the latest quarter on file (ended 2026-09-30). Captured 14 days after it ended, so FY2026 Q4 is still under way: a fiscal quarter lasts at least 12 weeks.',
  });
});

test("no annual period on file names no year, and a quarter alone still names next Q", () => {
  const quarterOnly: ReportedPeriods = { annual: null, quarter: CALENDAR.quarter };
  assert.equal(consensusFiscalPeriod("this_y", quarterOnly, "2026-10-14"), null);
  assert.equal(consensusFiscalPeriod("next_y", quarterOnly, "2026-10-14"), null);
  assert.equal(consensusFiscalPeriod("next_q", quarterOnly, "2026-10-14")?.fiscal_period, "FY2026 Q4");
  assert.equal(consensusFiscalPeriod("next_q", { annual: null, quarter: null }, "2026-10-14"), null);
});

test("once a period on file could have been followed by another unreported one, the label is left unnamed", () => {
  // FY2026 ended 2026-09-26 but only FY2025 is on file: Finviz may or may not have rolled.
  const beforeTenK: ReportedPeriods = {
    annual: { fiscal_year: 2025, fiscal_period: "FY", period_end: "2025-09-27" },
    quarter: { fiscal_year: 2026, fiscal_period: "Q3", period_end: "2026-06-27" },
  };
  assert.equal(consensusFiscalPeriod("this_y", beforeTenK, "2026-10-15"), null);
  assert.equal(consensusFiscalPeriod("next_q", beforeTenK, "2026-10-15"), null);
  assert.equal(consensusFiscalPeriod("this_y", CALENDAR, "2026-12-30")?.fiscal_period, "FY2026");
  assert.equal(consensusFiscalPeriod("this_y", CALENDAR, "2026-12-31"), null);
  assert.equal(consensusFiscalPeriod("next_q", CALENDAR, "2026-12-23")?.fiscal_period, "FY2026 Q4");
  assert.equal(consensusFiscalPeriod("next_q", CALENDAR, "2026-12-24"), null);
  assert.equal(consensusFiscalPeriod("this_y", CALENDAR, "2025-12-31"), null);
});

test("a quarter on file past the year after the latest annual leaves the years unnamed", () => {
  // A shortened transition year: FY2026 was never filed as an annual period, FY2027 Q1 was.
  const transition: ReportedPeriods = {
    annual: { fiscal_year: 2025, fiscal_period: "FY", period_end: "2025-12-31" },
    quarter: { fiscal_year: 2027, fiscal_period: "Q1", period_end: "2026-09-30" },
  };
  assert.equal(consensusFiscalPeriod("this_y", transition, "2026-11-09"), null);
  assert.equal(consensusFiscalPeriod("next_y", transition, "2026-11-09"), null);
  assert.equal(consensusFiscalPeriod("next_q", transition, "2026-11-09")?.fiscal_period, "FY2027 Q2");
});
