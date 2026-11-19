// The dates a listing's exchange holds a regular session (#611): every
// weekday, less NYSE's holidays for a New York listing. A fixed-date holiday
// on a Sunday closes the Monday after and on a Saturday the Friday before,
// except New Year's Day, whose Friday ends a year.
// ponytail: rules, not a table, so no year needs adding. An unscheduled
// closure (a day of mourning, a storm) counts as a session, so a price from
// before it reads one session staler and is declined, never shown; list such
// closures here if that matters.

import type { IsoDate } from "./contracts.ts";

const NYSE_ZONE = "America/New_York";
const MONDAY = 1;
const THURSDAY = 4;

export function isSessionDate(date: IsoDate, timeZone: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`);
  const weekday = day.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return timeZone !== NYSE_ZONE || !nyseHolidays(day.getUTCFullYear()).includes(date);
}

function nyseHolidays(year: number): IsoDate[] {
  const [easterMonth, easterDay] = easter(year);
  const newYearOnSaturday = new Date(Date.UTC(year, 0, 1)).getUTCDay() === 6;
  return [
    ...(newYearOnSaturday ? [] : [observed(year, 0, 1)]),
    weekdayFrom(year, 0, 15, MONDAY),
    weekdayFrom(year, 1, 15, MONDAY),
    iso(Date.UTC(year, easterMonth, easterDay - 2)),
    weekdayFrom(year, 4, 25, MONDAY),
    ...(year >= 2022 ? [observed(year, 5, 19)] : []),
    observed(year, 6, 4),
    weekdayFrom(year, 8, 1, MONDAY),
    weekdayFrom(year, 10, 22, THURSDAY),
    observed(year, 11, 25),
  ];
}

function observed(year: number, month: number, day: number): IsoDate {
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  return iso(Date.UTC(year, month, day + (weekday === 0 ? 1 : weekday === 6 ? -1 : 0)));
}

// The first `weekday` on or after a date: the third Monday of January is the first on or after the 15th.
function weekdayFrom(year: number, month: number, day: number, weekday: number): IsoDate {
  const from = new Date(Date.UTC(year, month, day)).getUTCDay();
  return iso(Date.UTC(year, month, day + ((weekday - from + 7) % 7)));
}

// Easter Sunday by the anonymous Gregorian algorithm, as a month index and day.
function easter(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const n = h + l - 7 * Math.floor((a + 11 * h + 22 * l) / 451) + 114;
  return [Math.floor(n / 31) - 1, (n % 31) + 1];
}

function iso(instant: number): IsoDate {
  return new Date(instant).toISOString().slice(0, 10);
}
