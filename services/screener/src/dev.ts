import { Pool } from "pg";
import { createPostgresCandidateRepository } from "./db-candidates.ts";
import { createScreenerServer } from "./http.ts";
import { createPostgresScreenRepository } from "./screen-repository.ts";

const host = process.env.SCREENER_HOST ?? "127.0.0.1";
const port = Number(process.env.SCREENER_PORT ?? "4323");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for screener dev; fixture-backed dev data is disabled.");
}

const pool = new Pool({ connectionString: databaseUrl });
const candidates = createPostgresCandidateRepository(pool);
const screens = createPostgresScreenRepository(pool);
const server = createScreenerServer({ candidates, screens });

server.listen(port, host, () => {
  console.log(`screener listening on http://${host}:${port}`);
  console.log("using live Postgres/provider-backed screener candidates");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
