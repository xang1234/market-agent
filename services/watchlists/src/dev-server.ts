import type { Server } from "node:http";
import { Pool } from "pg";
import { createWatchlistsServer } from "./http.ts";

// The watchlists dev server, unlistened, so it can run alone (dev.ts) or inside the
// one-process dev app (services/app, #122).
export async function buildWatchlistsDevServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for watchlists dev server");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  return { server: createWatchlistsServer(pool), close: () => pool.end() };
}
