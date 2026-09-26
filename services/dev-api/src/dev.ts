import { createDevApiServer } from "./http.ts";
import { createDevApiAdaptersFromEnv, stopDevApiWorkers } from "./runtime.ts";

const host = process.env.DEV_API_HOST ?? "127.0.0.1";
const port = Number(process.env.DEV_API_PORT ?? "4312");
const adapters = await createDevApiAdaptersFromEnv(process.env);
const server = createDevApiServer(process.env, adapters ? { adapters } : undefined);

server.listen(port, host, () => {
  console.log(`dev-api listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Bounded: an in-flight financial tick gets 10s, then its lease expires and recovery resumes it.
    void stopDevApiWorkers(10_000).finally(() => server.close(() => process.exit(0)));
  });
}
