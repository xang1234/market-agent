// CUSIP→issuer enrichment (fra-ajvd.7 phase 1): map an unresolved CUSIP through
// OpenFIGI and get-or-create the issuer/instrument via the existing idempotent
// upsertDiscoveredListing, recording the cusip. Intended as a CLI/batch step —
// NOT inline in 13F ingest (which stays a pure DB resolve), so the atomic crawl
// never makes live API calls.
import { upsertDiscoveredInstrument, type DiscoveredInstrument } from "./discovery.ts";
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

  // Get-or-create the issuer + INSTRUMENT only (no listing): OpenFIGI-by-CUSIP has
  // no real trading venue, so fabricating a listing/MIC would create a phantom
  // venue. CUSIP resolution reads instruments (cusip/isin), not listings. Matches
  // an existing instrument by FIGI/ISIN identity (filling the cusip) or creates it;
  // a later Polygon discovery merges by identity to add the precise listing.
  const instrument: DiscoveredInstrument = {
    legal_name: match.legalName,
    asset_type: match.assetType,
    isin: match.isin,
    figi_composite: match.figiComposite,
    cusip: normalized,
  };
  await upsertDiscoveredInstrument(deps.db, instrument);

  const issuer_id = await resolveIssuerByCusip(deps.db, normalized);
  if (!issuer_id) {
    // The instrument was written but the cusip still doesn't resolve to a unique
    // issuer (ambiguous) — surface it rather than report a false "enriched".
    throw new Error(`CUSIP ${normalized} was upserted but does not resolve to a unique issuer`);
  }
  return { status: "enriched", issuer_id, ticker: match.ticker };
}
