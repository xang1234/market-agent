import { Pool } from "pg";
import { createAnalystGridsServer } from "./http.ts";
import { createUniverseResolverDeps } from "./universe-wiring.ts";
import { createReaderColumnDepsFromEnv } from "./reader-wiring.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const rawPort = process.env.ANALYST_GRIDS_PORT ?? "8093";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`ANALYST_GRIDS_PORT must be an integer in [1, 65535], got: ${rawPort}`);
}
const host = process.env.HOST ?? "127.0.0.1";
const pool = new Pool({ connectionString: databaseUrl });
const reader = await createReaderColumnDepsFromEnv();
if (!reader) console.log("analyst-grids: reader columns disabled (LLM or S3 env not configured)");
const server = createAnalystGridsServer({
  db: pool,
  pool,
  universe: createUniverseResolverDeps(pool),
  reader,
});
server.listen(port, host, () => {
  console.log(`analyst-grids listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
