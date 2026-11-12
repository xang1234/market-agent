import type { Server } from "node:http";
import { Pool } from "pg";
import { logPoolErrors } from "../../shared/src/pool-client.ts";
import { createResolverServer } from "./http.ts";
import { tickerDiscoveryProviderFromEnv } from "./dev-providers.ts";

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
