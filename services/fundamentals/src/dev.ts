import { createInMemoryIssuerProfileRepository } from "./issuer-repository.ts";
import {
  DEV_FUNDAMENTALS_SOURCE_ID,
  DEV_ISSUER_PROFILES,
} from "./dev-fixtures.ts";
import { createFundamentalsServer } from "./http.ts";

const host = process.env.FUNDAMENTALS_HOST ?? "127.0.0.1";
const port = Number(process.env.FUNDAMENTALS_PORT ?? "4322");

const profiles = createInMemoryIssuerProfileRepository(DEV_ISSUER_PROFILES);
const server = createFundamentalsServer({
  profiles,
  source_id: DEV_FUNDAMENTALS_SOURCE_ID,
});
server.listen(port, host, () => {
  console.log(`fundamentals listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
