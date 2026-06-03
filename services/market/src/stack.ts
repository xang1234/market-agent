import { Pool } from "pg";

import type { MarketDataAdapter } from "./adapter.ts";
import { createDevProvidersMarketDataAdapter } from "./adapters/dev-providers.ts";
import { createPolygonAdapter, createPolygonHttpFetcher } from "./adapters/polygon.ts";
import { createStooqMarketDataAdapter } from "./adapters/stooq.ts";
import { createCachedMarketDataAdapter } from "./cached-adapter.ts";
import {
  createPostgresMarketCacheRepository,
  type MarketCacheRepository,
} from "./cache-repository.ts";
import {
  createPostgresListingRepository,
  listingResolverFromRepository,
} from "./listings.ts";
import { createDailyBarsAwareFallbackMarketDataAdapter } from "./provider-composition.ts";
import {
  POLYGON_MARKET_SOURCE_ID,
  STOOQ_MARKET_SOURCE_ID,
  YAHOO_FINANCE_DEV_MARKET_SOURCE_ID,
  stooqMarketProviderConfigFromEnv,
} from "./provider-sources.ts";
import { createUnavailableMarketDataAdapter } from "./unavailable-adapter.ts";

export type MarketStack = {
  pool: Pool;
  listings: ReturnType<typeof createPostgresListingRepository>;
  cache: MarketCacheRepository;
  adapter: MarketDataAdapter;
};

// Builds the market provider stack (pool, listing repo, cache, cached adapter)
// from environment config. Extracted from dev.ts so both the HTTP server and the
// refresh worker construct an identical stack without duplicating provider wiring.
export function createMarketStackFromEnv(env: NodeJS.ProcessEnv): MarketStack {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the market service");
  }
  const polygonApiKey = env.POLYGON_API_KEY?.trim();
  const pool = new Pool({ connectionString: databaseUrl });
  const listings = createPostgresListingRepository(pool);
  const cache = createPostgresMarketCacheRepository(pool);
  const unofficialDevProvidersEnabled = env.ENABLE_UNOFFICIAL_DEV_PROVIDERS === "true";
  const devProvidersBaseUrl = env.DEV_PROVIDERS_BASE_URL ?? env.DEV_PROVIDERS_ORIGIN;
  const stooqConfig = stooqMarketProviderConfigFromEnv(env);
  const polygonProvider = polygonApiKey
    ? createPolygonAdapter({
        sourceId: POLYGON_MARKET_SOURCE_ID,
        delayClass: "delayed_15m",
        fetcher: createPolygonHttpFetcher({
          apiKey: polygonApiKey,
          baseUrl: env.POLYGON_API_BASE_URL,
        }),
        resolveListing: listingResolverFromRepository(listings),
      })
    : createUnavailableMarketDataAdapter({
        providerName: "polygon",
        sourceId: POLYGON_MARKET_SOURCE_ID,
        detail: "POLYGON_API_KEY is not configured",
        retryable: unofficialDevProvidersEnabled || stooqConfig.enabled,
      });
  const resolveMarketListing = async (listing: { id: string }) => {
    const record = await listings.find(listing.id);
    if (!record) throw new Error(`listing not found: ${listing.id}`);
    return {
      ticker: record.ticker,
      mic: record.mic,
      currency: record.trading_currency,
      timezone: record.timezone,
    };
  };
  const devProvidersAdapter = unofficialDevProvidersEnabled && devProvidersBaseUrl
    ? createDevProvidersMarketDataAdapter({
        baseUrl: devProvidersBaseUrl,
        sourceId: YAHOO_FINANCE_DEV_MARKET_SOURCE_ID,
        resolveListing: resolveMarketListing,
      })
    : null;
  const stooqAdapter = stooqConfig.enabled
    ? createStooqMarketDataAdapter({
        baseUrl: stooqConfig.baseUrl,
        sourceId: STOOQ_MARKET_SOURCE_ID,
        resolveListing: resolveMarketListing,
      })
    : null;
  const provider = devProvidersAdapter || stooqAdapter
    ? createDailyBarsAwareFallbackMarketDataAdapter({
        providerName: "market-provider-fallback",
        realtimeAdapters: [
          polygonProvider,
          ...(devProvidersAdapter ? [devProvidersAdapter] : []),
        ],
        dailyBarsFallbackAdapters: [
          ...(stooqAdapter ? [stooqAdapter] : []),
        ],
        isRealtimeFallbackEligible: (outcome, adapter) =>
          adapter.providerName === "polygon" &&
          outcome.outcome === "unavailable" &&
          outcome.detail === "polygon: HTTP 403",
      })
    : polygonProvider;
  const adapter = createCachedMarketDataAdapter({ provider, cache });
  return { pool, listings, cache, adapter };
}
