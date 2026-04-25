import type {
  BarsRequest,
  MarketDataAdapter,
  MarketDataOutcome,
  NormalizedBar,
  NormalizedBars,
  NormalizedQuote,
  QuoteRequest,
} from "../adapter.ts";
import { available, unavailable, type AvailabilityReason } from "../availability.ts";
import { assertBarRange, normalizedBars, type AdjustmentBasis, type BarInterval } from "../bar.ts";
import { DELAY_CLASSES, normalizedQuote, type DelayClass, type SessionState } from "../quote.ts";
import type { ListingSubjectRef, UUID } from "../subject-ref.ts";
import { assertOneOf } from "../validators.ts";

export type PolygonListingContext = {
  ticker: string;
  mic: string;
  currency: string;
};

export type PolygonFetcher = (path: string) => Promise<unknown>;

export type PolygonAdapterDeps = {
  sourceId: UUID;
  delayClass: DelayClass;
  fetcher: PolygonFetcher;
  resolveListing: (listing: ListingSubjectRef) => Promise<PolygonListingContext>;
  // Optional clock for the `as_of` timestamp on unavailable envelopes; defaults
  // to wall-clock time. Tests inject a fixed clock for deterministic outputs.
  clock?: () => Date;
};

// Fetcher implementations should throw a PolygonFetchError when an HTTP-layer
// failure occurs so the adapter can classify the outcome by status code rather
// than guessing from a generic Error message.
export class PolygonFetchError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PolygonFetchError";
    this.status = status;
  }
}

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
  next_url?: string;
};

const INTERVAL_TO_POLYGON: Record<BarInterval, { multiplier: number; timespan: string }> = {
  "1m": { multiplier: 1, timespan: "minute" },
  "5m": { multiplier: 5, timespan: "minute" },
  "15m": { multiplier: 15, timespan: "minute" },
  "1h": { multiplier: 1, timespan: "hour" },
  "1d": { multiplier: 1, timespan: "day" },
};

export function createPolygonAdapter(deps: PolygonAdapterDeps): MarketDataAdapter {
  assertOneOf(deps.delayClass, DELAY_CLASSES, "polygon.delayClass");
  const clock = deps.clock ?? (() => new Date());

  const wrapUnavailable = (
    listing: ListingSubjectRef,
    err: unknown,
  ): MarketDataOutcome<never> => {
    const classified = classifyError(err);
    return unavailable({
      reason: classified.reason,
      listing,
      source_id: deps.sourceId,
      as_of: clock().toISOString(),
      retryable: classified.retryable,
      detail: classified.detail,
    });
  };

  return {
    providerName: "polygon",
    sourceId: deps.sourceId,

    async getQuote(request: QuoteRequest): Promise<MarketDataOutcome<NormalizedQuote>> {
      try {
        const ctx = await deps.resolveListing(request.listing);
        const path = `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ctx.ticker)}`;
        const raw = (await deps.fetcher(path)) as PolygonSnapshotPayload;

        const price = raw?.ticker?.lastTrade?.p;
        const tNs = raw?.ticker?.lastTrade?.t;
        const prevClose = raw?.ticker?.prevDay?.c;

        if (typeof price !== "number" || typeof tNs !== "number") {
          throw new MalformedPayloadError("snapshot.lastTrade missing price or timestamp");
        }
        if (typeof prevClose !== "number") {
          throw new MalformedPayloadError("snapshot.prevDay.c missing — cannot compute change");
        }

        const as_of = new Date(Math.floor(tNs / 1_000_000)).toISOString();

        return available(
          normalizedQuote({
            listing: request.listing,
            price,
            prev_close: prevClose,
            session_state: classifySession(raw?.ticker?.market_status, as_of),
            as_of,
            delay_class: deps.delayClass,
            currency: ctx.currency,
            source_id: deps.sourceId,
          }),
        );
      } catch (err) {
        return wrapUnavailable(request.listing, err);
      }
    },

    async getBars(request: BarsRequest): Promise<MarketDataOutcome<NormalizedBars>> {
      // Pre-fetch validation runs before the try/catch so caller-side bugs
      // (malformed range) surface as exceptions rather than masquerading as
      // provider unavailability.
      assertBarRange(request.range, "getBars.request.range");

      try {
        const ctx = await deps.resolveListing(request.listing);
        const tspec = INTERVAL_TO_POLYGON[request.interval];
        const startMs = Date.parse(request.range.start);
        const endMs = Date.parse(request.range.end);

        const path =
          `/v2/aggs/ticker/${encodeURIComponent(ctx.ticker)}/range/` +
          `${tspec.multiplier}/${tspec.timespan}/${startMs}/${endMs}` +
          `?adjusted=true&sort=asc&limit=50000`;
        const pages = await fetchAggPages(deps.fetcher, path);

        const rawBars = pages.flatMap((page) => page.results ?? []);
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
            throw new MalformedPayloadError(`aggs row ${i} missing OHLCV field`);
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

        const adjustment_basis = aggregateAdjustmentBasis(pages);
        const asOf = bars.length > 0 ? bars[bars.length - 1].ts : request.range.end;

        return available(
          normalizedBars({
            listing: request.listing,
            interval: request.interval,
            range: request.range,
            bars,
            as_of: asOf,
            delay_class: deps.delayClass,
            currency: ctx.currency,
            source_id: deps.sourceId,
            adjustment_basis,
          }),
        );
      } catch (err) {
        return wrapUnavailable(request.listing, err);
      }
    },
  };
}

