import { buildResolverDevServer } from "./dev-server.ts";

const host = process.env.RESOLVER_HOST ?? "127.0.0.1";
const port = Number(process.env.RESOLVER_PORT ?? "4311");

const { server, close } = await buildResolverDevServer(process.env);

server.listen(port, host, () => {
  console.log(`resolver listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      close().finally(() => process.exit(0));
    });
  });
}
