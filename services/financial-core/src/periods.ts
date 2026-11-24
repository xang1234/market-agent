// Period identity: exact dates, instant/duration, fiscal labels, and calendar
// version. A fiscal label alone never establishes equality. Pure date
// arithmetic on ISO dates (UTC day numbers); no wall-clock access.

import type { FiscalPeriod, IsoDate, VersionTag } from "./contracts.ts";

/** A share price has a trade date and no fiscal period: its fiscal fields are null. */
export type PeriodIdentity = {
  kind: "duration" | "instant";
  start: IsoDate | null;
  end: IsoDate;
  fiscal_year: number | null;
  fiscal_period: FiscalPeriod | "TTM" | null;
  calendar_version: VersionTag | null;
};

// 13-week (91 day) and 14-week (98 day) fiscal quarters and 89–92 day calendar
// quarters; 52-week (364) and 53-week (371) fiscal years and 365/366 calendar
// years. Anything else (e.g. year-to-date) is not a quarter or a year.
const QUARTER_DAYS = { min: 89, max: 98 };
const ANNUAL_DAYS = { min: 364, max: 371 };
const DAY_MS = 86_400_000;

export function periodDays(period: PeriodIdentity): number | null {
  if (period.kind === "instant" || period.start === null) return null;
  return dayNumber(period.end) - dayNumber(period.start) + 1;
}

/**
 * Two periods, each in its own fiscal calendar, cover mostly the same months:
 * their ends lie at most half the shorter period apart. Any two calendars
 * have periods that close, so a wider gap means one is a period ahead.
 */
export function coverSameMonths(left: Pick<PeriodIdentity, "start" | "end">, right: Pick<PeriodIdentity, "start" | "end">): boolean {
  if (left.start === null || right.start === null) return false;
  const days = Math.min(dayNumber(left.end) - dayNumber(left.start), dayNumber(right.end) - dayNumber(right.start)) + 1;
  return 2 * Math.abs(dayNumber(left.end) - dayNumber(right.end)) <= days;
}

// A 52/53-week year ends on one weekday in a 7-day window, so its end sits at
// most 6 days off the same date a year earlier; a 14-week quarter sits 7 days
// off three calendar months. A moved fiscal year end shifts it by a month or more.
const STEP_TOLERANCE_DAYS = 14;

/** `olderEnd` falls `months` calendar months before `newerEnd`, give or take STEP_TOLERANCE_DAYS. */
export function endsStepsApart(newerEnd: IsoDate, olderEnd: IsoDate, months: number): boolean {
  if (!Number.isInteger(months) || months <= 0) return false;
  const [year, month, day] = newerEnd.split("-").map(Number);
  // A month-end date steps to that month's end: May 31 three months back is
  // Feb 28, not Mar 3, and Feb 28, 2025 a year back is Feb 29, 2024.
  const lastDay = new Date(Date.UTC(year!, month! - months, 0)).getUTCDate();
  const monthEnd = day === new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const target = Date.UTC(year!, month! - 1 - months, monthEnd ? lastDay : Math.min(day!, lastDay)) / DAY_MS;
  return Math.abs(dayNumber(olderEnd) - target) <= STEP_TOLERANCE_DAYS;
}

export function classifyDuration(period: PeriodIdentity): "instant" | "quarter" | "annual" | "other" {
  const days = periodDays(period);
  if (days === null) return "instant";
  if (days >= QUARTER_DAYS.min && days <= QUARTER_DAYS.max) return "quarter";
  if (days >= ANNUAL_DAYS.min && days <= ANNUAL_DAYS.max) return "annual";
  return "other";
}

export function periodsIdentical(left: PeriodIdentity, right: PeriodIdentity): boolean {
  return (
    left.kind === right.kind &&
    left.start === right.start &&
    left.end === right.end &&
    left.fiscal_year === right.fiscal_year &&
    left.fiscal_period === right.fiscal_period &&
    left.calendar_version === right.calendar_version
  );
}

/** Instants overlap only when equal; durations when their day ranges intersect. */
export function periodsOverlap(left: PeriodIdentity, right: PeriodIdentity): boolean {
  const [leftStart, leftEnd] = dayRange(left);
  const [rightStart, rightEnd] = dayRange(right);
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

/** True when `later` starts the day after `earlier` ends. */
export function periodsContiguous(earlier: PeriodIdentity, later: PeriodIdentity): boolean {
  if (earlier.kind !== "duration" || later.kind !== "duration" || later.start === null) return false;
  return dayNumber(later.start) === dayNumber(earlier.end) + 1;
}

export function comparePeriodEnds(left: PeriodIdentity, right: PeriodIdentity): -1 | 0 | 1 {
  const difference = dayNumber(left.end) - dayNumber(right.end);
  return difference < 0 ? -1 : difference > 0 ? 1 : 0;
}

export function dayNumber(date: IsoDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY_MS;
}

function dayRange(period: PeriodIdentity): [number, number] {
  const end = dayNumber(period.end);
  return [period.kind === "instant" || period.start === null ? end : dayNumber(period.start), end];
}
