import { Pool } from "pg";
import { createPolygonAdapter, createPolygonHttpFetcher } from "./adapters/polygon.ts";
import {
  createDevPolygonFetcher,
  createSeededFixtureFallbackFetcher,
  DEV_LISTINGS,
  DEV_POLYGON_SOURCE_ID,
} from "./dev-fixtures.ts";
import { createMarketServer } from "./http.ts";
import {
  createInMemoryListingRepository,
  createPostgresListingRepository,
  listingResolverFromRepository,
} from "./listings.ts";

const host = process.env.MARKET_HOST ?? "127.0.0.1";
const port = Number(process.env.MARKET_PORT ?? "4321");
const databaseUrl = process.env.DATABASE_URL;
const polygonApiKey = process.env.POLYGON_API_KEY?.trim();

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const listings = pool
  ? createPostgresListingRepository(pool)
  : createInMemoryListingRepository(DEV_LISTINGS);
const fixtureFetcher = createDevPolygonFetcher({ clock: () => new Date() });
const polygonFetcher = polygonApiKey
  ? createSeededFixtureFallbackFetcher({
      primary: createPolygonHttpFetcher({
        apiKey: polygonApiKey,
        baseUrl: process.env.POLYGON_API_BASE_URL,
      }),
      fallback: fixtureFetcher,
    })
  : fixtureFetcher;
const adapter = createPolygonAdapter({
  sourceId: DEV_POLYGON_SOURCE_ID,
  delayClass: "delayed_15m",
  fetcher: polygonFetcher,
  resolveListing: listingResolverFromRepository(listings),
});

const server = createMarketServer({ adapter, listings });
server.listen(port, host, () => {
  console.log(`market listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      if (!pool) {
        process.exit(0);
        return;
      }
      pool.end().finally(() => process.exit(0));
    });
  });
}
