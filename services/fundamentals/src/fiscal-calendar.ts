// Fiscal calendar normalization (spec §6.3.1).
//
// Maps issuer-specific fiscal calendars to canonical period labels. Without
// this layer, comparing AAPL FY2025 (ends 2025-09-27) to calendar 2025
// (ends 2025-12-31) would silently merge two different periods.

import type { FiscalPeriod, PeriodKind } from "./statement.ts";
import { assertInteger, assertOneOf } from "./validators.ts";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAYS: ReadonlyArray<Weekday> = [0, 1, 2, 3, 4, 5, 6];

// `calendar` and `fixed_month_end` produce calendar-month-aligned quarters
// (each is 3 calendar months, ending on the last day of the month).
//
// `last_weekday` produces 52/53-week fiscal years used by issuers like
// AAPL, CSCO, COST: each non-Q1 quarter is exactly 13 weeks (91 days)
// counted back from FY end. The 53rd week (when present) is absorbed into
// Q1, which lengthens to 14 weeks every ~5–6 years to keep the FY end on
// the chosen weekday.
export type FiscalCalendarKind = "calendar" | "fixed_month_end" | "last_weekday";

export const FISCAL_CALENDAR_KINDS: ReadonlyArray<FiscalCalendarKind> = [
  "calendar",
  "fixed_month_end",
  "last_weekday",
];

export type FiscalCalendar = {
  kind: FiscalCalendarKind;
  fiscal_year_end_month: number;
  fiscal_year_end_weekday?: Weekday;
};

export const CALENDAR_YEAR_FISCAL: FiscalCalendar = Object.freeze({
  kind: "calendar",
  fiscal_year_end_month: 12,
});

export const APPLE_FISCAL_CALENDAR: FiscalCalendar = Object.freeze({
  kind: "last_weekday",
  fiscal_year_end_month: 9,
  fiscal_year_end_weekday: 6,
});

export const MICROSOFT_FISCAL_CALENDAR: FiscalCalendar = Object.freeze({
  kind: "fixed_month_end",
  fiscal_year_end_month: 6,
});

export type FiscalLabel = {
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
  period_kind: PeriodKind;
  period_start: string;
  period_end: string;
};

const QUARTERS: ReadonlyArray<1 | 2 | 3 | 4> = [1, 2, 3, 4];

export function fiscalYearLabel(c: FiscalCalendar, fy: number): FiscalLabel {
  assertCalendar(c, "fiscalYearLabel.calendar");
  assertInteger(fy, "fiscalYearLabel.fiscal_year");
  return Object.freeze({
    fiscal_year: fy,
    fiscal_period: "FY",
    period_kind: "fiscal_y",
    period_start: fiscalYearStart(c, fy),
    period_end: fiscalYearEnd(c, fy),
  });
}

export function fiscalQuarterLabel(
  c: FiscalCalendar,
  fy: number,
  q: 1 | 2 | 3 | 4,
): FiscalLabel {
  assertCalendar(c, "fiscalQuarterLabel.calendar");
  assertInteger(fy, "fiscalQuarterLabel.fiscal_year");
  if (!QUARTERS.includes(q)) {
    throw new Error(
      `fiscalQuarterLabel.quarter: must be 1, 2, 3, or 4; received ${String(q)}`,
    );
  }
  return Object.freeze({
    fiscal_year: fy,
    fiscal_period: `Q${q}` as FiscalPeriod,
    period_kind: "fiscal_q",
    period_start: fiscalQuarterStart(c, fy, q),
    period_end: fiscalQuarterEnd(c, fy, q),
  });
}

export function fiscalYearEnd(c: FiscalCalendar, fy: number): string {
  switch (c.kind) {
    case "calendar":
    case "fixed_month_end":
      return formatIsoDate(lastDayOfMonth(fy, c.fiscal_year_end_month));
    case "last_weekday":
      return formatIsoDate(
        lastWeekdayOfMonth(
          fy,
          c.fiscal_year_end_month,
          c.fiscal_year_end_weekday as Weekday,
        ),
      );
  }
}

