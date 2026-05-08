import { Pool } from "pg";
import { createPolygonAdapter, createPolygonHttpFetcher } from "./adapters/polygon.ts";
import { createCachedMarketDataAdapter } from "./cached-adapter.ts";
import { createPostgresMarketCacheRepository } from "./cache-repository.ts";
import { createMarketServer } from "./http.ts";
import {
  createPostgresListingRepository,
  listingResolverFromRepository,
} from "./listings.ts";
import { POLYGON_MARKET_SOURCE_ID } from "./provider-sources.ts";
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
const provider = polygonApiKey
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
    });
const adapter = createCachedMarketDataAdapter({ provider, cache });

const server = createMarketServer({ adapter, listings });
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
