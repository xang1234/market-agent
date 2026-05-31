import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type MarketDataAdapter } from "./adapter.ts";
import { isAvailable, unavailable, type MarketDataOutcome, type UnavailableEnvelope } from "./availability.ts";
import type { NormalizedBars } from "./bar.ts";
import { ListingNotFoundError, type ListingRepository, type ListingRecord } from "./listings.ts";
import type { NormalizedQuote } from "./quote.ts";
import { providerNameForMarketSource } from "./provider-sources.ts";
import { canonicalizeProviderBarRange } from "./range-canonicalization.ts";
import {
  assertSeriesQueryContract,
  buildSeriesCacheAuditDashboard,
  seriesCacheIdentity,
  seriesCacheKey,
  type NormalizedSeriesQuery,
  type SeriesCacheAuditDashboard,
  type SeriesCacheAuditEvent,
} from "./series-query.ts";
import type { ListingSubjectRef } from "./subject-ref.ts";
import { isUuidV4 } from "./validators.ts";
import {
  normalizeCommodityMarketQuote,
  normalizeCurve,
  normalizeSpread,
  type CommodityCurve,
  type CommodityMarketQuote,
  type CommodityMarketSubjectKind,
  type CommoditySpread,
} from "./commodity-contract.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";

export type MarketServerDeps = {
  adapter: MarketDataAdapter;
  listings: ListingRepository;
  // Optional clock used when synthesizing per-listing unavailable envelopes
  // (e.g., basis mismatch, missing listing). Defaults to wall-clock; tests
  // pin a fixed clock for deterministic envelopes.
  clock?: () => Date;
  seriesCacheAuditMaxEvents?: number;
  seriesCacheMaxEntries?: number;
};

// HTTP shape for /v1/market/quote — the spec NormalizedQuote (provider-neutral
// market data) plus the listing display context the row/landing surfaces need
// to render without a separate hydration call.
export type GetQuoteResponse = {
  quote: NormalizedQuote;
  provenance: MarketDataProvenance;
  listing_context: {
    ticker: string;
    mic: string;
    timezone: string;
  };
};

