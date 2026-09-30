import type { Server } from "node:http";
import { Pool } from "pg";
import { createResolverServer } from "./http.ts";
import { createPolygonTickerDiscoveryProvider } from "./discovery.ts";
import {
  createDevProvidersTickerDiscoveryProvider,
  createFallbackTickerDiscoveryProvider,
} from "./dev-providers.ts";
import { createOpenReferenceTickerDiscoveryProvider } from "./open-reference-providers.ts";
import { openReferenceProviderConfigFromEnv } from "./provider-sources.ts";

// The resolver dev server, unlistened, so it can run alone (dev.ts) or inside the
// one-process dev app (services/app, #122).
export async function buildResolverDevServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for resolver dev server");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const polygonTickerDiscoveryProvider = createPolygonTickerDiscoveryProvider({
    apiKey: env.POLYGON_API_KEY,
    baseUrl: env.RESOLVER_POLYGON_REFERENCE_BASE_URL,
  });
  const openReferenceConfig = openReferenceProviderConfigFromEnv(env);
  const openReferenceEnabled = openReferenceConfig.nasdaqTrader.enabled;
  const unofficialDevProvidersEnabled = env.ENABLE_UNOFFICIAL_DEV_PROVIDERS === "true";
  const devProvidersBaseUrl = env.DEV_PROVIDERS_BASE_URL ?? env.DEV_PROVIDERS_ORIGIN;
  const tickerDiscoveryProviders = [
    polygonTickerDiscoveryProvider,
    ...(openReferenceEnabled
      ? [createOpenReferenceTickerDiscoveryProvider(openReferenceConfig)]
      : []),
    ...(unofficialDevProvidersEnabled && devProvidersBaseUrl
      ? [createDevProvidersTickerDiscoveryProvider({ baseUrl: devProvidersBaseUrl })]
      : []),
  ];
  const tickerDiscoveryProvider = createFallbackTickerDiscoveryProvider(tickerDiscoveryProviders);
  const server = createResolverServer(pool, { tickerDiscoveryProvider });

  return { server, close: () => pool.end() };
}
