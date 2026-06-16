// CUSIP→issuer enrichment (fra-ajvd.7 phase 1): map an unresolved CUSIP through
// OpenFIGI and get-or-create the issuer/instrument via the existing idempotent
// upsertDiscoveredListing, recording the cusip. Intended as a CLI/batch step —
// NOT inline in 13F ingest (which stays a pure DB resolve), so the atomic crawl
// never makes live API calls.
import { upsertDiscoveredListing, type DiscoveredListing } from "./discovery.ts";
import { resolveIssuerByCusip, type QueryExecutor } from "./lookup.ts";
import { mapCusipViaOpenFigi } from "./openfigi-cusip.ts";
import type { OpenReferenceProviderConfig } from "./provider-sources.ts";
import type { FetchImpl } from "./open-reference-providers.ts";

export type EnrichCusipDeps = {
  db: QueryExecutor;
  openfigi: OpenReferenceProviderConfig["openfigi"];
  fetchImpl?: FetchImpl;
};

export type EnrichCusipResult = {
  status: "already" | "enriched" | "unmapped";
  issuer_id?: string;
  ticker?: string;
};

export async function enrichCusip(deps: EnrichCusipDeps, cusip: string): Promise<EnrichCusipResult> {
  const normalized = cusip.trim().toUpperCase();

  // Cheap DB check first: skip the OpenFIGI call (rate limits) if the CUSIP
  // already resolves (via the canonical, ambiguity-safe resolver in lookup.ts).
  const existing = await resolveIssuerByCusip(deps.db, normalized);
  if (existing) return { status: "already", issuer_id: existing };

  const match = await mapCusipViaOpenFigi(deps.openfigi, normalized, deps.fetchImpl);
  if (!match) return { status: "unmapped" };

  const listing: DiscoveredListing = {
    ticker: match.ticker,
    legal_name: match.legalName,
    market: "stocks",
    active: true,
    mic: match.mic,
    trading_currency: "USD",
    timezone: "America/New_York",
    asset_type: match.assetType,
    isin: match.isin,
    figi_composite: match.figiComposite,
    cusip: normalized,
  };
  // Idempotent: matches an existing instrument by FIGI/ISIN identity and fills the
  // cusip, or creates the issuer/instrument/listing. A later Polygon discovery of
  // the same security merges (refining venue/name), never duplicates.
  await upsertDiscoveredListing(deps.db, listing);

  const issuer_id = (await resolveIssuerByCusip(deps.db, normalized)) ?? undefined;
  return { status: "enriched", issuer_id, ticker: match.ticker };
}