// Internal sentinel for "200 OK but the payload is missing required fields."
// Classified as a non-retryable provider_error since retrying produces the
// same broken response.
class MalformedPayloadError extends Error {
  constructor(message: string) {
    super(`polygon: ${message}`);
    this.name = "MalformedPayloadError";
  }
}

type ClassifiedError = {
  reason: AvailabilityReason;
  retryable: boolean;
  detail: string;
};

function classifyError(err: unknown): ClassifiedError {
  if (err instanceof PolygonFetchError) {
    if (err.status === 404) {
      return { reason: "missing_coverage", retryable: false, detail: `polygon: ${err.message}` };
    }
    if (err.status === 429) {
      return { reason: "rate_limited", retryable: true, detail: `polygon: ${err.message}` };
    }
    if (err.status >= 500 && err.status < 600) {
      return { reason: "provider_error", retryable: true, detail: `polygon: ${err.message}` };
    }
    // Other 4xx responses are caller misconfiguration (auth, bad request).
    // Surface as provider_error but mark non-retryable so we don't loop on
    // a deterministic failure.
    return { reason: "provider_error", retryable: false, detail: `polygon: ${err.message}` };
  }
  if (err instanceof MalformedPayloadError) {
    return { reason: "provider_error", retryable: false, detail: err.message };
  }
  if (err instanceof Error) {
    // Unknown provider-side or fetcher errors (e.g., network failure thrown
    // without a status). Allow retry — caller can decide whether to backoff.
    return { reason: "provider_error", retryable: true, detail: `polygon: ${err.message}` };
  }
  return { reason: "provider_error", retryable: false, detail: "polygon: unknown error" };
}

async function fetchAggPages(fetcher: PolygonFetcher, firstPath: string): Promise<PolygonAggsPayload[]> {
  const pages: PolygonAggsPayload[] = [];
  const seen = new Set<string>();
  let nextPath: string | undefined = firstPath;

  while (nextPath) {
    if (seen.has(nextPath)) {
      throw new MalformedPayloadError(`aggregate pagination loop detected for ${nextPath}`);
    }
    seen.add(nextPath);

    const page = (await fetcher(nextPath)) as PolygonAggsPayload;
    pages.push(page);
    nextPath = typeof page.next_url === "string" && page.next_url.length > 0
      ? page.next_url
      : undefined;
  }

  return pages;
}

function aggregateAdjustmentBasis(pages: PolygonAggsPayload[]): AdjustmentBasis {
  let first: boolean | undefined;
  for (const page of pages) {
    if (typeof page.adjusted !== "boolean") continue;
    if (first === undefined) {
      first = page.adjusted;
    } else if (page.adjusted !== first) {
      throw new MalformedPayloadError("inconsistent aggregate adjusted flags across pages");
    }
  }
  if (first === undefined) {
    // We always send `?adjusted=true`, so a missing flag in the response means
    // we can't confirm whether values were adjusted. Surfacing as malformed
    // (vs. silently defaulting to "unadjusted") prevents misclassified series.
    throw new MalformedPayloadError("aggregate response missing adjusted flag");
  }
  return first ? "split_and_div_adjusted" : "unadjusted";
}

// Polygon's `market_status` values: open, closed, early_hours, late_hours, extended-hours.
function classifySession(status: string | undefined, asOf: string): SessionState {
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
      return classifyUsEquitySession(asOf);
  }
}

function classifyUsEquitySession(asOf: string): SessionState {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(asOf));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const weekday = byType.get("weekday");
  const hour = Number(byType.get("hour"));
  const minute = Number(byType.get("minute"));

  if (weekday === "Sat" || weekday === "Sun" || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return "closed";
  }

  const minutes = hour * 60 + minute;
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "pre_market";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "regular";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "post_market";
  return "closed";
}
