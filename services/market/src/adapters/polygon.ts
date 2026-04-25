import type {
  AdjustmentBasis,
  BarInterval,
  BarsRequest,
  MarketDataAdapter,
  NormalizedBar,
  NormalizedBars,
  NormalizedQuote,
  QuoteRequest,
} from "../adapter.ts";
import { normalizedQuote, type DelayClass, type SessionState } from "../quote.ts";
import type { ListingSubjectRef, UUID } from "../subject-ref.ts";

// Polygon adapter. Translates Polygon's REST shapes into the provider-neutral
// records defined in ../adapter.ts and ../quote.ts. No Polygon-typed fields
// escape this file.
//
// Quote retrieval uses Polygon's snapshot endpoint, which returns latest trade
// + previous-day close in one call so the move math (`change_abs`,
// `change_pct`) can be derived without a second hop. The smart constructor in
// ../quote.ts validates every field; a malformed Polygon payload throws here.

export type PolygonListingContext = {
  ticker: string;
  mic: string;
  currency: string;
};

export type PolygonFetcher = (path: string) => Promise<unknown>;

export type PolygonAdapterDeps = {
  sourceId: UUID;
  fetcher: PolygonFetcher;
  resolveListing: (listing: ListingSubjectRef) => Promise<PolygonListingContext>;
};

// Polygon snapshot, abridged to the fields we consume. Treated as `unknown` at
// the boundary and validated explicitly so a malformed payload raises here
// instead of letting NaN flow through the smart constructor.
type PolygonSnapshotPayload = {
  status?: string;
  ticker?: {
    lastTrade?: {
      p?: number;
      t?: number; // nanoseconds since epoch
    };
    day?: {
      c?: number;
    };
    prevDay?: {
      c?: number;
    };
    market_status?: string;
    updated?: number;
  };
};

type PolygonAggsPayload = {
  results?: Array<{
    t?: number;
    o?: number;
    h?: number;
    l?: number;
    c?: number;
    v?: number;
  }>;
  resultsCount?: number;
  adjusted?: boolean;
};

const INTERVAL_TO_POLYGON: Record<BarInterval, { multiplier: number; timespan: string }> = {
  "1m": { multiplier: 1, timespan: "minute" },
  "5m": { multiplier: 5, timespan: "minute" },
  "15m": { multiplier: 15, timespan: "minute" },
  "1h": { multiplier: 1, timespan: "hour" },
  "1d": { multiplier: 1, timespan: "day" },
};

export function createPolygonAdapter(deps: PolygonAdapterDeps): MarketDataAdapter {
  return {
    providerName: "polygon",
    sourceId: deps.sourceId,

    async getQuote(request: QuoteRequest): Promise<NormalizedQuote> {
      const ctx = await deps.resolveListing(request.listing);
      const path = `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ctx.ticker)}`;
      const raw = (await deps.fetcher(path)) as PolygonSnapshotPayload;

      const price = raw?.ticker?.lastTrade?.p;
      const tNs = raw?.ticker?.lastTrade?.t;
      const prevClose = raw?.ticker?.prevDay?.c;

      if (typeof price !== "number" || typeof tNs !== "number") {
        throw new Error("polygon: snapshot.lastTrade missing price or timestamp");
      }
      if (typeof prevClose !== "number") {
        throw new Error("polygon: snapshot.prevDay.c missing — cannot compute change");
      }

      // Polygon last-trade timestamps are nanoseconds since epoch.
      const as_of = new Date(Math.floor(tNs / 1_000_000)).toISOString();

      return normalizedQuote({
        listing: request.listing,
        price,
        prev_close: prevClose,
        session_state: classifySession(raw?.ticker?.market_status),
        as_of,
        delay_class: classifyDelay(raw?.status),
        currency: ctx.currency,
        source_id: deps.sourceId,
      });
    },

    async getBars(request: BarsRequest): Promise<NormalizedBars> {
      const ctx = await deps.resolveListing(request.listing);
      const tspec = INTERVAL_TO_POLYGON[request.interval];
      const startMs = Date.parse(request.range.start);
      const endMs = Date.parse(request.range.end);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        throw new Error("polygon: bar range start/end must be ISO-8601 timestamps");
      }

      const path =
        `/v2/aggs/ticker/${encodeURIComponent(ctx.ticker)}/range/` +
        `${tspec.multiplier}/${tspec.timespan}/${startMs}/${endMs}` +
        `?adjusted=true`;
      const raw = (await deps.fetcher(path)) as PolygonAggsPayload;

      const rawBars = raw?.results ?? [];
      const bars: NormalizedBar[] = rawBars.map((row, i) => {
        const { t, o, h, l, c, v } = row;
        if (
          typeof t !== "number" ||
          typeof o !== "number" ||
          typeof h !== "number" ||
          typeof l !== "number" ||
          typeof c !== "number" ||
          typeof v !== "number"
        ) {
          throw new Error(`polygon: aggs row ${i} missing OHLCV field`);
        }
        return {
          ts: new Date(t).toISOString(),
          open: o,
          high: h,
          low: l,
          close: c,
          volume: v,
        };
      });

      // Bar-level invariants land in fra-cw0.1.3; for now the adapter just
      // preserves provider order and surfaces the adjustment basis flag.
      const adjustment_basis: AdjustmentBasis = raw?.adjusted === true
        ? "split_and_div_adjusted"
        : "unadjusted";

      const asOf = bars.length > 0 ? bars[bars.length - 1].ts : request.range.end;

      return {
        listing: request.listing,
        interval: request.interval,
        range: request.range,
        bars,
        as_of: asOf,
        delay_class: "eod",
        currency: ctx.currency,
        source_id: deps.sourceId,
        adjustment_basis,
      };
    },
  };
}

function classifyDelay(status: string | undefined): DelayClass {
  // Polygon free tier returns DELAYED status; paid Stocks Starter+ returns OK.
  if (status === "OK") return "real_time";
  if (status === "DELAYED") return "delayed_15m";
  return "unknown";
}

// Polygon's snapshot endpoint exposes `market_status` as one of:
// "open" | "closed" | "early_hours" | "late_hours" | "extended-hours".
// Map vendor strings to our internal SessionState enum. Venue-specific session
// boundaries (e.g. RTH vs ETH for non-US listings) are out of scope for this
// adapter; cross-venue session handling lives in the bar contract subtask
// (fra-cw0.1.3) where it actually matters.
function classifySession(status: string | undefined): SessionState {
  switch (status) {
    case "open":
      return "regular";
    case "early_hours":
      return "pre_market";
    case "late_hours":
    case "extended-hours":
      return "post_market";
    case "closed":
      return "closed";
    default:
      return "regular";
  }
}