export type MarketDataProvenance = {
  provider: string;
  source_id: string;
  delay_class: NormalizedQuote["delay_class"];
  as_of: string;
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

export type GetCacheAuditResponse = {
  dashboard: SeriesCacheAuditDashboard;
};

export type CommodityLatestResponse = {
  quote: CommodityMarketQuote;
  source_freshness: {
    source_id: string;
    delay_class: CommodityMarketQuote["freshness"];
    as_of: string;
  };
};

export type CommoditySeriesResponse = {
  subject_ref: SubjectRef & { kind: CommodityMarketSubjectKind };
  currency: string;
  unit: string;
  points: ReadonlyArray<{ ts: string; price: number }>;
  source_id: string;
  as_of: string;
};

export type CommodityCurveResponse = {
  curve: CommodityCurve;
};

export type CommoditySpreadsResponse = {
  curve_ref: SubjectRef & { kind: "curve" };
  spreads: ReadonlyArray<CommoditySpread>;
};

export type CommodityInventoryResponse = {
  commodity_ref: SubjectRef & { kind: "commodity" };
  unit: string;
  points: ReadonlyArray<{ ts: string; value: number }>;
  source_id: string;
  as_of: string;
};

const MAX_SERIES_BODY_BYTES = 64 * 1024;
const DEFAULT_SERIES_CACHE_AUDIT_MAX_EVENTS = 1_000;
const DEFAULT_SERIES_CACHE_MAX_ENTRIES = 256;
const COMMODITY_SOURCE_ID = "44444444-4444-4444-8444-444444444444";
const COPPER_CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const COPPER_BENCHMARK_ID = "55555555-5555-4555-8555-555555555555";
const COPPER_CURVE_ID = "22222222-2222-4222-8222-222222222222";
const COPPER_COMMODITY_ID = "33333333-3333-4333-8333-333333333333";

export function createMarketServer(deps: MarketServerDeps): Server {
  const clock = deps.clock ?? (() => new Date());
  const seriesCacheAuditMaxEvents =
    deps.seriesCacheAuditMaxEvents ?? DEFAULT_SERIES_CACHE_AUDIT_MAX_EVENTS;
  const seriesCacheMaxEntries =
    deps.seriesCacheMaxEntries ?? DEFAULT_SERIES_CACHE_MAX_ENTRIES;
  const seriesCacheAuditEvents: SeriesCacheAuditEvent[] = [];
  const seriesResponseCache = new Map<string, GetSeriesResponse>();

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
        case "get_cache_audit":
          respond(res, 200, {
            dashboard: buildSeriesCacheAuditDashboard(seriesCacheAuditEvents),
          } satisfies GetCacheAuditResponse);
          return;
        case "get_commodity_latest": {
          const response = commodityLatestResponse(route.subject_ref, clock());
          if (response === null) {
            respond(res, 404, { error: "commodity quote not found" });
            return;
          }
          respond(res, 200, response);
          return;
        }
        case "get_commodity_series": {
          const response = commoditySeriesResponse(route.subject_ref, clock());
          if (response === null) {
            respond(res, 404, { error: "commodity series not found" });
            return;
          }
          respond(res, 200, response);
          return;
        }
        case "get_commodity_curve": {
          const response = commodityCurveResponse(route.curve_id, clock());
          if (response === null) {
            respond(res, 404, { error: "commodity curve not found" });
            return;
          }
          respond(res, 200, response);
          return;
        }
        case "get_commodity_spreads": {
          const response = commoditySpreadsResponse(route.curve_id, clock());
          if (response === null) {
            respond(res, 404, { error: "commodity spreads not found" });
            return;
          }
          respond(res, 200, response);
          return;
        }
        case "get_commodity_inventory": {
          const response = commodityInventoryResponse(route.commodity_id, clock());
          if (response === null) {
            respond(res, 404, { error: "commodity inventory not found" });
            return;
          }
          respond(res, 200, response);
          return;
        }
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
            provenance: quoteProvenance(deps.adapter.providerName, quote.data),
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
          const observedAt = clock().toISOString();
          const freshnessBoundary = seriesCacheFreshnessBoundary(query);
          const identity = seriesCacheIdentity(query, freshnessBoundary);
          const cacheKey = seriesCacheKey(query, freshnessBoundary);
          const cachedResponse = seriesResponseCache.get(cacheKey);
          if (cachedResponse) {
            promoteSeriesResponse(seriesResponseCache, cacheKey, cachedResponse);
            recordSeriesCacheAuditEvent(seriesCacheAuditEvents, seriesCacheAuditMaxEvents, {
              cacheName: "series",
              result: "hit",
              identity,
              observedAt,
            });
            respond(res, 200, cachedResponse);
            return;
          }

          recordSeriesCacheAuditEvent(seriesCacheAuditEvents, seriesCacheAuditMaxEvents, {
            cacheName: "series",
            result: "miss",
            identity,
            observedAt,
          });

          const results = await Promise.all(
            query.subject_refs.map((listing) =>
              fanOutOne(deps, clock, query, listing),
            ),
          );
          const response: GetSeriesResponse = { query, results };
          if (!seriesResponseHasRetryableUnavailable(response)) {
            rememberSeriesResponse(seriesResponseCache, seriesCacheMaxEntries, cacheKey, response);
          }
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

function quoteProvenance(
  providerName: string,
  quote: NormalizedQuote,
): MarketDataProvenance {
  return {
    provider: providerNameForMarketSource(quote.source_id, providerName),
    source_id: quote.source_id,
    delay_class: quote.delay_class,
    as_of: quote.as_of,
  };
}

function seriesCacheFreshnessBoundary(query: NormalizedSeriesQuery): string {
  return query.range.end;
}

function recordSeriesCacheAuditEvent(
  events: SeriesCacheAuditEvent[],
  maxEvents: number,
  event: SeriesCacheAuditEvent,
): void {
  if (maxEvents <= 0) return;
  events.push(event);
  const overflow = events.length - maxEvents;
  if (overflow > 0) events.splice(0, overflow);
}

function rememberSeriesResponse(
  cache: Map<string, GetSeriesResponse>,
  maxEntries: number,
  key: string,
  response: GetSeriesResponse,
): void {
  if (maxEntries <= 0) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, response);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function promoteSeriesResponse(
  cache: Map<string, GetSeriesResponse>,
  key: string,
  response: GetSeriesResponse,
): void {
  cache.delete(key);
  cache.set(key, response);
}

function seriesResponseHasRetryableUnavailable(response: GetSeriesResponse): boolean {
  return response.results.some((entry) =>
    !isAvailable(entry.outcome) && entry.outcome.retryable,
  );
}

type Route =
  | { action: "healthz" }
  | { action: "get_cache_audit" }
  | { action: "get_commodity_latest"; subject_ref: SubjectRef & { kind: CommodityMarketSubjectKind } }
  | { action: "get_commodity_series"; subject_ref: SubjectRef & { kind: CommodityMarketSubjectKind } }
  | { action: "get_commodity_curve"; curve_id: string }
  | { action: "get_commodity_spreads"; curve_id: string }
  | { action: "get_commodity_inventory"; commodity_id: string }
  | { action: "get_quote"; subject_id: string }
  | { action: "get_series" };

function matchRoute(method: string, rawUrl: string): Route | null {
  const url = new URL(rawUrl, "http://localhost");
  const { pathname, searchParams } = url;

  if (method === "GET" && pathname === "/healthz") return { action: "healthz" };
  if (method === "GET" && pathname === "/v1/market/cache-audit") return { action: "get_cache_audit" };

  if (method === "GET" && pathname === "/v1/markets/latest") {
    const subjectRef = commodityMarketSubjectFromQuery(searchParams);
    return subjectRef === null ? null : { action: "get_commodity_latest", subject_ref: subjectRef };
  }

  if (method === "GET" && pathname === "/v1/markets/series") {
    const subjectRef = commodityMarketSubjectFromQuery(searchParams);
    return subjectRef === null ? null : { action: "get_commodity_series", subject_ref: subjectRef };
  }

  if (method === "GET" && pathname === "/v1/markets/curve") {
    const curveId = searchParams.get("curve_id");
    return isUuidV4(curveId) ? { action: "get_commodity_curve", curve_id: curveId } : null;
  }

  if (method === "GET" && pathname === "/v1/markets/spreads") {
    const curveId = searchParams.get("curve_id");
    return isUuidV4(curveId) ? { action: "get_commodity_spreads", curve_id: curveId } : null;
  }

  if (method === "GET" && pathname === "/v1/markets/inventory") {
    const commodityId = searchParams.get("commodity_id");
    return isUuidV4(commodityId) ? { action: "get_commodity_inventory", commodity_id: commodityId } : null;
  }

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

function commodityMarketSubjectFromQuery(
  searchParams: URLSearchParams,
): (SubjectRef & { kind: CommodityMarketSubjectKind }) | null {
  const kind = searchParams.get("subject_kind");
  const id = searchParams.get("subject_id");
  if ((kind !== "benchmark" && kind !== "contract") || !isUuidV4(id)) return null;
  return { kind, id };
}

function commodityLatestResponse(
  subjectRef: SubjectRef & { kind: CommodityMarketSubjectKind },
  asOf: Date,
): CommodityLatestResponse | null {
  if (!isKnownCopperMarketSubject(subjectRef)) return null;
  const quote = normalizeCommodityMarketQuote({
    subject_ref: subjectRef,
    benchmark: subjectRef.kind === "contract" ? "LME Copper Cash" : "LME Copper Grade A",
    price: 10350,
    prev_close: 10225,
    currency: "USD",
    unit: "t",
    grade: "Grade A copper cathode",
    location: "LME warehouse",
    delivery_month: "cash",
    incoterm: "warehouse",
    freshness: "real_time",
    as_of: asOf.toISOString(),
    source_id: COMMODITY_SOURCE_ID,
  });
  return Object.freeze({
    quote,
    source_freshness: Object.freeze({
      source_id: quote.source_id,
      delay_class: quote.freshness,
      as_of: quote.as_of,
    }),
  });
}

function commoditySeriesResponse(
  subjectRef: SubjectRef & { kind: CommodityMarketSubjectKind },
  asOf: Date,
): CommoditySeriesResponse | null {
  if (!isKnownCopperMarketSubject(subjectRef)) return null;
  return Object.freeze({
    subject_ref: Object.freeze({ ...subjectRef }),
    currency: "USD",
    unit: "t",
    points: Object.freeze([
      Object.freeze({ ts: "2026-05-29T00:00:00.000Z", price: 10225 }),
      Object.freeze({ ts: asOf.toISOString(), price: 10350 }),
    ]),
    source_id: COMMODITY_SOURCE_ID,
    as_of: asOf.toISOString(),
  });
}

function commodityCurveResponse(curveId: string, asOf: Date): CommodityCurveResponse | null {
  if (curveId !== COPPER_CURVE_ID) return null;
  return Object.freeze({
    curve: normalizeCurve({
      curve_ref: { kind: "curve", id: curveId },
      as_of: asOf.toISOString(),
      currency: "USD",
      unit: "t",
      source_id: COMMODITY_SOURCE_ID,
      points: [
        { tenor: "cash", tenor_rank: 0, price: 10350 },
        { tenor: "3M", tenor_rank: 3, price: 10290 },
      ],
    }),
  });
}

function commoditySpreadsResponse(curveId: string, asOf: Date): CommoditySpreadsResponse | null {
  if (curveId !== COPPER_CURVE_ID) return null;
  const spreads = Object.freeze([
    normalizeSpread({
      spread_id: "cash-3m",
      first_leg: { tenor: "cash", price: 10350 },
      second_leg: { tenor: "3M", price: 10290 },
      currency: "USD",
      unit: "t",
      as_of: asOf.toISOString(),
      source_id: COMMODITY_SOURCE_ID,
    }),
  ]);
  return Object.freeze({
    curve_ref: Object.freeze({ kind: "curve" as const, id: curveId }),
    spreads,
  });
}

function commodityInventoryResponse(commodityId: string, asOf: Date): CommodityInventoryResponse | null {
  if (commodityId !== COPPER_COMMODITY_ID) return null;
  return Object.freeze({
    commodity_ref: Object.freeze({ kind: "commodity" as const, id: commodityId }),
    unit: "t",
    points: Object.freeze([
      Object.freeze({ ts: "2026-05-29T00:00:00.000Z", value: 142500 }),
      Object.freeze({ ts: asOf.toISOString(), value: 140900 }),
    ]),
    source_id: COMMODITY_SOURCE_ID,
    as_of: asOf.toISOString(),
  });
}

function isKnownCopperMarketSubject(subjectRef: SubjectRef & { kind: CommodityMarketSubjectKind }): boolean {
  return (subjectRef.kind === "contract" && subjectRef.id === COPPER_CONTRACT_ID) ||
    (subjectRef.kind === "benchmark" && subjectRef.id === COPPER_BENCHMARK_ID);
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
  // The per-listing envelope contract requires every leg to resolve to an
  // outcome — a thrown error here would propagate through Promise.all and
  // collapse the entire batch into a single 502, dropping envelopes for
  // siblings that succeeded. So unhandled failures synthesize a
  // provider_error envelope instead, and ListingNotFoundError specifically
  // maps to missing_coverage to mirror the explicit not-found branch.
  try {
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
      range: canonicalizeProviderBarRange(query.range, query.interval, record.timezone),
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
  } catch (err) {
    const reason = err instanceof ListingNotFoundError ? "missing_coverage" : "provider_error";
    return {
      listing,
      outcome: unavailable({
        reason,
        listing,
        source_id: deps.adapter.sourceId,
        as_of: clock().toISOString(),
        retryable: reason === "provider_error",
        detail: errorMessage(err, "fan-out leg failed"),
      }),
    };
  }
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
