import type { Server } from "node:http";
import { createDevApiServer } from "./http.ts";
import { createDevApiRuntimeFromEnv } from "./runtime.ts";

// The dev-api server, unlistened, so it can run alone (dev.ts) or inside the
// one-process dev app (services/app, #122).
export async function buildDevApiDevServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const { adapters, worker } = await createDevApiRuntimeFromEnv(env);
  const server = createDevApiServer(env, adapters ? { adapters } : undefined);
  return {
    server,
    // Bounded: an in-flight financial tick gets 10s, then its lease expires and recovery resumes it.
    close: async () => {
      await worker?.stop({ timeoutMs: 10_000 });
    },
  };
}
