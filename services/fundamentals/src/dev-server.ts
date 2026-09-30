import type { Server } from "node:http";
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

// The fundamentals dev server, unlistened, so it can run alone (dev.ts) or inside
// the one-process dev app (services/app, #122).
export async function buildFundamentalsDevServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ server: Server; close: () => Promise<void>; secFetcherConfigured: boolean }> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for fundamentals dev; fixture-backed dev data is disabled.");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const postgresProfiles = createPostgresIssuerProfileRepository(pool);
  const devProvidersBaseUrl = devProvidersBaseUrlFromEnv(env);
  const devProviderRuntime = devProvidersBaseUrl
    ? createDevProviderRuntime({
        profiles: postgresProfiles,
        db: pool,
        baseUrl: devProvidersBaseUrl,
        sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
      })
    : null;
  const profiles = devProviderRuntime?.profiles ?? postgresProfiles;
  const secFetcher = env.SEC_EDGAR_USER_AGENT
    ? createSecCompanyFactsHttpFetcher({
        userAgent: env.SEC_EDGAR_USER_AGENT,
        baseUrl: env.SEC_EDGAR_BASE_URL,
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

  return { server, close: () => pool.end(), secFetcherConfigured: secFetcher !== null };
}
