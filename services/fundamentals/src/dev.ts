import { buildFundamentalsDevServer } from "./dev-server.ts";

const host = process.env.FUNDAMENTALS_HOST ?? "127.0.0.1";
const port = Number(process.env.FUNDAMENTALS_PORT ?? "4322");

const { server, close, secFetcherConfigured } = await buildFundamentalsDevServer(process.env);

server.listen(port, host, () => {
  console.log(`fundamentals listening on http://${host}:${port}`);
  if (!secFetcherConfigured) {
    console.warn("SEC_EDGAR_USER_AGENT is not set; fundamentals will serve persisted facts only.");
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      close().finally(() => process.exit(0));
    });
  });
}
