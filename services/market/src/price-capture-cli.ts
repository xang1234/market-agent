// Record listings' share prices from Polygon as price observations (#444).
//
//   DATABASE_URL=... POLYGON_API_KEY=... npm run capture:price -- <listing_uuid> ...
//
// Each run records the unadjusted session closes of the last week whose
// sessions had ended when the response arrived and, when the key is entitled to
// it, the last trade. Prices are kept as Polygon's exact tokens: JSON.parse
// would round them. A price is known when its response finished arriving, the
// earliest instant the fetch proves; Polygon states no delay to subtract.
// A rerun is safe: a price already recorded is the same row. Like sync:splits,
// it skips the frozen golden dataset's issuers.

import { createHash } from "node:crypto";
import { Pool } from "pg";

import { parseFinancialDecimal } from "../../financial-core/src/exact-decimal.ts";
import { boundedInteger, isSourceNumber, parseFinancialJson } from "../../fundamentals/src/lossless-financial-json.ts";
import { FROZEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { createPolygonCaptureFetcher, PolygonFetchError, type PolygonCaptureFetcher } from "./adapters/polygon.ts";
import type { ListingQueryExecutor } from "./listings.ts";
import { recordPriceObservations, type CapturedPrice } from "./price-observations.ts";
import { POLYGON_MARKET_SOURCE_ID } from "./provider-sources.ts";
import { isCompletedSession, sessionDate, windowClosedAt } from "./ytd-window.ts";

export type CaptureListing = Readonly<{ listing_id: string; ticker: string; timezone: string; currency: string; issuer_id: string }>;

/** A parsed response and what its fetch proves: the hash of its bytes and when they finished arriving. */
export type PriceEvidence = Readonly<{ json: unknown; body_sha256: string; completed_at: string }>;

// A week of daily bars covers a long weekend and a holiday.
const CLOSE_LOOKBACK_DAYS = 7;

export async function capturePrices(
  db: ListingQueryExecutor,
  fetcher: PolygonCaptureFetcher,
  listingIds: ReadonlyArray<string>,
  options: { log?: Pick<Console, "log" | "error">; clock?: () => Date } = {},
): Promise<{ failures: number }> {
  const log = options.log ?? console;
  const clock = options.clock ?? (() => new Date());
  const { rows: listings } = await db.query<CaptureListing>(
    `select l.listing_id::text as listing_id, l.ticker, l.timezone, l.trading_currency as currency, i.issuer_id::text as issuer_id
       from listings l join instruments i on i.instrument_id = l.instrument_id
      where l.listing_id = any($1::uuid[]) order by l.ticker`,
    [listingIds],
  );
  let failures = 0;
  const found = new Set(listings.map((listing) => listing.listing_id));
  for (const id of listingIds) {
    if (found.has(id.toLowerCase())) continue;
    failures += 1;
    log.error(`${id}: no such listing`);
  }
  for (const listing of listings) {
    if (FROZEN_ISSUER_IDS.has(listing.issuer_id)) {
      log.log(`${listing.ticker}: skipped, it is the frozen golden dataset`);
      continue;
    }
    try {
      const closes = sessionCloses(listing, await fetchEvidence(fetcher, dailyBarsPath(listing, clock())));
      const trade = await lastTradeIfEntitled(listing, fetcher, log);
      const recorded = await recordPriceObservations(db, [...closes, ...trade]);
      log.log(`${listing.ticker} (${listing.listing_id}): ${closes.length} session close(s) and ${trade.length} last trade observed, ${recorded} new`);
    } catch (error) {
      failures += 1;
      log.error(`${listing.ticker} (${listing.listing_id}): price capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { failures };
}

/** The unadjusted daily closes whose sessions had ended when the response finished arriving. */
export function sessionCloses(listing: CaptureListing, evidence: PriceEvidence): CapturedPrice[] {
  const page = record(evidence.json, `${listing.ticker} daily bars`);
  // Only an unadjusted close is on the basis of its own trade date.
  if (page.adjusted !== false) throw new Error(`polygon: ${listing.ticker} daily bars are not unadjusted`);
  if (page.ticker !== listing.ticker) throw new Error(`polygon: daily bars for ${listing.ticker} name ${String(page.ticker)}`);
  if (page.next_url !== undefined) throw new Error(`polygon: ${listing.ticker} daily bars span more than one page`);
  const results = page.results ?? [];
  if (!Array.isArray(results)) throw new Error(`polygon: ${listing.ticker} daily bars results are not a list`);
  return results.flatMap((row, index) => {
    const bar = record(row, `${listing.ticker} daily bar ${index}`);
    const start = new Date(boundedInteger(bar.t, `${listing.ticker} daily bar ${index} t`, { min: 0, max: 8_640_000_000_000_000 })).toISOString();
    // A bar for a session still open is forming; its close is not yet a close.
    if (!isCompletedSession(start, evidence.completed_at, listing.timezone)) return [];
    const observedAt = windowClosedAt(sessionDate(start, listing.timezone), [listing.timezone]);
    return [observation(listing, evidence, "session_close", priceToken(bar.c, `${listing.ticker} daily bar ${index} c`), observedAt, evidence.completed_at)];
  });
}

/** The last trade of a snapshot. A trade stamped after its response arrived cannot be placed in time, so its known time is null. */
export function lastTrade(listing: CaptureListing, evidence: PriceEvidence): CapturedPrice {
  const snapshot = record(record(evidence.json, `${listing.ticker} snapshot`).ticker, `${listing.ticker} snapshot ticker`);
  if (snapshot.ticker !== listing.ticker) throw new Error(`polygon: snapshot for ${listing.ticker} names ${String(snapshot.ticker)}`);
  const trade = record(snapshot.lastTrade, `${listing.ticker} last trade`);
  const nanoseconds = isSourceNumber(trade.t) && /^[1-9][0-9]{0,19}$/u.test(trade.t.token) ? BigInt(trade.t.token) : null;
  if (nanoseconds === null) throw new Error(`polygon: ${listing.ticker} last trade has no timestamp`);
  const observedAt = new Date(Number(nanoseconds / 1_000_000n)).toISOString();
  const knownAt = Date.parse(evidence.completed_at) >= Date.parse(observedAt) ? evidence.completed_at : null;
  return observation(listing, evidence, "last_trade", priceToken(trade.p, `${listing.ticker} last trade p`), observedAt, knownAt);
}

async function lastTradeIfEntitled(listing: CaptureListing, fetcher: PolygonCaptureFetcher, log: Pick<Console, "log">): Promise<CapturedPrice[]> {
  try {
    return [lastTrade(listing, await fetchEvidence(fetcher, `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(listing.ticker)}`))];
  } catch (error) {
    if (!(error instanceof PolygonFetchError) || error.status !== 403) throw error;
    log.log(`${listing.ticker}: last trade skipped, the key is not entitled to snapshots`);
    return [];
  }
}

async function fetchEvidence(fetcher: PolygonCaptureFetcher, path: string): Promise<PriceEvidence> {
  const { body, completed_at } = await fetcher(path);
  return { json: parseFinancialJson(new TextDecoder().decode(body)), body_sha256: createHash("sha256").update(body).digest("hex"), completed_at };
}

function dailyBarsPath(listing: CaptureListing, now: Date): string {
  const to = sessionDate(now.toISOString(), listing.timezone);
  const from = new Date(Date.parse(`${to}T00:00:00.000Z`) - CLOSE_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  return `/v2/aggs/ticker/${encodeURIComponent(listing.ticker)}/range/1/day/${from}/${to}?adjusted=false&sort=asc&limit=50000`;
}

function observation(listing: CaptureListing, evidence: PriceEvidence, kind: CapturedPrice["kind"], price_text: string, observed_at: string, known_at: string | null): CapturedPrice {
  return {
    listing_id: listing.listing_id,
    source_id: POLYGON_MARKET_SOURCE_ID,
    kind,
    price_text,
    currency: listing.currency,
    observed_at,
    known_at,
    fetched_at: evidence.completed_at,
    body_sha256: evidence.body_sha256,
  };
}

/** The exact source token of a positive price. */
function priceToken(value: unknown, label: string): string {
  const parsed = isSourceNumber(value) ? parseFinancialDecimal(value.token) : null;
  if (!isSourceNumber(value) || !parsed?.ok || parsed.value.coefficient <= 0n) throw new Error(`polygon: ${label} is not a positive price`);
  return value.token;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isSourceNumber(value)) throw new Error(`polygon: ${label} is not an object`);
  return value as Record<string, unknown>;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.POLYGON_API_KEY?.trim();
  if (!databaseUrl || !apiKey) throw new Error("DATABASE_URL and POLYGON_API_KEY are required");
  const listingIds = process.argv.slice(2);
  if (listingIds.length === 0) throw new Error("usage: npm run capture:price -- <listing_uuid> ...");
  const pool = new Pool({ connectionString: databaseUrl });
  const fetcher = createPolygonCaptureFetcher({ apiKey, baseUrl: process.env.POLYGON_API_BASE_URL });
  try {
    const { failures } = await capturePrices(pool, fetcher, listingIds);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
