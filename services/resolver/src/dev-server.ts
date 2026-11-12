import type { Server } from "node:http";
import { Pool } from "pg";
import { logPoolErrors } from "../../shared/src/pool-client.ts";
import { createResolverServer } from "./http.ts";
import { createPolygonTickerDiscoveryProvider, type TickerDiscoveryProvider } from "./discovery.ts";
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

  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl }));
  const tickerDiscoveryProvider = tickerDiscoveryProviderFromEnv(env);
  const server = createResolverServer(pool, { tickerDiscoveryProvider });

  return { server, close: () => pool.end() };
}

// Polygon first, then the open reference and unofficial dev providers the env
// turns on. Chat resolves in-process with the same chain (chat/src/local-runtime.ts).
export function tickerDiscoveryProviderFromEnv(env: NodeJS.ProcessEnv): TickerDiscoveryProvider {
  const openReferenceConfig = openReferenceProviderConfigFromEnv(env);
  const devProvidersBaseUrl = env.DEV_PROVIDERS_BASE_URL ?? env.DEV_PROVIDERS_ORIGIN;
  return createFallbackTickerDiscoveryProvider([
    createPolygonTickerDiscoveryProvider({
      apiKey: env.POLYGON_API_KEY,
      baseUrl: env.RESOLVER_POLYGON_REFERENCE_BASE_URL,
    }),
    ...(openReferenceConfig.nasdaqTrader.enabled
      ? [createOpenReferenceTickerDiscoveryProvider(openReferenceConfig)]
      : []),
    ...(env.ENABLE_UNOFFICIAL_DEV_PROVIDERS === "true" && devProvidersBaseUrl
      ? [createDevProvidersTickerDiscoveryProvider({ baseUrl: devProvidersBaseUrl })]
      : []),
  ]);
}
