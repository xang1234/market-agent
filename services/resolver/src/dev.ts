import { Pool } from "pg";
import { createResolverServer } from "./http.ts";
import { createPolygonTickerDiscoveryProvider } from "./discovery.ts";
import {
  createDevProvidersTickerDiscoveryProvider,
  createFallbackTickerDiscoveryProvider,
} from "./dev-providers.ts";

const host = process.env.RESOLVER_HOST ?? "127.0.0.1";
const port = Number(process.env.RESOLVER_PORT ?? "4311");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for resolver dev server");
}

const pool = new Pool({ connectionString: databaseUrl });
const polygonApiKey = process.env.POLYGON_API_KEY;
const polygonTickerDiscoveryProvider = createPolygonTickerDiscoveryProvider({
  apiKey: polygonApiKey,
  baseUrl: process.env.RESOLVER_POLYGON_REFERENCE_BASE_URL,
});
const unofficialDevProvidersEnabled = process.env.ENABLE_UNOFFICIAL_DEV_PROVIDERS === "true";
const devProvidersBaseUrl = process.env.DEV_PROVIDERS_BASE_URL ?? process.env.DEV_PROVIDERS_ORIGIN;
const tickerDiscoveryProvider = unofficialDevProvidersEnabled && devProvidersBaseUrl
  ? createFallbackTickerDiscoveryProvider([
      polygonTickerDiscoveryProvider,
      createDevProvidersTickerDiscoveryProvider({ baseUrl: devProvidersBaseUrl }),
    ])
  : polygonTickerDiscoveryProvider;
const server = createResolverServer(pool, { tickerDiscoveryProvider });

server.listen(port, host, () => {
  console.log(`resolver listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
