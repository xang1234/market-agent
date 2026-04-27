import { Pool } from "pg";
import { createPortfolioServer } from "./http.ts";

const host = process.env.PORTFOLIO_HOST ?? "127.0.0.1";
const port = Number(process.env.PORTFOLIO_PORT ?? "4333");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for portfolio dev server");
}

const pool = new Pool({ connectionString: databaseUrl });
const server = createPortfolioServer(pool);

server.listen(port, host, () => {
  console.log(`portfolio listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
