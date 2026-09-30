import { buildMarketDevServer } from "./dev-server.ts";

const host = process.env.MARKET_HOST ?? "127.0.0.1";
const port = Number(process.env.MARKET_PORT ?? "4321");

const { server, close } = await buildMarketDevServer(process.env);

server.listen(port, host, () => {
  console.log(`market listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      close().finally(() => process.exit(0));
    });
  });
}
