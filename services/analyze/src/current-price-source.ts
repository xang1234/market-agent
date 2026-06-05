// Resolves an issuer's current-price quote: issuer -> primary listing (profile's
// first exchange) -> the market cache's latest quote. Bridges the fundamentals
// profile repo and the market cache repo so the analyze run path takes one dep.

import type { IssuerProfileRepository } from "../../fundamentals/src/issuer-repository.ts";
import type { MarketCacheRepository } from "../../market/src/cache-repository.ts";
import type { NormalizedQuote } from "../../market/src/quote.ts";

export type CurrentPriceSource = {
  findByIssuer(issuerId: string): Promise<NormalizedQuote | null>;
};

export function createCurrentPriceSource(
  profiles: IssuerProfileRepository,
  cache: MarketCacheRepository,
): CurrentPriceSource {
  return {
    async findByIssuer(issuerId: string): Promise<NormalizedQuote | null> {
      const profile = await profiles.find(issuerId);
      const listing = profile?.exchanges[0]?.listing;
      if (!listing) return null;
      const cached = await cache.findLatestQuote(listing);
      return cached?.quote ?? null;
    },
  };
}
