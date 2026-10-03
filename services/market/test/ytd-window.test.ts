import assert from "node:assert/strict";
import test from "node:test";

import { completedSessionsEnd, isCompletedSession, selectYtdWindow, sessionDate, ytdReturns, type DailyClose } from "../src/ytd-window.ts";

const NY = "America/New_York";
// Bars are stamped at the start of their New York session date: 05:00Z in
// winter (EST), 04:00Z in summer (EDT).
const bar = (date: string, close: number): DailyClose => ({
  ts: `${date}T${date >= "2026-03-08" && date < "2026-11-01" ? "04" : "05"}:00:00.000Z`,
  close,
});
const AFTER_CLOSE = "2026-08-31T21:00:00.000Z"; // 17:00 New York

test("YTD is measured from the last close before January 1, not the first January close (#192)", () => {
  const window = selectYtdWindow(
    [{ label: "NVDA", timeZone: NY, bars: [bar("2025-12-31", 100), bar("2026-01-02", 110), bar("2026-08-31", 120)] }],
    AFTER_CLOSE,
  );
  assert.ok(window.ok);
  assert.equal(window.year, 2026);
  assert.equal(window.baselineDate, "2025-12-31");
  assert.equal(window.endDate, "2026-08-31");
  const returns = ytdReturns(window.bars[0]);
  assert.equal(returns.at(-1), 20, "120 over a 100 baseline, not 9.09% over the 110 January close");
  assert.equal(returns[0], 0);
});

test("every company shares the baseline and end session; others' sessions are skipped and counted", () => {
  const window = selectYtdWindow(
    [
      { label: "NVDA", timeZone: NY, bars: [bar("2025-12-31", 100), bar("2026-01-02", 101), bar("2026-01-05", 102), bar("2026-08-31", 120)] },
      { label: "AMD", timeZone: NY, bars: [bar("2025-12-31", 50), bar("2026-01-05", 51), bar("2026-08-31", 60)] },
    ],
    AFTER_CLOSE,
  );
  assert.ok(window.ok);
  assert.deepEqual(window.dates, ["2025-12-31", "2026-01-05", "2026-08-31"]);
  assert.equal(window.skippedSessions, 1, "Jan 2 has no AMD close; it is skipped, not filled");
  assert.deepEqual(window.bars[1].map((b) => b.close), [50, 51, 60]);
});

test("a weekend or holiday at the year boundary uses the last session before it", () => {
  // 2022-12-31 was a Saturday and 2022-12-30 the last session.
  const window = selectYtdWindow(
    [{ label: "AAPL", timeZone: NY, bars: [{ ts: "2022-12-30T05:00:00.000Z", close: 129.93 }, { ts: "2023-01-03T05:00:00.000Z", close: 125.07 }] }],
    "2023-01-03T22:00:00.000Z",
  );
  assert.ok(window.ok);
  assert.equal(window.baselineDate, "2022-12-30");
});

test("session dates and completion follow the exchange's time zone, not UTC", () => {
  // 03:30Z on Jan 1 is still Dec 31 in New York.
  assert.equal(sessionDate("2026-01-01T03:30:00.000Z", NY), "2025-12-31");
  // Today's bar before 16:00 New York is still forming; after it, final.
  assert.equal(isCompletedSession("2026-08-31T04:00:00.000Z", "2026-08-31T19:59:00.000Z", NY), false);
  assert.equal(isCompletedSession("2026-08-31T04:00:00.000Z", "2026-08-31T20:00:00.000Z", NY), true);
  // A cutoff of 01:00Z Jan 1 is still the prior year in New York: YTD of 2025.
  const window = selectYtdWindow(
    [{ label: "NVDA", timeZone: NY, bars: [bar("2024-12-31", 10), bar("2025-12-31", 12)] }],
    "2026-01-01T01:00:00.000Z",
  );
  assert.ok(window.ok);
  assert.equal(window.year, 2025);
  assert.equal(window.endDate, "2025-12-31");
});

test("a forming bar is never the endpoint", () => {
  const window = selectYtdWindow(
    [{ label: "NVDA", timeZone: NY, bars: [bar("2025-12-31", 100), bar("2026-08-28", 115), bar("2026-08-31", 130)] }],
    "2026-08-31T15:00:00.000Z", // 11:00 New York
  );
  assert.ok(window.ok);
  assert.equal(window.endDate, "2026-08-28");
});

test("what can't make a full YTD window is a named gap, never a shorter window", () => {
  const gap = (series: Parameters<typeof selectYtdWindow>[0]) => {
    const window = selectYtdWindow(series, AFTER_CLOSE);
    assert.equal(window.ok, false);
    return window.ok ? "" : window.gap;
  };
  // IPO after the year began: nothing before it.
  assert.equal(gap([{ label: "NEW", timeZone: NY, bars: [bar("2026-03-02", 20), bar("2026-08-31", 25)] }]), "NEW has no prices from before 2026");
  // Prior-year prices, but none in the last week of December.
  assert.equal(
    gap([{ label: "NVDA", timeZone: NY, bars: [bar("2025-11-28", 90), bar("2026-08-31", 120)] }]),
    "NVDA has no close in the last week of 2025",
  );
  // A zero baseline cannot be divided by.
  assert.equal(
    gap([{ label: "NVDA", timeZone: NY, bars: [bar("2025-12-31", 0), bar("2026-08-31", 120)] }]),
    "NVDA's 2025-12-31 close is not a usable baseline",
  );
  // Baselines on different sessions.
  assert.equal(
    gap([
      { label: "NVDA", timeZone: NY, bars: [bar("2025-12-31", 100), bar("2026-08-31", 120)] },
      { label: "AMD", timeZone: NY, bars: [bar("2025-12-30", 50), bar("2026-08-31", 60)] },
    ]),
    "the companies' last closes before 2026 fall on different sessions (NVDA 2025-12-31, AMD 2025-12-30)",
  );
  // The latest session is missing for one company.
  assert.equal(
    gap([
      { label: "NVDA", timeZone: NY, bars: [bar("2025-12-31", 100), bar("2026-08-31", 120)] },
      { label: "AMD", timeZone: NY, bars: [bar("2025-12-31", 50), bar("2026-08-28", 60)] },
    ]),
    "AMD has no close for 2026-08-31",
  );
  // No session of the year has closed yet.
  assert.equal(
    gap([{ label: "NVDA", timeZone: NY, bars: [bar("2025-12-31", 100)] }]),
    "no session in 2026 has closed yet",
  );
});

test("completed sessions end where today's session begins until it closes, then after it (#232)", () => {
  assert.equal(completedSessionsEnd("2026-08-31T15:00:00.000Z", NY), "2026-08-31T04:00:00.000Z"); // 11:00, trading
  assert.equal(completedSessionsEnd("2026-08-31T20:00:00.000Z", NY), "2026-09-01T04:00:00.000Z"); // 16:00, closed
  assert.equal(completedSessionsEnd("2026-12-31T22:00:00.000Z", NY), "2027-01-01T05:00:00.000Z"); // across the year
});
