// The session calendar against the holidays NYSE Group published for 2026 to
// 2028 in December 2025 (#611).

import assert from "node:assert/strict";
import test from "node:test";
import { isSessionDate } from "../src/index.ts";

const NY = "America/New_York";
const DAY_MS = 86_400_000;

// New Year's Day 2028 is a Saturday, and NYSE observes no holiday for it, so Friday 2027-12-31 is a session.
const NYSE_HOLIDAYS = [
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25",
];

function closedWeekdays(year: number, timeZone: string): string[] {
  const closed: string[] = [];
  for (let day = Date.UTC(year, 0, 1); day < Date.UTC(year + 1, 0, 1); day += DAY_MS) {
    const date = new Date(day).toISOString().slice(0, 10);
    if (new Date(day).getUTCDay() % 6 !== 0 && !isSessionDate(date, timeZone)) closed.push(date);
  }
  return closed;
}

test("a New York listing's closed weekdays in 2026 to 2028 are exactly NYSE's published holidays", () => {
  assert.deepEqual([2026, 2027, 2028].flatMap((year) => closedWeekdays(year, NY)), NYSE_HOLIDAYS);
});

test("a weekend holds no session, and a listing outside New York trades every weekday", () => {
  assert.deepEqual(["2026-11-28", "2026-11-29", "2026-11-30"].map((date) => isSessionDate(date, NY)), [false, false, true]);
  assert.deepEqual(closedWeekdays(2026, "Asia/Tokyo"), []);
});
