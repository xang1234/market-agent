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
import { assertBarRange, normalizedBars } from "../bar.ts";
import { zonedDateParam, zonedDateStartUtcIso } from "../range-canonicalization.ts";
import { assertListingRef, type ListingSubjectRef, type UUID } from "../subject-ref.ts";

export type StooqListingContext = {
  ticker: string;
  mic?: string | null;
  currency: string;
  timezone: string;
};

export type StooqMarketDataAdapterOptions = {
  baseUrl: string;
  sourceId: UUID;
  resolveListing: (listing: ListingSubjectRef) => Promise<StooqListingContext>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  clock?: () => Date;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const SUPPORTED_US_MICS = new Set(["ARCX", "BATS", "XNYS", "XNAS"]);
const EXPECTED_HEADER = ["Date", "Open", "High", "Low", "Close", "Volume"];

export function createStooqMarketDataAdapter(
  options: StooqMarketDataAdapterOptions,
): MarketDataAdapter {
  const clock = options.clock ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    providerName: "stooq_market",
    sourceId: options.sourceId,

    async getQuote(request: QuoteRequest): Promise<MarketDataOutcome<NormalizedQuote>> {
      assertListingRef(request.listing, "getQuote.request.listing");
      return unsupported(
        request.listing,
        options.sourceId,
        clock,
        "stooq: EOD daily bars only; quotes are unsupported",
      );
    },

    async getBars(request: BarsRequest): Promise<MarketDataOutcome<NormalizedBars>> {
      assertListingRef(request.listing, "getBars.request.listing");
      assertBarRange(request.range, "getBars.request.range");

      if (request.interval !== "1d") {
        return unsupported(
          request.listing,
          options.sourceId,
          clock,
          `stooq: interval ${request.interval} is not supported; EOD daily bars only`,
        );
      }

      try {
        const ctx = await options.resolveListing(request.listing);
        const symbol = stooqSymbol(ctx);
        if (!symbol) {
          return unsupported(
            request.listing,
            options.sourceId,
            clock,
            `stooq: MIC ${ctx.mic} is not supported by the MVP Stooq adapter`,
          );
        }

        const csv = await fetchStooqCsv({
          baseUrl: options.baseUrl,
          symbol,
          range: request.range,
          timezone: ctx.timezone,
          fetchImpl,
          timeoutMs,
        });
        const bars = parseStooqCsv(csv, ctx.timezone).filter((bar) => {
          const barMs = Date.parse(bar.ts);
          return barMs >= Date.parse(request.range.start) && barMs < Date.parse(request.range.end);
        });
        if (bars.length === 0) {
          return unavailable({
            reason: "missing_coverage",
            listing: request.listing,
            source_id: options.sourceId,
            as_of: clock().toISOString(),
            retryable: false,
            detail: "stooq: empty daily bars response",
          });
        }

        return available(
          normalizedBars({
            listing: request.listing,
            interval: request.interval,
            range: request.range,
            bars,
            as_of: bars[bars.length - 1].ts,
            delay_class: "eod",
            currency: ctx.currency,
            source_id: options.sourceId,
            adjustment_basis: "split_and_div_adjusted",
          }),
        );
      } catch (error) {
        return unavailableFromError(error, request.listing, options.sourceId, clock);
      }
    },
  };
}

function stooqSymbol(ctx: StooqListingContext): string | null {
  const mic = ctx.mic?.trim().toUpperCase();
  if (!mic || !SUPPORTED_US_MICS.has(mic)) return null;
  return `${ctx.ticker.toLowerCase()}.us`;
}

async function fetchStooqCsv(input: {
  baseUrl: string;
  symbol: string;
  range: BarsRequest["range"];
  timezone: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<string> {
  const url = new URL(input.baseUrl);
  url.searchParams.set("s", input.symbol);
  url.searchParams.set("i", "d");
  url.searchParams.set("d1", zonedDateParam(Date.parse(input.range.start), input.timezone));
  url.searchParams.set("d2", zonedDateParam(Date.parse(input.range.end) - 1, input.timezone));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new StooqHttpError(response.status, `stooq: HTTP ${response.status}`);
    }
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseStooqCsv(csv: string, timezone: string): NormalizedBar[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0 || /^no data/i.test(lines[0])) return [];

  const header = lines[0].split(",");
  if (!sameHeader(header, EXPECTED_HEADER)) {
    throw new StooqPayloadError("stooq: malformed CSV header");
  }

  return lines.slice(1).map((line, index) => {
    const cells = line.split(",");
    if (cells.length !== EXPECTED_HEADER.length) {
      throw new StooqPayloadError(`stooq: malformed CSV row ${index + 1}`);
    }
    const [date, open, high, low, close, volume] = cells;
    let ts: string;
    try {
      ts = zonedDateStartUtcIso(date, timezone);
    } catch {
      throw new StooqPayloadError(`stooq: malformed CSV row ${index + 1}`);
    }
    const openValue = numberCell(open);
    const highValue = numberCell(high);
    const lowValue = numberCell(low);
    const closeValue = numberCell(close);
    const volumeValue = numberCell(volume);
    if (
      openValue === null ||
      highValue === null ||
      lowValue === null ||
      closeValue === null ||
      volumeValue === null ||
      openValue <= 0 ||
      highValue <= 0 ||
      lowValue <= 0 ||
      closeValue <= 0 ||
      highValue < lowValue ||
      highValue < openValue ||
      highValue < closeValue ||
      lowValue > openValue ||
      lowValue > closeValue
    ) {
      throw new StooqPayloadError(`stooq: malformed CSV row ${index + 1}`);
    }
    return {
      ts,
      open: openValue,
      high: highValue,
      low: lowValue,
      close: closeValue,
      volume: volumeValue,
    };
  });
}

function sameHeader(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((value, index) => actual[index] === value);
}

function numberCell(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function unsupported(
  listing: ListingSubjectRef,
  sourceId: UUID,
  clock: () => Date,
  detail: string,
): MarketDataOutcome<never> {
  return unavailable({
    reason: "missing_coverage",
    listing,
    source_id: sourceId,
    as_of: clock().toISOString(),
    retryable: false,
    detail,
  });
}

function unavailableFromError(
  error: unknown,
  listing: ListingSubjectRef,
  sourceId: UUID,
  clock: () => Date,
): MarketDataOutcome<never> {
  if (error instanceof StooqHttpError) {
    return unavailable({
      reason: reasonForHttpStatus(error.status),
      listing,
      source_id: sourceId,
      as_of: clock().toISOString(),
      retryable: error.status === 429 || (error.status >= 500 && error.status < 600),
      detail: error.message,
    });
  }
  if (error instanceof StooqPayloadError) {
    return unavailable({
      reason: "provider_error",
      listing,
      source_id: sourceId,
      as_of: clock().toISOString(),
      retryable: false,
      detail: error.message,
    });
  }
  return unavailable({
    reason: "provider_error",
    listing,
    source_id: sourceId,
    as_of: clock().toISOString(),
    retryable: !(error instanceof Error && error.name === "AbortError"),
    detail: error instanceof Error ? `stooq: ${error.message}` : "stooq: unknown error",
  });
}

function reasonForHttpStatus(status: number): AvailabilityReason {
  if (status === 404) return "missing_coverage";
  if (status === 429) return "rate_limited";
  return "provider_error";
}

class StooqHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StooqHttpError";
    this.status = status;
  }
}

class StooqPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StooqPayloadError";
  }
}
