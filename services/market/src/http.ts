import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type MarketDataAdapter } from "./adapter.ts";
import { isAvailable, unavailable, type MarketDataOutcome, type UnavailableEnvelope } from "./availability.ts";
import type { NormalizedBars } from "./bar.ts";
import { ListingNotFoundError, type ListingRepository, type ListingRecord } from "./listings.ts";
import type { NormalizedQuote } from "./quote.ts";
import {
  assertSeriesQueryContract,
  type NormalizedSeriesQuery,
} from "./series-query.ts";
import type { ListingSubjectRef } from "./subject-ref.ts";
import { isUuidV4 } from "./validators.ts";

export type MarketServerDeps = {
  adapter: MarketDataAdapter;
  listings: ListingRepository;
  // Optional clock used when synthesizing per-listing unavailable envelopes
  // (e.g., basis mismatch, missing listing). Defaults to wall-clock; tests
  // pin a fixed clock for deterministic envelopes.
  clock?: () => Date;
};

// HTTP shape for /v1/market/quote — the spec NormalizedQuote (provider-neutral
// market data) plus the listing display context the row/landing surfaces need
// to render without a separate hydration call.
export type GetQuoteResponse = {
  quote: NormalizedQuote;
  listing_context: {
    ticker: string;
    mic: string;
    timezone: string;
  };
};

// HTTP shape for /v1/market/series. Per-listing outcome envelopes ride inside
// a 200 because a multi-subject query can have mixed availability — collapsing
// N outcomes into one HTTP status would lose information. Top-level HTTP
// status reflects query-level validity (200 / 400 / 404), not the success of
// any one fan-out leg.
export type SeriesResultEntry = {
  listing: ListingSubjectRef;
  outcome: MarketDataOutcome<NormalizedBars>;
};

export type GetSeriesResponse = {
  query: NormalizedSeriesQuery;
  results: ReadonlyArray<SeriesResultEntry>;
};

const MAX_SERIES_BODY_BYTES = 64 * 1024;

export function createMarketServer(deps: MarketServerDeps): Server {
  const clock = deps.clock ?? (() => new Date());

  return createServer(async (req, res) => {
    try {
      const route = matchRoute(req.method ?? "GET", req.url ?? "/");
      if (!route) {
        respond(res, 404, { error: "not found" });
        return;
      }

      switch (route.action) {
        case "healthz":
          respond(res, 200, { status: "ok", service: "market" });
          return;
        case "get_quote": {
          const record = await deps.listings.find(route.subject_id);
          if (!record) {
            respond(res, 404, { error: `listing not found: ${route.subject_id}` });
            return;
          }
          const quote = await deps.adapter.getQuote({
            listing: { kind: "listing", id: route.subject_id },
          });
          if (!isAvailable(quote)) {
            respond(res, statusForUnavailable(quote), {
              error: "market quote unavailable",
              unavailable: quote,
              listing_context: listingContext(record),
            });
            return;
          }
          const response: GetQuoteResponse = {
            quote: quote.data,
            listing_context: listingContext(record),
          };
          respond(res, 200, response);
          return;
        }
        case "get_series": {
          const body = await readJsonBody(req, MAX_SERIES_BODY_BYTES);
          if (body.kind === "error") {
            respond(res, body.status, { error: body.error });
            return;
          }
          let query: NormalizedSeriesQuery;
          try {
            assertSeriesQueryContract(body.value);
            query = body.value;
          } catch (err) {
            respond(res, 400, { error: errorMessage(err, "invalid series query") });
            return;
          }
          if (query.normalization !== "raw") {
            respond(res, 400, {
              error:
                `unsupported normalization "${query.normalization}": only "raw" is wired in this service today. ` +
                `The in-snapshot transform gate covers the others.`,
            });
            return;
          }

          const results = await Promise.all(
            query.subject_refs.map((listing) =>
              fanOutOne(deps, clock, query, listing),
            ),
          );
          const response: GetSeriesResponse = { query, results };
          respond(res, 200, response);
          return;
        }
        default: {
          // Exhaustiveness: adding a Route variant without a handler is a
          // compile-time error here, not a silent hang at runtime.
          const _exhaustive: never = route;
          void _exhaustive;
          respond(res, 500, { error: "unhandled route" });
          return;
        }
      }
    } catch (error) {
      if (error instanceof ListingNotFoundError) {
        if (!res.headersSent) respond(res, 404, { error: error.message });
        return;
      }
      console.error("market request failed", error);
      if (!res.headersSent) respond(res, 502, { error: "upstream market data unavailable" });
    }
  });
}

