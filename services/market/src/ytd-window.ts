// Year-to-date window semantics for daily closes (#192), shared server-side.
//
// A YTD return is measured from the final completed close before January 1 of
// the cutoff's year (exchange-local), not from the first January close, to the
// latest completed session every company has. Every company uses the same
// baseline and end session, or there is no window: a named gap is returned
// instead of a shortened window called YTD. Prices are never invented; a
// session that not every company traded is skipped and counted.
//
// Daily bars are stamped at the start of their exchange-local session date
// (every adapter does this), so a bar's session date is its local date.
//
// ponytail: a session counts as completed from 16:00 exchange-local time (US
// regular close); add per-exchange close times when non-US listings chart.
// ponytail: "the last week of December" (from Dec 24) stands in for an
// exchange calendar when finding the baseline; a longer year-end closure
// reads as a missing baseline.

import { zonedDateStartUtcIso } from "./range-canonicalization.ts";

export type DailyClose = { ts: string; close: number };

export type YtdSeriesInput = {
  label: string;
  timeZone: string;
  bars: ReadonlyArray<DailyClose>;
};

export type YtdWindow = {
  ok: true;
  year: number;
  baselineDate: string;
  endDate: string;
  // Baseline first, then every session in the year that all companies traded.
  dates: ReadonlyArray<string>;
  // Per input series, the bars on `dates` (same order), baseline first.
  bars: ReadonlyArray<ReadonlyArray<DailyClose>>;
  // Sessions some companies traded and others did not, left out of `dates`.
  skippedSessions: number;
};

export type YtdGap = { ok: false; gap: string };

const SESSION_CLOSE_MINUTES = 16 * 60;

// The exclusive end of the sessions completed by `cutoff` on the exchange's
// calendar: today's session counts only once it has closed, so a fetch bounded
// by it never stores a forming bar as a close.
export function completedSessionsEnd(cutoff: string, timeZone: string): string {
  const now = localParts(cutoff, timeZone);
  if (now.minutes < SESSION_CLOSE_MINUTES) return zonedDateStartUtcIso(now.date, timeZone);
  const next = new Date(`${now.date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return zonedDateStartUtcIso(next.toISOString().slice(0, 10), timeZone);
}

// The year a YTD window covers: the cutoff's year on the exchange's calendar.
export function ytdYear(cutoff: string, timeZone: string): number {
  return Number(localParts(cutoff, timeZone).date.slice(0, 4));
}

export function selectYtdWindow(series: ReadonlyArray<YtdSeriesInput>, cutoff: string): YtdWindow | YtdGap {
  const years = new Set(series.map((item) => ytdYear(cutoff, item.timeZone)));
  if (years.size !== 1) return { ok: false, gap: "the companies' exchanges are in different calendar years at the cutoff" };
  const [year] = years;
  const yearStart = `${year}-01-01`;
  const lookbackStart = `${year - 1}-12-24`;

  const dated = series.map((item) => {
    const byDate = new Map<string, DailyClose>();
    for (const bar of item.bars) {
      if (isCompletedSession(bar.ts, cutoff, item.timeZone)) byDate.set(sessionDate(bar.ts, item.timeZone), bar);
    }
    return byDate;
  });

  const baselines: Array<{ date: string; bar: DailyClose }> = [];
  for (const [index, item] of series.entries()) {
    const dates = [...dated[index].keys()].sort();
    if (!dates.some((date) => date < yearStart)) {
      return { ok: false, gap: `${item.label} has no prices from before ${year}` };
    }
    const date = dates.filter((candidate) => candidate >= lookbackStart && candidate < yearStart).at(-1);
    if (date === undefined) return { ok: false, gap: `${item.label} has no close in the last week of ${year - 1}` };
    const bar = dated[index].get(date)!;
    if (!(bar.close > 0)) return { ok: false, gap: `${item.label}'s ${date} close is not a usable baseline` };
    baselines.push({ date, bar });
  }
  const baselineDate = baselines[0].date;
  if (baselines.some((baseline) => baseline.date !== baselineDate)) {
    const each = series.map((item, index) => `${item.label} ${baselines[index].date}`).join(", ");
    return { ok: false, gap: `the companies' last closes before ${year} fall on different sessions (${each})` };
  }

  const inYear = dated.map((byDate) => [...byDate.keys()].filter((date) => date >= yearStart));
  const endDate = inYear.flat().sort().at(-1);
  if (endDate === undefined) return { ok: false, gap: `no session in ${year} has closed yet` };
  const missingEnd = series.find((_, index) => !dated[index].has(endDate));
  if (missingEnd) return { ok: false, gap: `${missingEnd.label} has no close for ${endDate}` };

  const sessions = [...new Set(inYear.flat())].filter((date) => date <= endDate).sort();
  const shared = sessions.filter((date) => dated.every((byDate) => byDate.has(date)));
  const dates = [baselineDate, ...shared];
  return {
    ok: true,
    year,
    baselineDate,
    endDate,
    dates,
    bars: dated.map((byDate) => dates.map((date) => byDate.get(date)!)),
    skippedSessions: sessions.length - shared.length,
  };
}

// Percent return from the window's baseline close, (close / baseline - 1) * 100,
// written as a difference first so round figures stay exact (120 on 100 is 20).
export function ytdReturns(bars: ReadonlyArray<DailyClose>): number[] {
  const base = bars[0].close;
  return bars.map((bar) => ((bar.close - base) / base) * 100);
}

export function sessionDate(ts: string, timeZone: string): string {
  return localParts(ts, timeZone).date;
}

// A session's bar is final once the exchange has closed that day; a bar for
// today before the close is still forming.
export function isCompletedSession(ts: string, cutoff: string, timeZone: string): boolean {
  const session = sessionDate(ts, timeZone);
  const now = localParts(cutoff, timeZone);
  return session < now.date || (session === now.date && now.minutes >= SESSION_CLOSE_MINUTES);
}

function localParts(iso: string, timeZone: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
