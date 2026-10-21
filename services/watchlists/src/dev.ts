import { buildWatchlistsDevServer } from "./dev-server.ts";

const host = process.env.WATCHLISTS_HOST ?? "127.0.0.1";
const port = Number(process.env.WATCHLISTS_PORT ?? "4313");

const { server, close } = await buildWatchlistsDevServer(process.env);

server.listen(port, host, () => {
  console.log(`watchlists listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      close().finally(() => process.exit(0));
    });
  });
}
