import { createServer, type Server, type ServerResponse } from "node:http";
import { isAvailable, type MarketDataAdapter } from "./adapter.ts";
import type { UnavailableEnvelope } from "./availability.ts";
import { ListingNotFoundError, type ListingRepository, type ListingRecord } from "./listings.ts";
import type { NormalizedQuote } from "./quote.ts";
import { isUuidV4 } from "./validators.ts";

export type MarketServerDeps = {
  adapter: MarketDataAdapter;
  listings: ListingRepository;
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

export function createMarketServer(deps: MarketServerDeps): Server {
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
  | { action: "get_quote"; subject_id: string };

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
