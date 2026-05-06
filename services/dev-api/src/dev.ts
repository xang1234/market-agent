import {
  createDevApiServer,
  createFixtureDevApiAdapters,
  createServiceDevApiAdapters,
  type DevApiAdapters,
} from "./http.ts";

const host = process.env.DEV_API_HOST ?? "127.0.0.1";
const port = Number(process.env.DEV_API_PORT ?? "4312");
const adapters = await adaptersFromEnv(process.env);
const server = createDevApiServer(process.env, adapters ? { adapters } : undefined);

server.listen(port, host, () => {
  console.log(`dev-api listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

async function adaptersFromEnv(env: Record<string, string | undefined>): Promise<DevApiAdapters | undefined> {
  if (env.MA_DEV_API_FIXTURE_ADAPTER === "true") {
    return createFixtureDevApiAdapters();
  }
  const databaseUrl = env.DEV_API_DATABASE_URL ?? env.DATABASE_URL;
  if (!databaseUrl) return undefined;
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  return createServiceDevApiAdapters({
    db: pool,
    async sealAnalyzeSnapshot() {
      return {
        ok: false,
        verification: {
          ok: false,
          failures: [
            {
              reason_code: "dev_snapshot_sealer_not_configured",
              details: {},
            },
          ],
        },
      };
    },
  });
}
