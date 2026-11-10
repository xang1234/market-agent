// Capture ten years of split-adjusted daily closes from yfinance into
// daily_close_captures (captureCloses). Dev only: it reads yfinance through the
// dev-providers sidecar.
//
//   DATABASE_URL=... DEV_PROVIDERS_BASE_URL=http://127.0.0.1:4336 \
//     npm run capture:closes [-- --tickers AAPL,COST,CAT]
//
// With no tickers, captures every active US common stock or ADR listing except
// the frozen golden issuers'. A ticker with more than one active US listing is a
// failure and is never fetched. One request per listing, in turn, at least
// YFINANCE_PACE_MS apart, covering the ten calendar years before the request's
// UTC day. A rerun the same UTC day inserts nothing. Exits 2 when the sidecar
// cannot be reached or reports a block, and stops there, keeping what it wrote;
// exits 1 when any ticker failed otherwise.

import { parseArgs } from "node:util";
import { Pool } from "pg";
import { parseFinancialDecimal } from "../../financial-core/src/exact-decimal.ts";
import { isSourceNumber, parseFinancialJson } from "../../fundamentals/src/lossless-financial-json.ts";
import { FROZEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { logPoolErrors } from "../../shared/src/pool-client.ts";
import type { ListingQueryExecutor } from "./listings.ts";
import { YAHOO_FINANCE_DEV_MARKET_SOURCE_ID } from "./provider-sources.ts";
import { sessionDate } from "./ytd-window.ts";

export const YFINANCE_PACE_MS = 500;
const HISTORY_YEARS = 10;
const ADJUSTMENT_BASIS = "split_adjusted";
const US_EQUITY_MICS = ["ARCX", "BATS", "IEXG", "XASE", "XNAS", "XNYS"];

export type CloseSidecar = Readonly<{ baseUrl: string; fetchImpl: typeof fetch }>;

export type CaptureOutcome = { inserted: number; failures: number; blocked: boolean };

type Listing = { issuer_id: string; listing_id: string; ticker: string; mic: string; currency: string; timezone: string };

type Close = { trade_date: string; close_text: string };

class SidecarBlocked extends Error {}

export async function captureCloses(
  db: ListingQueryExecutor,
  sidecar: CloseSidecar,
  options: {
    tickers: ReadonlyArray<string> | null;
    now: () => Date;
    sleep: (ms: number) => Promise<void>;
    log: Pick<Console, "log" | "warn" | "error">;
  },
): Promise<CaptureOutcome> {
  const { log } = options;
  const all = await usListings(db);
  const outcome: CaptureOutcome = { inserted: 0, failures: 0, blocked: false };
  for (const ticker of options.tickers ?? []) {
    if (all.some((listing) => listing.ticker === ticker)) continue;
    outcome.failures += 1;
    log.error(`${ticker}: no active US common stock or ADR listing on file`);
  }
  const requested = options.tickers ? all.filter((listing) => options.tickers!.includes(listing.ticker)) : all;
  const byTicker = Map.groupBy(all, (listing) => listing.ticker);
  const listings: Listing[] = [];
  for (const listing of requested) {
    if (FROZEN_ISSUER_IDS.has(listing.issuer_id)) {
      log.log(`${listing.ticker}: skipped, it is the frozen golden dataset`);
      continue;
    }
    // yfinance keys its series by ticker alone, so one series would be stored under every listing that shares it.
    const sharing = byTicker.get(listing.ticker)!;
    if (sharing.length === 1) {
      listings.push(listing);
    } else if (sharing[0] === listing) {
      outcome.failures += 1;
      log.error(`${listing.ticker}: more than one active US listing (${sharing.map((other) => other.listing_id).sort().join(", ")}); captured for none`);
    }
  }

  for (const [index, listing] of listings.entries()) {
    if (index > 0) await options.sleep(YFINANCE_PACE_MS);
    let data: Record<string, unknown>;
    try {
      data = await fetchBars(sidecar, listing, options.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof SidecarBlocked) {
        log.error(`${listing.ticker}: ${message}; stopping the run`);
        return { ...outcome, blocked: true };
      }
      outcome.failures += 1;
      log.error(`${listing.ticker}: ${message}`);
      continue;
    }
    try {
      const retrievedAt = options.now();
      const capturedOn = retrievedAt.toISOString().slice(0, 10);
      const inserted = await writeCloses(db, listing, parseCloses(listing, data), capturedOn, retrievedAt);
      outcome.inserted += inserted;
      log.log(`${listing.ticker}: ${inserted} new close(s) for ${capturedOn}`);
    } catch (error) {
      outcome.failures += 1;
      log.error(`${listing.ticker}: capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return outcome;
}

export function captureExitCode(outcome: CaptureOutcome): number {
  if (outcome.blocked) return 2;
  return outcome.failures > 0 ? 1 : 0;
}

async function usListings(db: ListingQueryExecutor): Promise<Listing[]> {
  const { rows } = await db.query<Listing>(
    `select ins.issuer_id::text as issuer_id, l.listing_id::text as listing_id, l.ticker, l.mic,
            l.trading_currency as currency, l.timezone
       from listings l join instruments ins on ins.instrument_id = l.instrument_id
      where l.mic = any($1::text[]) and l.active_to is null and ins.asset_type in ('common_stock', 'adr')
      order by l.ticker, l.listing_id`,
    [US_EQUITY_MICS],
  );
  return rows;
}

// The range ends at the start of the next UTC day; the sidecar reads it as the
// listing's local date, so a session still trading is never in it.
function historyRange(now: Date): { start: string; end: string } {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = new Date(day);
  start.setUTCFullYear(start.getUTCFullYear() - HISTORY_YEARS);
  return { start: start.toISOString(), end: new Date(day + 86_400_000).toISOString() };
}

async function fetchBars(sidecar: CloseSidecar, listing: Listing, now: Date): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await sidecar.fetchImpl(new URL("/market/daily-bars", sidecar.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticker: listing.ticker,
        mic: listing.mic,
        currency: listing.currency,
        timezone: listing.timezone,
        range: historyRange(now),
        adjustment_basis: ADJUSTMENT_BASIS,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new SidecarBlocked(`dev providers sidecar unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 429) throw new SidecarBlocked("dev providers sidecar HTTP 429");
  if (!response.ok) throw new Error(`dev providers sidecar HTTP ${response.status}`);
  // Closes are kept as the sidecar's exact tokens: response.json() would round them.
  const envelope = record(parseFinancialJson(await response.text()), "availability envelope");
  if (envelope.status === "unavailable") {
    if (envelope.reason === "rate_limited") throw new SidecarBlocked(`yfinance refused the request (${String(envelope.detail)})`);
    throw new Error(`${String(envelope.reason)}: ${String(envelope.detail)}`);
  }
  if (envelope.status !== "available") throw new Error("dev providers sidecar: malformed availability envelope");
  return record(envelope.data, "daily bars");
}

function parseCloses(listing: Listing, data: Record<string, unknown>): Close[] {
  if (data.adjustment_basis !== ADJUSTMENT_BASIS) throw new Error(`yfinance: ${listing.ticker} closes are not ${ADJUSTMENT_BASIS}`);
  if (data.currency !== listing.currency) throw new Error(`yfinance: ${listing.ticker} closes are in ${String(data.currency)}, not ${listing.currency}`);
  if (!Array.isArray(data.bars) || data.bars.length === 0) throw new Error(`yfinance: ${listing.ticker} has no daily bars`);
  const seen = new Set<string>();
  return data.bars.map((value, index) => {
    const bar = record(value, `${listing.ticker} daily bar ${index}`);
    if (typeof bar.ts !== "string" || Number.isNaN(Date.parse(bar.ts))) throw new Error(`yfinance: ${listing.ticker} daily bar ${index} has no timestamp`);
    const tradeDate = sessionDate(bar.ts, listing.timezone);
    if (seen.has(tradeDate)) throw new Error(`yfinance: ${listing.ticker} has two bars on ${tradeDate}`);
    seen.add(tradeDate);
    const parsed = isSourceNumber(bar.close) ? parseFinancialDecimal(bar.close.token) : null;
    if (!isSourceNumber(bar.close) || !parsed?.ok || parsed.value.coefficient <= 0n) {
      throw new Error(`yfinance: ${listing.ticker} close on ${tradeDate} is not a positive decimal`);
    }
    return { trade_date: tradeDate, close_text: bar.close.token };
  });
}

// One statement per set, so a capture day holds a whole response or nothing.
async function writeCloses(db: ListingQueryExecutor, listing: Listing, closes: ReadonlyArray<Close>, capturedOn: string, retrievedAt: Date): Promise<number> {
  const { rows } = await db.query(
    `insert into daily_close_captures (listing_id, source_id, captured_on, retrieved_at, trade_date, close_text, currency, adjustment_basis)
     select $1::uuid, $2::uuid, $3::date, $4::timestamptz, c.trade_date, c.close_text, $7, $8
       from unnest($5::date[], $6::text[]) as c(trade_date, close_text)
      where not exists (select 1 from daily_close_captures d where d.listing_id = $1::uuid and d.source_id = $2::uuid and d.captured_on = $3::date)
     on conflict do nothing
     returning trade_date`,
    [
      listing.listing_id,
      YAHOO_FINANCE_DEV_MARKET_SOURCE_ID,
      capturedOn,
      retrievedAt.toISOString(),
      closes.map((close) => close.trade_date),
      closes.map((close) => close.close_text),
      listing.currency,
      ADJUSTMENT_BASIS,
    ],
  );
  return rows.length;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isSourceNumber(value)) throw new Error(`dev providers sidecar: ${label} is not an object`);
  return value as Record<string, unknown>;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const baseUrl = process.env.DEV_PROVIDERS_BASE_URL;
  if (!databaseUrl || !baseUrl) throw new Error("DATABASE_URL and DEV_PROVIDERS_BASE_URL are required");
  const { values } = parseArgs({ options: { tickers: { type: "string" } } });
  const tickers = values.tickers?.split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean) ?? null;
  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl }));
  try {
    const outcome = await captureCloses(pool, { baseUrl, fetchImpl: fetch }, {
      tickers,
      now: () => new Date(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: console,
    });
    console.log(`close capture: ${outcome.inserted} row(s) inserted, ${outcome.failures} ticker(s) failed${outcome.blocked ? ", stopped by the sidecar" : ""}`);
    process.exitCode = captureExitCode(outcome);
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
