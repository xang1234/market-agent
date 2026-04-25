// Listing context lookup: maps a listing UUID to the provider-neutral context
// needed to fetch quotes (ticker + venue + currency + display timezone).
//
// In production this would query the `listings` table seeded by P0.5 and
// joined to the relevant venue/currency tables. For dev mode, a small
// in-memory map keyed by listing UUID stands in. Either backing exposes the
// same `find` shape so callers (the polygon adapter's resolveListing dep,
// the HTTP handler) don't change between environments.

import type { ListingSubjectRef, UUID } from "./subject-ref.ts";

export type ListingRecord = {
  listing_id: UUID;
  ticker: string;
  mic: string;
  trading_currency: string;
  timezone: string;
};

export type ListingRepository = {
  find(listing_id: UUID): Promise<ListingRecord | null>;
};

export class ListingNotFoundError extends Error {
  readonly listing_id: UUID;
  constructor(listing_id: UUID) {
    super(`listing not found: ${listing_id}`);
    this.name = "ListingNotFoundError";
    this.listing_id = listing_id;
  }
}

export function createInMemoryListingRepository(
  records: ReadonlyArray<ListingRecord>,
): ListingRepository {
  const byId = new Map(records.map((r) => [r.listing_id, r] as const));
  return {
    async find(listing_id: UUID): Promise<ListingRecord | null> {
      return byId.get(listing_id) ?? null;
    },
  };
}

// Adapts a ListingRepository to the polygon adapter's resolveListing signature
// (ListingSubjectRef → PolygonListingContext). Throws ListingNotFoundError if
// the listing UUID is unknown — the adapter currently propagates this as a
// 5xx; once availability outcomes (fra-cw0.1.4) land, the adapter will wrap
// it as an unavailable envelope.
export function listingResolverFromRepository(
  repo: ListingRepository,
): (listing: ListingSubjectRef) => Promise<{
  ticker: string;
  mic: string;
  currency: string;
}> {
  return async (listing) => {
    const record = await repo.find(listing.id);
    if (!record) throw new ListingNotFoundError(listing.id);
    return {
      ticker: record.ticker,
      mic: record.mic,
      currency: record.trading_currency,
    };
  };
}
