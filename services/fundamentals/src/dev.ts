import { Pool } from "pg";
import { createPostgresIssuerProfileRepository } from "./issuer-repository.ts";
import { createSecCompanyFactsHttpFetcher } from "./sec-edgar-http.ts";
import {
  createSecBackedStatementRepository,
  createSecBackedStatsRepository,
} from "./sec-facts-repository.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "./provider-sources.ts";
import {
  createUnsupportedConsensusRepository,
  createUnsupportedEarningsRepository,
  createUnsupportedHoldersRepository,
  createUnsupportedSegmentsRepository,
} from "./unsupported-repositories.ts";
import { createFundamentalsServer } from "./http.ts";

const host = process.env.FUNDAMENTALS_HOST ?? "127.0.0.1";
const port = Number(process.env.FUNDAMENTALS_PORT ?? "4322");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for fundamentals dev; fixture-backed dev data is disabled.");
}

const pool = new Pool({ connectionString: databaseUrl });
const profiles = createPostgresIssuerProfileRepository(pool);
const secFetcher = process.env.SEC_EDGAR_USER_AGENT
  ? createSecCompanyFactsHttpFetcher({
      userAgent: process.env.SEC_EDGAR_USER_AGENT,
      baseUrl: process.env.SEC_EDGAR_BASE_URL,
    })
  : null;
const statements = createSecBackedStatementRepository(pool, {
  fetcher: secFetcher,
  sourceId: SEC_EDGAR_FILING_SOURCE_ID,
});
const stats = createSecBackedStatsRepository(pool, { statements, fetcher: secFetcher });
const segments = createUnsupportedSegmentsRepository();
const consensus = createUnsupportedConsensusRepository();
const earnings = createUnsupportedEarningsRepository();
const holders = createUnsupportedHoldersRepository();
const server = createFundamentalsServer({
  profiles,
  stats,
  statements,
  segments,
  consensus,
  earnings,
  holders,
  source_id: SEC_EDGAR_FILING_SOURCE_ID,
});
server.listen(port, host, () => {
  console.log(`fundamentals listening on http://${host}:${port}`);
  if (!secFetcher) {
    console.warn("SEC_EDGAR_USER_AGENT is not set; fundamentals will serve persisted facts only.");
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
