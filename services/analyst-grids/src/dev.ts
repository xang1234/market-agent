import { Pool } from "pg";
import { createAnalystGridsServer } from "./http.ts";
import { createUniverseResolverDeps } from "./universe-wiring.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const port = Number(process.env.PORT ?? 8093);
const host = process.env.HOST ?? "127.0.0.1";
const pool = new Pool({ connectionString: databaseUrl });
const server = createAnalystGridsServer({
  db: pool,
  pool,
  universe: createUniverseResolverDeps(pool),
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
