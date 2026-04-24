import { Pool } from "pg";
import { createWatchlistsServer } from "./http.ts";

const host = process.env.WATCHLISTS_HOST ?? "127.0.0.1";
const port = Number(process.env.WATCHLISTS_PORT ?? "4313");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for watchlists dev server");
}

const pool = new Pool({ connectionString: databaseUrl });
const server = createWatchlistsServer(pool);

server.listen(port, host, () => {
  console.log(`watchlists listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
