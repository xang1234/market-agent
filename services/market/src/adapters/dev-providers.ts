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
import { assertBarRange, normalizedBars, type AdjustmentBasis } from "../bar.ts";
import { normalizedQuote, type DelayClass, type SessionState } from "../quote.ts";
import { assertListingRef, type ListingSubjectRef, type UUID } from "../subject-ref.ts";

export type DevProvidersListingContext = {
  ticker: string;
  mic: string;
  currency: string;
  timezone: string;
};

export type DevProvidersMarketDataAdapterOptions = {
  baseUrl: string;
  sourceId: UUID;
  resolveListing: (listing: ListingSubjectRef) => Promise<DevProvidersListingContext>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  clock?: () => Date;
};

type SidecarEnvelope =
  | {
      status: "available";
      data?: unknown;
    }
  | {
      status: "unavailable";
      reason?: unknown;
      retryable?: unknown;
      detail?: unknown;
    };

type SidecarQuote = {
  price?: unknown;
  prev_close?: unknown;
  session_state?: unknown;
  as_of?: unknown;
  delay_class?: unknown;
  currency?: unknown;
};

type SidecarBars = {
  bars?: unknown;
  as_of?: unknown;
  delay_class?: unknown;
  currency?: unknown;
  adjustment_basis?: unknown;
};

const DEFAULT_TIMEOUT_MS = 5_000;

export function createDevProvidersMarketDataAdapter(
  options: DevProvidersMarketDataAdapterOptions,
): MarketDataAdapter {
  const clock = options.clock ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    providerName: "yahoo_finance_dev_market",
    sourceId: options.sourceId,

    async getQuote(request: QuoteRequest): Promise<MarketDataOutcome<NormalizedQuote>> {
      assertListingRef(request.listing, "getQuote.request.listing");

      try {
        const ctx = await options.resolveListing(request.listing);
        const envelope = await postSidecar({
          baseUrl: options.baseUrl,
          path: "/market/quote",
          body: sidecarListingBody(request.listing, ctx),
          fetchImpl,
          timeoutMs,
        });
        if (envelope.status === "unavailable") {
          return unavailableFromSidecar(envelope, request.listing, options.sourceId, clock);
        }
        const data = sidecarQuoteData(envelope.data);
        if (!data) {
          return providerError(request.listing, options.sourceId, clock, "yfinance: malformed quote payload", false);
        }
        return available(
          normalizedQuote({
            listing: request.listing,
            price: data.price,
            prev_close: data.prev_close,
            session_state: data.session_state,
            as_of: data.as_of,
            delay_class: data.delay_class,
            currency: data.currency ?? ctx.currency,
            source_id: options.sourceId,
          }),
        );
      } catch (error) {
        return unavailableFromError(error, request.listing, options.sourceId, clock);
      }
    },

    async getBars(request: BarsRequest): Promise<MarketDataOutcome<NormalizedBars>> {
      assertListingRef(request.listing, "getBars.request.listing");
      assertBarRange(request.range, "getBars.request.range");

      if (request.interval !== "1d") {
        return unavailable({
          reason: "missing_coverage",
          listing: request.listing,
          source_id: options.sourceId,
          as_of: clock().toISOString(),
          retryable: false,
          detail: `yfinance: interval ${request.interval} is not enabled for dev fallback`,
        });
      }

      try {
        const ctx = await options.resolveListing(request.listing);
        const envelope = await postSidecar({
          baseUrl: options.baseUrl,
          path: "/market/daily-bars",
          body: {
            ...sidecarListingBody(request.listing, ctx),
            interval: request.interval,
            range: request.range,
          },
          fetchImpl,
          timeoutMs,
        });
        if (envelope.status === "unavailable") {
          return unavailableFromSidecar(envelope, request.listing, options.sourceId, clock);
        }
        const data = sidecarBarsData(envelope.data);
        if (!data) {
          return providerError(request.listing, options.sourceId, clock, "yfinance: malformed bars payload", false);
        }
        return available(
          normalizedBars({
            listing: request.listing,
            interval: request.interval,
            range: request.range,
            bars: data.bars,
            as_of: data.as_of,
            delay_class: data.delay_class,
            currency: data.currency ?? ctx.currency,
            source_id: options.sourceId,
            adjustment_basis: data.adjustment_basis,
          }),
        );
      } catch (error) {
        return unavailableFromError(error, request.listing, options.sourceId, clock);
      }
    },
  };
}

function sidecarListingBody(listing: ListingSubjectRef, ctx: DevProvidersListingContext): Record<string, unknown> {
  return {
    listing,
    ticker: ctx.ticker,
    mic: ctx.mic,
    currency: ctx.currency,
    timezone: ctx.timezone,
  };
}

