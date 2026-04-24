import { Pool } from "pg";
import { createResolverServer } from "./http.ts";

const host = process.env.RESOLVER_HOST ?? "127.0.0.1";
const port = Number(process.env.RESOLVER_PORT ?? "4311");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for resolver dev server");
}

const pool = new Pool({ connectionString: databaseUrl });
const server = createResolverServer(pool);

server.listen(port, host, () => {
  console.log(`resolver listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
