import { Pool } from "pg";
import { createInMemoryConsensusRepository } from "./consensus-repository.ts";
import { createInMemoryEarningsRepository } from "./earnings-repository.ts";
import { createInMemoryHoldersRepository } from "./holders-repository.ts";
import {
  createInMemoryIssuerProfileRepository,
  createPostgresIssuerProfileRepository,
} from "./issuer-repository.ts";
import { createInMemorySegmentsRepository } from "./segments-repository.ts";
import { createInMemoryStatementRepository } from "./statement-repository.ts";
import { createInMemoryStatsRepository } from "./stats-repository.ts";
import { DEV_CONSENSUS_INPUTS } from "./dev-consensus-fixtures.ts";
import { DEV_EARNINGS_INPUTS } from "./dev-earnings-fixtures.ts";
import {
  DEV_INSIDER_HOLDERS_INPUTS,
  DEV_INSTITUTIONAL_HOLDERS_INPUTS,
} from "./dev-holders-fixtures.ts";
import {
  DEV_FUNDAMENTALS_SOURCE_ID,
  DEV_ISSUER_PROFILES,
} from "./dev-fixtures.ts";
import { DEV_SEGMENTS } from "./dev-segment-fixtures.ts";
import { DEV_STATEMENTS } from "./dev-statement-fixtures.ts";
import { DEV_STATS_INPUTS } from "./dev-stats-fixtures.ts";
import { createFundamentalsServer } from "./http.ts";

const host = process.env.FUNDAMENTALS_HOST ?? "127.0.0.1";
const port = Number(process.env.FUNDAMENTALS_PORT ?? "4322");
const databaseUrl = process.env.DATABASE_URL;

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const profiles = pool
  ? createPostgresIssuerProfileRepository(pool)
  : createInMemoryIssuerProfileRepository(DEV_ISSUER_PROFILES);
const stats = createInMemoryStatsRepository(DEV_STATS_INPUTS);
const statements = createInMemoryStatementRepository(DEV_STATEMENTS);
const segments = createInMemorySegmentsRepository(DEV_SEGMENTS);
const consensus = createInMemoryConsensusRepository(DEV_CONSENSUS_INPUTS);
const earnings = createInMemoryEarningsRepository(DEV_EARNINGS_INPUTS);
const holders = createInMemoryHoldersRepository({
  institutional: DEV_INSTITUTIONAL_HOLDERS_INPUTS,
  insider: DEV_INSIDER_HOLDERS_INPUTS,
});
const server = createFundamentalsServer({
  profiles,
  stats,
  statements,
  segments,
  consensus,
  earnings,
  holders,
  source_id: DEV_FUNDAMENTALS_SOURCE_ID,
});
server.listen(port, host, () => {
  console.log(`fundamentals listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      if (!pool) {
        process.exit(0);
        return;
      }
      pool.end().finally(() => process.exit(0));
    });
  });
}