type Route =
  | { action: "healthz" }
  | { action: "get_quote"; subject_id: string }
  | { action: "get_series" };

function matchRoute(method: string, rawUrl: string): Route | null {
  const url = new URL(rawUrl, "http://localhost");
  const { pathname, searchParams } = url;

  if (method === "GET" && pathname === "/healthz") return { action: "healthz" };

  if (method === "GET" && pathname === "/v1/market/quote") {
    const subjectKind = searchParams.get("subject_kind");
    const subjectId = searchParams.get("subject_id");
    if (subjectKind !== "listing") return null;
    if (!isUuidV4(subjectId)) return null;
    return { action: "get_quote", subject_id: subjectId };
  }

  if (method === "POST" && pathname === "/v1/market/series") {
    return { action: "get_series" };
  }

  return null;
}

function listingContext(record: ListingRecord): GetQuoteResponse["listing_context"] {
  return {
    ticker: record.ticker,
    mic: record.mic,
    timezone: record.timezone,
  };
}

function statusForUnavailable(unavailable: UnavailableEnvelope): number {
  switch (unavailable.reason) {
    case "missing_coverage":
      return 404;
    case "rate_limited":
      return 429;
    case "provider_error":
      return 502;
    case "stale_data":
      return 503;
  }
}

function respond(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

// One fan-out leg of the series request: validate listing identity against the
// repo (so a typo yields `missing_coverage`, not a generic provider_error from
// the adapter), call getBars, then enforce the basis-binding rule. A bars
// response whose adjustment_basis disagrees with the requested binding is
// reclassified as missing_coverage rather than returned under the wrong label.
async function fanOutOne(
  deps: MarketServerDeps,
  clock: () => Date,
  query: NormalizedSeriesQuery,
  listing: ListingSubjectRef,
): Promise<SeriesResultEntry> {
  const record = await deps.listings.find(listing.id);
  if (!record) {
    return {
      listing,
      outcome: unavailable({
        reason: "missing_coverage",
        listing,
        source_id: deps.adapter.sourceId,
        as_of: clock().toISOString(),
        retryable: false,
        detail: `listing not found: ${listing.id}`,
      }),
    };
  }

  const outcome = await deps.adapter.getBars({
    listing,
    interval: query.interval,
    range: query.range,
  });

  if (isAvailable(outcome) && outcome.data.adjustment_basis !== query.basis) {
    return {
      listing,
      outcome: unavailable({
        reason: "missing_coverage",
        listing,
        source_id: outcome.data.source_id,
        as_of: outcome.data.as_of,
        retryable: false,
        detail:
          `adapter returned adjustment_basis="${outcome.data.adjustment_basis}" but query bound basis="${query.basis}"`,
      }),
    };
  }

  return { listing, outcome };
}

type JsonBodyResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; status: number; error: string };

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<JsonBodyResult> {
  const contentType = (req.headers["content-type"] ?? "").toString().toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return { kind: "error", status: 415, error: "content-type must be application/json" };
  }

  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.byteLength;
    if (total > maxBytes) {
      return { kind: "error", status: 413, error: `request body exceeds ${maxBytes} bytes` };
    }
    chunks.push(buf);
  }

  if (total === 0) {
    return { kind: "error", status: 400, error: "request body is empty" };
  }

  const text = Buffer.concat(chunks, total).toString("utf8");
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch (err) {
    return { kind: "error", status: 400, error: `invalid JSON: ${errorMessage(err, "parse failed")}` };
  }
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  if (typeof err === "string" && err.length > 0) return err;
  return fallback;
}
