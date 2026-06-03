import { createMarketServer } from "./http.ts";
import { createMarketStackFromEnv } from "./stack.ts";

const host = process.env.MARKET_HOST ?? "127.0.0.1";
const port = Number(process.env.MARKET_PORT ?? "4321");

const { pool, listings, adapter } = createMarketStackFromEnv(process.env);

const server = createMarketServer({ adapter, listings });
server.listen(port, host, () => {
  console.log(`market listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
