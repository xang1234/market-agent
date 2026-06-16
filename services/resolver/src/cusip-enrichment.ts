// CUSIP→issuer enrichment (fra-ajvd.7 phase 1): map an unresolved CUSIP through
// OpenFIGI and get-or-create the issuer/instrument via the existing idempotent
// upsertDiscoveredListing, recording the cusip. Intended as a CLI/batch step —
// NOT inline in 13F ingest (which stays a pure DB resolve), so the atomic crawl
// never makes live API calls.
import { upsertDiscoveredListing, type DiscoveredListing, type QueryExecutor } from "./discovery.ts";
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
  // already resolves via an explicit cusip or a US-ISIN derivation.
  const existing = await resolveIssuerIdByCusip(deps.db, normalized);
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

  const issuer_id = (await resolveIssuerIdByCusip(deps.db, normalized)) ?? undefined;
  return { status: "enriched", issuer_id, ticker: match.ticker };
}

// CUSIP→issuer via the explicit cusip column or US-ISIN derivation. Mirrors the
// evidence read-model resolver (services/evidence/src/cusip-issuer-map.ts); kept
// local so the resolver does not depend on the higher evidence layer. (A later
// tidy-up could move the canonical CUSIP resolver down into this service.)
async function resolveIssuerIdByCusip(db: QueryExecutor, cusip: string): Promise<string | null> {
  const { rows } = await db.query<{ issuer_id: string }>(
    `select issuer_id::text as issuer_id
       from instruments
      where upper(cusip) = $1
         or (isin like 'US%' and upper(substr(isin, 3, 9)) = $1)
      limit 1`,
    [cusip],
  );
  return rows[0]?.issuer_id ?? null;
}
