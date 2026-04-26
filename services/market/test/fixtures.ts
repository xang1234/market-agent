import type { PolygonFetcher } from "../src/adapters/polygon.ts";
import type { ListingSubjectRef } from "../src/subject-ref.ts";

export const aaplListing: ListingSubjectRef = {
  kind: "listing",
  id: "11111111-1111-4111-a111-111111111111",
};

export const msftListing: ListingSubjectRef = {
  kind: "listing",
  id: "33333333-3333-4333-a333-333333333333",
};

export const aaplCtx = { ticker: "AAPL", mic: "XNAS", currency: "USD" };

export const POLYGON_SOURCE_ID = "00000000-0000-4000-a000-000000000001";
export const FIXTURE_SOURCE_ID = "00000000-0000-4000-a000-0000000000ff";
export const POLYGON_DELAY_CLASS = "delayed_15m" as const;

export const SNAPSHOT_PATH = "/v2/snapshot/locale/us/markets/stocks/tickers/AAPL";

export function makeRouteFetcher(routes: Record<string, unknown>): PolygonFetcher {
  return async (path: string) => {
    if (!(path in routes)) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return routes[path];
  };
}

export function aaplSnapshotPayload(opts: {
  status?: string;
  price?: number;
  prevClose?: number;
  marketStatus?: string | null;
  tNs?: number;
} = {}): unknown {
  return {
    status: opts.status ?? "OK",
    ticker: {
      lastTrade: {
        p: opts.price ?? 187.42,
        t: opts.tNs ?? Date.parse("2026-04-22T14:00:00.000Z") * 1_000_000,
      },
      prevDay: { c: opts.prevClose ?? 185.0 },
      ...(opts.marketStatus === null ? {} : { market_status: opts.marketStatus ?? "open" }),
    },
  };
}

const DAY_1 = 1_700_006_400_000;
const DAY_2 = 1_700_092_800_000;
const DAY_3 = 1_700_179_200_000;

export const aaplBarRange = {
  start: new Date(DAY_1).toISOString(),
  end: new Date(DAY_3).toISOString(),
};

// Polygon's aggs request param is hardcoded to `adjusted=true` in the adapter;
// adjusted-vs-unadjusted distinctions live in the response body, not the path.
export function aaplAggsPath(): string {
  const startMs = Date.parse(aaplBarRange.start);
  const endMs = Date.parse(aaplBarRange.end);
  return `/v2/aggs/ticker/AAPL/range/1/day/${startMs}/${endMs}?adjusted=true&sort=asc&limit=50000`;
}

export function aaplAggsPayload(opts: { adjusted?: boolean } = {}): unknown {
  return {
    adjusted: opts.adjusted ?? true,
    resultsCount: 2,
    results: [
      { t: DAY_1, o: 100, h: 101, l: 99, c: 100.5, v: 10_000 },
      { t: DAY_2, o: 100.5, h: 102, l: 100.4, c: 101.7, v: 12_000 },
    ],
  };
}
