import { createDevApiServer } from "./http.ts";

const host = process.env.DEV_API_HOST ?? "127.0.0.1";
const port = Number(process.env.DEV_API_PORT ?? "4312");
const server = createDevApiServer(process.env);

server.listen(port, host, () => {
  console.log(`dev-api listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
