// Dev-only listing records and a polygon snapshot fetcher that returns canned
// data for known tickers. Stable UUIDs let the web frontend hard-link to a
// listing (e.g., `/symbol/listing/<uuid>`) without a DB seed step. Production
// wiring replaces both with DB-backed listings + a real polygon HTTP client
// using POLYGON_API_KEY.

import type { PolygonFetcher } from "./adapters/polygon.ts";
import type { ListingRecord } from "./listings.ts";
import type { UUID } from "./subject-ref.ts";

// Single dev-mode source UUID; all fixture quotes carry this as `source_id`.
// Differs from any "stub" sentinel — verifiable via the bead's clause that
// the landing surface must show a live source UUID, not a stub string.
export const DEV_POLYGON_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000001";

export const DEV_LISTINGS: ReadonlyArray<ListingRecord> = [
  {
    listing_id: "11111111-1111-4111-a111-111111111111",
    ticker: "AAPL",
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
  },
  {
    listing_id: "22222222-2222-4222-a222-222222222222",
    ticker: "MSFT",
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
  },
  {
    listing_id: "33333333-3333-4333-a333-333333333333",
    ticker: "GOOGL",
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
  },
  {
    listing_id: "44444444-4444-4444-a444-444444444444",
    ticker: "TSLA",
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
  },
  {
    listing_id: "55555555-5555-4555-a555-555555555555",
    ticker: "NVDA",
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
  },
];

type DevSnapshot = { price: number; prev_close: number };

const DEV_SNAPSHOTS: Record<string, DevSnapshot> = {
  AAPL: { price: 196.58, prev_close: 195.34 },
  MSFT: { price: 415.92, prev_close: 412.50 },
  GOOGL: { price: 178.21, prev_close: 179.05 },
  TSLA: { price: 248.40, prev_close: 252.10 },
  NVDA: { price: 142.18, prev_close: 138.55 },
};

// A polygon fetcher that returns canned snapshot payloads for known tickers.
// Routes match the real polygon API path so the adapter can run unmodified.
// The injected clock determines the snapshot's lastTrade.t — tests pass a
// fixed clock for deterministic as_of; dev passes `() => new Date()` so the
// rendered freshness reflects the live wall clock.
export function createDevPolygonFetcher(opts: { clock: () => Date }): PolygonFetcher {
  return async (path: string) => {
    const snapshotMatch = path.match(
      /^\/v2\/snapshot\/locale\/us\/markets\/stocks\/tickers\/([^?]+)/,
    );
    if (snapshotMatch) {
      const ticker = decodeURIComponent(snapshotMatch[1]);
      const snap = DEV_SNAPSHOTS[ticker];
      if (!snap) {
        throw new Error(`dev fixture: unknown ticker ${ticker}`);
      }
      const tNs = opts.clock().getTime() * 1_000_000;
      return {
        status: "OK",
        ticker: {
          lastTrade: { p: snap.price, t: tNs },
          prevDay: { c: snap.prev_close },
          market_status: "open",
        },
      };
    }
    const aggsMatch = path.match(
      /^\/v2\/aggs\/ticker\/([^/]+)\/range\/(\d+)\/(minute|hour|day)\/(\d+)\/(\d+)/,
    );
    if (aggsMatch) {
      const ticker = decodeURIComponent(aggsMatch[1]);
      const multiplier = Number(aggsMatch[2]);
      const timespan = aggsMatch[3] as "minute" | "hour" | "day";
      const startMs = Number(aggsMatch[4]);
      const endMs = Number(aggsMatch[5]);
      const snap = DEV_SNAPSHOTS[ticker];
      if (!snap) {
        throw new Error(`dev fixture: unknown ticker ${ticker}`);
      }
      return {
        adjusted: true,
        results: synthesizeAggBars({ ticker, prevClose: snap.prev_close, multiplier, timespan, startMs, endMs }),
      };
    }
    throw new Error(`dev fixture: unsupported path ${path}`);
  };
}

// Generate deterministic per-period bars for a ticker. The walk is seeded by
// the ticker so the same range yields the same bars across calls (keeps dev
// reloads stable and makes failing tests reproducible). Each bar satisfies the
// NormalizedBar invariants (low <= open,close <= high; volume non-negative).
function synthesizeAggBars(opts: {
  ticker: string;
  prevClose: number;
  multiplier: number;
  timespan: "minute" | "hour" | "day";
  startMs: number;
  endMs: number;
}): Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> {
  if (!Number.isInteger(opts.multiplier) || opts.multiplier <= 0) {
    throw new Error(
      `dev fixture: multiplier must be a positive integer (got ${opts.multiplier})`,
    );
  }
  const stepMs = periodStepMs(opts.timespan) * opts.multiplier;
  let seed = tickerSeed(opts.ticker);
  let close = opts.prevClose;
  const bars: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> = [];
  for (let t = opts.startMs; t < opts.endMs; t += stepMs) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const driftPct = ((seed % 4001) - 2000) / 100_000; // ±2.0% drift
    const open = close;
    close = round2(open * (1 + driftPct));
    const span = Math.max(0.01, Math.abs(close - open));
    const high = round2(Math.max(open, close) + span * 0.5);
    const low = round2(Math.min(open, close) - span * 0.5);
    const volume = 1_000_000 + (seed % 500_000);
    bars.push({ t, o: open, h: high, l: low, c: close, v: volume });
  }
  return bars;
}

function periodStepMs(timespan: "minute" | "hour" | "day"): number {
  switch (timespan) {
    case "minute":
      return 60_000;
    case "hour":
      return 3_600_000;
    case "day":
      return 86_400_000;
  }
}

function tickerSeed(ticker: string): number {
  let h = 2166136261;
  for (let i = 0; i < ticker.length; i++) {
    h = (h ^ ticker.charCodeAt(i)) >>> 0;
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
