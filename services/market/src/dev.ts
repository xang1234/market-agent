import { Pool } from "pg";
import { createDevProvidersMarketDataAdapter } from "./adapters/dev-providers.ts";
import { createPolygonAdapter, createPolygonHttpFetcher } from "./adapters/polygon.ts";
import { createStooqMarketDataAdapter } from "./adapters/stooq.ts";
import { createCachedMarketDataAdapter } from "./cached-adapter.ts";
import { createPostgresMarketCacheRepository } from "./cache-repository.ts";
import { createDevCommodityMarketDataAdapter } from "./dev-commodity-market-adapter.ts";
import { createMarketServer } from "./http.ts";
import { createDailyBarsAwareFallbackMarketDataAdapter } from "./provider-composition.ts";
import {
  createPostgresListingRepository,
  listingResolverFromRepository,
} from "./listings.ts";
import {
  POLYGON_MARKET_SOURCE_ID,
  STOOQ_MARKET_SOURCE_ID,
  YAHOO_FINANCE_DEV_MARKET_SOURCE_ID,
  stooqMarketProviderConfigFromEnv,
} from "./provider-sources.ts";
import { createUnavailableMarketDataAdapter } from "./unavailable-adapter.ts";

const host = process.env.MARKET_HOST ?? "127.0.0.1";
const port = Number(process.env.MARKET_PORT ?? "4321");
const databaseUrl = process.env.DATABASE_URL;
const polygonApiKey = process.env.POLYGON_API_KEY?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for market dev server");
}

const pool = new Pool({ connectionString: databaseUrl });
const listings = createPostgresListingRepository(pool);
const cache = createPostgresMarketCacheRepository(pool);
const unofficialDevProvidersEnabled = process.env.ENABLE_UNOFFICIAL_DEV_PROVIDERS === "true";
const devProvidersBaseUrl = process.env.DEV_PROVIDERS_BASE_URL ?? process.env.DEV_PROVIDERS_ORIGIN;
const stooqConfig = stooqMarketProviderConfigFromEnv(process.env);
const polygonProvider = polygonApiKey
  ? createPolygonAdapter({
      sourceId: POLYGON_MARKET_SOURCE_ID,
      delayClass: "delayed_15m",
      fetcher: createPolygonHttpFetcher({
        apiKey: polygonApiKey,
        baseUrl: process.env.POLYGON_API_BASE_URL,
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
const commodityAdapter = createDevCommodityMarketDataAdapter();

const server = createMarketServer({ adapter, commodityAdapter, listings });
server.listen(port, host, () => {
  console.log(`market listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
