import { createPolygonAdapter } from "./adapters/polygon.ts";
import { createDevPolygonFetcher, DEV_LISTINGS, DEV_POLYGON_SOURCE_ID } from "./dev-fixtures.ts";
import { createMarketServer } from "./http.ts";
import {
  createInMemoryListingRepository,
  listingResolverFromRepository,
} from "./listings.ts";

const host = process.env.MARKET_HOST ?? "127.0.0.1";
const port = Number(process.env.MARKET_PORT ?? "4321");

const listings = createInMemoryListingRepository(DEV_LISTINGS);
const adapter = createPolygonAdapter({
  sourceId: DEV_POLYGON_SOURCE_ID,
  delayClass: "delayed_15m",
  fetcher: createDevPolygonFetcher({ clock: () => new Date() }),
  resolveListing: listingResolverFromRepository(listings),
});

const server = createMarketServer({ adapter, listings });
server.listen(port, host, () => {
  console.log(`market listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
