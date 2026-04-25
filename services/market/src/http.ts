import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { MarketDataAdapter } from "./adapter.ts";
import { ListingNotFoundError, type ListingRepository, type ListingRecord } from "./listings.ts";
import type { NormalizedQuote } from "./quote.ts";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

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

      if (route.action === "healthz") {
        respond(res, 200, { status: "ok", service: "market" });
        return;
      }

      if (route.action === "get_quote") {
        const record = await deps.listings.find(route.subject_id);
        if (!record) {
          respond(res, 404, { error: `listing not found: ${route.subject_id}` });
          return;
        }

        const quote = await deps.adapter.getQuote({
          listing: { kind: "listing", id: route.subject_id },
        });
        const response: GetQuoteResponse = {
          quote,
          listing_context: listingContext(record),
        };
        respond(res, 200, response);
        return;
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
    if (!subjectId || !UUID_PATTERN.test(subjectId)) return null;
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

function respond(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
