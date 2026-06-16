import { Pool } from "pg";
import {
  createDevProviderRuntime,
  devProvidersBaseUrlFromEnv,
} from "./dev-providers.ts";
import { createPostgresIssuerProfileRepository } from "./issuer-repository.ts";
import { createSecCompanyFactsHttpFetcher } from "./sec-edgar-http.ts";
import {
  createSecBackedStatementRepository,
  createSecBackedStatsRepository,
} from "./sec-facts-repository.ts";
import {
  SEC_EDGAR_FILING_SOURCE_ID,
  YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
} from "./provider-sources.ts";
import {
  createUnsupportedConsensusRepository,
  createUnsupportedEarningsRepository,
  createUnsupportedHoldersRepository,
  createUnsupportedSegmentsRepository,
} from "./unsupported-repositories.ts";
import { createFundamentalsServer } from "./http.ts";
import { createSecHoldersRepository } from "./sec-holders-repository.ts";
import { createFallthroughHoldersRepository } from "./fallthrough-holders-repository.ts";

const host = process.env.FUNDAMENTALS_HOST ?? "127.0.0.1";
const port = Number(process.env.FUNDAMENTALS_PORT ?? "4322");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for fundamentals dev; fixture-backed dev data is disabled.");
}

const pool = new Pool({ connectionString: databaseUrl });
const postgresProfiles = createPostgresIssuerProfileRepository(pool);
const devProvidersBaseUrl = devProvidersBaseUrlFromEnv();
const devProviderRuntime = devProvidersBaseUrl
  ? createDevProviderRuntime({
      profiles: postgresProfiles,
      db: pool,
      baseUrl: devProvidersBaseUrl,
      sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
    })
  : null;
const profiles = devProviderRuntime?.profiles ?? postgresProfiles;
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
const consensus = devProviderRuntime?.consensus ?? createUnsupportedConsensusRepository();
const earnings = devProviderRuntime?.earnings ?? createUnsupportedEarningsRepository();
// Official SEC Form 4 insider data is served ahead of the yfinance dev provider;
// the SEC repo returns null for institutional + uncovered issuers → falls through.
const devHolders = devProviderRuntime?.holders ?? createUnsupportedHoldersRepository();
const holders = createFallthroughHoldersRepository(createSecHoldersRepository(pool), devHolders);
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
