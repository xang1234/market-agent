import { createInMemoryIssuerProfileRepository } from "./issuer-repository.ts";
import { createInMemoryStatementRepository } from "./statement-repository.ts";
import { createInMemoryStatsRepository } from "./stats-repository.ts";
import {
  DEV_FUNDAMENTALS_SOURCE_ID,
  DEV_ISSUER_PROFILES,
} from "./dev-fixtures.ts";
import { DEV_STATEMENTS } from "./dev-statement-fixtures.ts";
import { DEV_STATS_INPUTS } from "./dev-stats-fixtures.ts";
import { createFundamentalsServer } from "./http.ts";

const host = process.env.FUNDAMENTALS_HOST ?? "127.0.0.1";
const port = Number(process.env.FUNDAMENTALS_PORT ?? "4322");

const profiles = createInMemoryIssuerProfileRepository(DEV_ISSUER_PROFILES);
const stats = createInMemoryStatsRepository(DEV_STATS_INPUTS);
const statements = createInMemoryStatementRepository(DEV_STATEMENTS);
const server = createFundamentalsServer({
  profiles,
  stats,
  statements,
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