async function postSidecar(input: {
  baseUrl: string;
  path: string;
  body: unknown;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<SidecarEnvelope> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(new URL(input.path, input.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new HttpError(response.status, `yfinance sidecar HTTP ${response.status}`);
    }
    const envelope = (await response.json()) as SidecarEnvelope;
    if (envelope.status !== "available" && envelope.status !== "unavailable") {
      throw new Error("yfinance sidecar malformed availability envelope");
    }
    return envelope;
  } finally {
    clearTimeout(timeout);
  }
}

function unavailableFromSidecar(
  envelope: Extract<SidecarEnvelope, { status: "unavailable" }>,
  listing: ListingSubjectRef,
  sourceId: UUID,
  clock: () => Date,
): MarketDataOutcome<never> {
  return unavailable({
    reason: availabilityReason(envelope.reason),
    listing,
    source_id: sourceId,
    as_of: clock().toISOString(),
    retryable: typeof envelope.retryable === "boolean" ? envelope.retryable : false,
    detail: typeof envelope.detail === "string" ? envelope.detail : undefined,
  });
}

function unavailableFromError(
  error: unknown,
  listing: ListingSubjectRef,
  sourceId: UUID,
  clock: () => Date,
): MarketDataOutcome<never> {
  if (error instanceof HttpError) {
    const retryable = error.status === 429 || (error.status >= 500 && error.status < 600);
    const reason: AvailabilityReason =
      error.status === 404 ? "missing_coverage" : error.status === 429 ? "rate_limited" : "provider_error";
    return unavailable({
      reason,
      listing,
      source_id: sourceId,
      as_of: clock().toISOString(),
      retryable,
      detail: error.message,
    });
  }
  return providerError(
    listing,
    sourceId,
    clock,
    error instanceof Error ? `yfinance: ${error.message}` : "yfinance: unknown error",
    true,
  );
}

function providerError(
  listing: ListingSubjectRef,
  sourceId: UUID,
  clock: () => Date,
  detail: string,
  retryable: boolean,
): MarketDataOutcome<never> {
  return unavailable({
    reason: "provider_error",
    listing,
    source_id: sourceId,
    as_of: clock().toISOString(),
    retryable,
    detail,
  });
}

function sidecarQuoteData(value: unknown): {
  price: number;
  prev_close: number;
  session_state: SessionState;
  as_of: string;
  delay_class: DelayClass;
  currency: string | null;
} | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as SidecarQuote;
  const price = numberValue(data.price);
  const prevClose = numberValue(data.prev_close);
  const sessionState = stringValue(data.session_state) as SessionState | null;
  const asOf = stringValue(data.as_of);
  const delayClass = stringValue(data.delay_class) as DelayClass | null;
  const currency = stringValue(data.currency);
  if (price === null || prevClose === null || sessionState === null || asOf === null || delayClass === null) {
    return null;
  }
  return {
    price,
    prev_close: prevClose,
    session_state: sessionState,
    as_of: asOf,
    delay_class: delayClass,
    currency,
  };
}

function sidecarBarsData(value: unknown): {
  bars: NormalizedBar[];
  as_of: string;
  delay_class: DelayClass;
  currency: string | null;
  adjustment_basis: AdjustmentBasis;
} | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as SidecarBars;
  if (!Array.isArray(data.bars)) return null;
  const bars = data.bars.flatMap((bar) => {
    const normalized = sidecarBarData(bar);
    return normalized ? [normalized] : [];
  });
  if (bars.length !== data.bars.length) return null;
  const asOf = stringValue(data.as_of);
  const delayClass = stringValue(data.delay_class) as DelayClass | null;
  const adjustmentBasis = stringValue(data.adjustment_basis) as AdjustmentBasis | null;
  if (asOf === null || delayClass === null || adjustmentBasis === null) return null;
  return {
    bars,
    as_of: asOf,
    delay_class: delayClass,
    currency: stringValue(data.currency),
    adjustment_basis: adjustmentBasis,
  };
}

function sidecarBarData(value: unknown): NormalizedBar | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const ts = stringValue(row.ts);
  const open = numberValue(row.open);
  const high = numberValue(row.high);
  const low = numberValue(row.low);
  const close = numberValue(row.close);
  const volume = numberValue(row.volume);
  if (ts === null || open === null || high === null || low === null || close === null || volume === null) {
    return null;
  }
  return { ts, open, high, low, close, volume };
}

function availabilityReason(value: unknown): AvailabilityReason {
  if (value === "missing_coverage" || value === "rate_limited" || value === "stale_data") return value;
  return "provider_error";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}
