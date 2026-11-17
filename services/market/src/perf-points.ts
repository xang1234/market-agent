// The lines of a price-performance chart, computed from each company's daily
// closes. Chat draws its chart with this, and the seal recomputes the drawn
// points with it from the bars the snapshot pins (#236), so the two agree
// exactly or the seal fails.

import { createHash } from "node:crypto";

import { selectWindow, selectYtdWindow, ytdReturns, type DailyClose, type YtdGap, type YtdSeriesInput, type YtdWindow } from "./ytd-window.ts";

// Names how a sealed series' points were drawn: a series spec carrying it was
// checked point for point at seal (#236); one sealed before has no such check.
export const PERF_POINTS = "perf_lines";

export type PerfPoint = { x: string; y: number };

// A line's return as its chart's hover shows it (web SeriesChart
// formatHoverValue): what the answer quotes and the seal checks a chip against.
export function returnLabel(y: number): string {
  return `${y.toLocaleString("en-US", { maximumFractionDigits: Math.abs(y) >= 1000 ? 0 : 2 })}%`;
}

// A close as a price chip shows it: the answer quotes it and the seal checks
// it against the close the line ends on (#678).
export function closeLabel(close: number, currency: string): string {
  const amount = close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${amount}` : `${amount} ${currency}`;
}

// A line's points, and the digest of the bars it pins. The cache reuses
// bar_range_id when it refreshes a range, so the ID alone does not pin prices.
export type PerfLine = { points: ReadonlyArray<PerfPoint>; bars_sha256: string };

// The latest stored window: lines over the UTC dates every company has, each
// from the first shared close, with each digest over the whole stored range.
export type LatestPerfInput = { kind: "latest"; bars: ReadonlyArray<ReadonlyArray<DailyClose>> };
// A year-to-date window (ytd-window.ts), each digest over exactly the window's bars.
export type YtdPerfInput = { kind: "ytd"; series: ReadonlyArray<YtdSeriesInput>; cutoff: string };
// A window from `start`, an exchange-local date, measured as YTD's (#678).
export type WindowPerfInput = { kind: "window"; start: string; series: ReadonlyArray<YtdSeriesInput>; cutoff: string };

export type PerfGap = { ok: false; gap: string };

type Drawn = { ok: true; lines: ReadonlyArray<PerfLine> };

export function perfLines(input: LatestPerfInput): Drawn | PerfGap;
export function perfLines(input: YtdPerfInput | WindowPerfInput): (Drawn & { window: YtdWindow }) | YtdGap;
export function perfLines(input: LatestPerfInput | YtdPerfInput | WindowPerfInput): (Drawn & { window?: YtdWindow }) | PerfGap {
  if (input.kind !== "latest") {
    const window = input.kind === "ytd" ? selectYtdWindow(input.series, input.cutoff) : selectWindow(input.series, input.cutoff, input.start);
    if (!window.ok) return window;
    const lines = window.bars.map((bars) => {
      const returns = ytdReturns(bars);
      return { points: window.dates.map((date, index) => ({ x: date, y: returns[index] })), bars_sha256: barsSha256(bars) };
    });
    return { ok: true, lines, window };
  }
  const closesByDate = input.bars.map((bars) => new Map(bars.map((bar) => [bar.ts.slice(0, 10), bar.close])));
  const sharedDates = [...(closesByDate[0]?.keys() ?? [])]
    .filter((date) => closesByDate.every((closes) => closes.has(date)))
    .sort();
  if (sharedDates.length < 2) return { ok: false, gap: "fewer than two dates every company has" };
  if (closesByDate.some((closes) => !(closes.get(sharedDates[0])! > 0))) {
    return { ok: false, gap: `a ${sharedDates[0]} close is not a usable baseline` };
  }
  const lines = closesByDate.map((closes, index) => {
    const base = closes.get(sharedDates[0])!;
    return {
      points: sharedDates.map((date) => ({ x: date, y: (closes.get(date)! / base - 1) * 100 })),
      bars_sha256: barsSha256(input.bars[index]),
    };
  });
  return { ok: true, lines };
}

function barsSha256(bars: ReadonlyArray<DailyClose>): string {
  return createHash("sha256").update(JSON.stringify(bars.map((bar) => [bar.ts, bar.close]))).digest("hex");
}