export function fiscalYearStart(c: FiscalCalendar, fy: number): string {
  return dayAfter(fiscalYearEnd(c, fy - 1));
}

function fiscalQuarterEnd(
  c: FiscalCalendar,
  fy: number,
  q: 1 | 2 | 3 | 4,
): string {
  if (q === 4) return fiscalYearEnd(c, fy);
  switch (c.kind) {
    case "calendar":
    case "fixed_month_end":
      return calendarQuarterEnd(c, fy, q);
    case "last_weekday":
      return weekQuarterEnd(c, fy, q);
  }
}

function fiscalQuarterStart(
  c: FiscalCalendar,
  fy: number,
  q: 1 | 2 | 3 | 4,
): string {
  if (q === 1) return fiscalYearStart(c, fy);
  return dayAfter(fiscalQuarterEnd(c, fy, (q - 1) as 1 | 2 | 3));
}

// For calendar / fixed_month_end: walk back 3 calendar months per quarter,
// then take the last day of that month.
function calendarQuarterEnd(
  c: FiscalCalendar,
  fy: number,
  q: 1 | 2 | 3,
): string {
  const monthsBack = (4 - q) * 3;
  let month = c.fiscal_year_end_month - monthsBack;
  let year = fy;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  return formatIsoDate(lastDayOfMonth(year, month));
}

// For last_weekday: walk back 13 weeks per quarter from FY end. Q1 absorbs
// the 53rd week when present, so Q1 length is FY-end - prior-FY-end - 39w.
function weekQuarterEnd(
  c: FiscalCalendar,
  fy: number,
  q: 1 | 2 | 3,
): string {
  const fyEnd = parseIsoDate(fiscalYearEnd(c, fy));
  const weeksBack = (4 - q) * 13;
  fyEnd.setUTCDate(fyEnd.getUTCDate() - weeksBack * 7);
  return formatIsoDate(fyEnd);
}

function lastDayOfMonth(year: number, monthOneIndexed: number): Date {
  // Date.UTC(y, m, 0) yields the last day of month (m-1)+1 = the 1-indexed
  // month m, because day 0 wraps to the previous month's last day in JS.
  return new Date(Date.UTC(year, monthOneIndexed, 0));
}

function lastWeekdayOfMonth(
  year: number,
  monthOneIndexed: number,
  weekday: Weekday,
): Date {
  const last = lastDayOfMonth(year, monthOneIndexed);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - offset);
  return last;
}

function dayAfter(isoDate: string): string {
  const d = parseIsoDate(isoDate);
  d.setUTCDate(d.getUTCDate() + 1);
  return formatIsoDate(d);
}

function parseIsoDate(s: string): Date {
  // s is `YYYY-MM-DD`; appending T00:00:00Z anchors at UTC midnight so the
  // subsequent setUTCDate arithmetic is timezone-stable.
  return new Date(`${s}T00:00:00Z`);
}

function formatIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function assertCalendar(
  value: unknown,
  label: string,
): asserts value is FiscalCalendar {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}: must be a FiscalCalendar object`);
  }
  const c = value as Record<string, unknown>;
  assertOneOf(c.kind, FISCAL_CALENDAR_KINDS, `${label}.kind`);
  assertInteger(c.fiscal_year_end_month, `${label}.fiscal_year_end_month`);
  if (c.fiscal_year_end_month < 1 || c.fiscal_year_end_month > 12) {
    throw new Error(
      `${label}.fiscal_year_end_month: must be 1..12; received ${c.fiscal_year_end_month}`,
    );
  }
  if (c.kind === "last_weekday") {
    if (
      !Number.isInteger(c.fiscal_year_end_weekday) ||
      (c.fiscal_year_end_weekday as number) < 0 ||
      (c.fiscal_year_end_weekday as number) > 6
    ) {
      throw new Error(
        `${label}.fiscal_year_end_weekday: required for kind="last_weekday"; must be an integer 0..6`,
      );
    }
  } else if (c.fiscal_year_end_weekday !== undefined) {
    throw new Error(
      `${label}.fiscal_year_end_weekday: must be omitted unless kind="last_weekday"`,
    );
  }
}
