import { buildDevApiDevServer } from "./dev-server.ts";
import { removedModeFlagWarnings } from "../../financial-engine/src/readiness.ts";

for (const warning of removedModeFlagWarnings(process.env, ["CHAT_FINANCIAL_MODE", "ANALYZE_FINANCIAL_MODE", "GRID_FINANCIAL_MODE", "THESIS_FINANCIAL_MODE"])) console.warn(`dev-api: ${warning}`);

const host = process.env.DEV_API_HOST ?? "127.0.0.1";
const port = Number(process.env.DEV_API_PORT ?? "4312");

const { server, close } = await buildDevApiDevServer(process.env);

server.listen(port, host, () => {
  console.log(`dev-api listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void close().finally(() => server.close(() => process.exit(0)));
  });
}
