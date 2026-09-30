import type { Server } from "node:http";
import { createMarketServer } from "./http.ts";
import { createMarketStackFromEnv } from "./stack.ts";

// The market dev server, unlistened, so it can run alone (dev.ts) or inside the
// one-process dev app (services/app, #122).
export async function buildMarketDevServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const { pool, listings, adapter } = createMarketStackFromEnv(env);
  const server = createMarketServer({ adapter, listings });
  return { server, close: () => pool.end() };
}
