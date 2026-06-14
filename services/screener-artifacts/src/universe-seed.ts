import {
  upsertDiscoveredListing,
  type DiscoveredListing,
} from "../../resolver/src/discovery.ts";
import type { QueryExecutor, UniverseEntry } from "./types.ts";

// A handful of universe entries carry the exchange label instead of a MIC
// (verified: 7 of 9,886). Everything else is already a MIC (XNYS/XNAS/XASE).
const EXCHANGE_LABEL_TO_MIC: Readonly<Record<string, string>> = {
  NYSE: "XNYS",
  NASDAQ: "XNAS",
  AMEX: "XASE",
  ARCA: "ARCX",
  BATS: "BATS",
};

const US_DEFAULT_TIMEZONE = "America/New_York";

export type SeededSubject = { listingId: string; issuerId: string };

// Normalizes a bundle exchange value to a MIC, or undefined if unmappable. Already
// MIC-shaped values (X??? / 4-letter codes) pass through; known labels are mapped;
// anything else returns undefined so the caller skips + counts the row.
export function exchangeToMic(exchange: string | null | undefined): string | undefined {
  if (!exchange) return undefined;
  const value = exchange.trim().toUpperCase();
  if (EXCHANGE_LABEL_TO_MIC[value]) return EXCHANGE_LABEL_TO_MIC[value];
  if (/^[A-Z]{4}$/.test(value)) return value; // already a MIC (XNYS, ARCX, ...)
  return undefined;
}

// Maps a universe entry to a DiscoveredListing, or null if it lacks the identity
// fields needed to seed a listing→instrument→issuer chain. `domicile` is sourced
// from the row payload's country (universe entries don't carry it).
export function discoveredListingFromUniverse(
  entry: UniverseEntry,
  opts: { domicile?: string } = {},
): DiscoveredListing | null {
  if (entry.is_active === false) return null;
  const ticker = entry.symbol?.trim().toUpperCase();
  const legalName = entry.name?.trim();
  const mic = exchangeToMic(entry.exchange);
  const tradingCurrency = entry.currency?.trim().toUpperCase();
  const timezone = entry.timezone?.trim() || (mic ? US_DEFAULT_TIMEZONE : undefined);
  if (!ticker || !legalName || !mic || !tradingCurrency || !timezone) return null;

  return {
    ticker,
    legal_name: legalName,
    market: "stocks",
    active: true,
    mic,
    trading_currency: tradingCurrency,
    timezone,
    asset_type: "common_stock",
    ...(opts.domicile ? { domicile: opts.domicile } : {}),
  };
}

// Bundle country (e.g. "USA") → issuer domicile code (e.g. "US"). The screener's
// universe filter reads iss.domicile, so this must match the codes used elsewhere.
export function domicileFromCountry(country: string | null | undefined): string | undefined {
  if (!country) return undefined;
  const value = country.trim().toUpperCase();
  if (value.length === 0) return undefined;
  return COUNTRY_TO_DOMICILE[value] ?? value;
}

const COUNTRY_TO_DOMICILE: Readonly<Record<string, string>> = {
  USA: "US",
  "UNITED STATES": "US",
};

// Seeds (or finds) the listing→instrument→issuer chain for one universe entry and
// coalesce-fills the issuer's sector/industry/domicile — the non-null columns the
// screener's universe filter requires. Returns the subject ids, or null if the
// entry was unmappable. Reuses the canonical resolver upsert; the only bespoke
// step is the sector/industry fill (upsertDiscoveredListing sets only cik/lei/domicile).
export async function seedUniverseEntry(
  db: QueryExecutor,
  entry: UniverseEntry,
  opts: { domicile?: string } = {},
): Promise<SeededSubject | null> {
  const listing = discoveredListingFromUniverse(entry, opts);
  if (!listing) return null;

  const ref = await upsertDiscoveredListing(db, listing);
  const issuerId = await issuerIdForListing(db, ref.id);
  await fillIssuerProfileFields(db, issuerId, {
    sector: entry.sector,
    industry: entry.industry,
    domicile: opts.domicile,
  });
  return { listingId: ref.id, issuerId };
}

async function issuerIdForListing(db: QueryExecutor, listingId: string): Promise<string> {
  const result = await db.query<{ issuer_id: string }>(
    `select i.issuer_id::text as issuer_id
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
      where l.listing_id = $1`,
    [listingId],
  );
  const issuerId = result.rows[0]?.issuer_id;
  if (!issuerId) throw new Error(`no issuer resolved for listing ${listingId}`);
  return issuerId;
}

// Coalesce semantics (mirrors resolver fillIssuerIdentityFields): fill a null
// column, never overwrite an existing SEC/Polygon-sourced value. The per-source
// provenance is carried separately by issuer_profile_enrichments.
async function fillIssuerProfileFields(
  db: QueryExecutor,
  issuerId: string,
  values: { sector?: string | null; industry?: string | null; domicile?: string | null },
): Promise<void> {
  if (!values.sector && !values.industry && !values.domicile) return;
  await db.query(
    `update issuers
        set sector = coalesce(sector, $2),
            industry = coalesce(industry, $3),
            domicile = coalesce(domicile, $4),
            updated_at = now()
      where issuer_id = $1`,
    [issuerId, values.sector ?? null, values.industry ?? null, values.domicile ?? null],
  );
}
