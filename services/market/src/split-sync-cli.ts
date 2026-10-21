// Record each listing's stock splits from Polygon (syncListingSplits).
//
//   DATABASE_URL=... POLYGON_API_KEY=... npm run sync:splits [-- <listing_uuid> ...]
//
// With no arguments, syncs every active listing whose issuer has SEC facts.
// Either way it skips the frozen golden dataset's issuers. A rerun is safe: each
// listing's rows converge on Polygon's current list. Requests are not paced, so
// a listing that hits Polygon's rate limit fails and the next run picks it up.

import { Pool } from "pg";

import { FROZEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { createPolygonHttpFetcher, type PolygonFetcher } from "./adapters/polygon.ts";
import { syncListingSplits, type SplitSyncExecutor } from "./split-repository.ts";

type ListingRow = { listing_id: string; ticker: string; issuer_id: string };

const LISTING_SELECT = `
  select l.listing_id::text as listing_id, l.ticker, i.issuer_id::text as issuer_id
    from listings l join instruments i on i.instrument_id = l.instrument_id`;

export async function syncSplits(
  db: SplitSyncExecutor,
  fetcher: PolygonFetcher,
  requestedIds: ReadonlyArray<string>,
  log: Pick<Console, "log" | "error"> = console,
): Promise<{ failures: number }> {
  const { rows: listings } = requestedIds.length
    ? await db.query<ListingRow>(
        `${LISTING_SELECT} where l.listing_id = any($1::uuid[]) order by l.ticker`,
        [requestedIds],
      )
    : await db.query<ListingRow>(
        `${LISTING_SELECT}
          where (l.active_from is null or l.active_from <= now())
            and (l.active_to is null or l.active_to > now())
            and exists (
              select 1 from facts f join sources s on s.source_id = f.source_id
               where f.subject_kind = 'issuer' and f.subject_id = i.issuer_id and s.provider = 'sec_edgar'
            )
          order by l.ticker`,
      );
  let failures = 0;
  const found = new Set(listings.map((listing) => listing.listing_id));
  for (const id of requestedIds) {
    if (found.has(id.toLowerCase())) continue;
    failures += 1;
    log.error(`${id}: no such listing`);
  }
  for (const listing of listings) {
    if (FROZEN_ISSUER_IDS.has(listing.issuer_id)) {
      log.log(`${listing.ticker}: skipped, it is the frozen golden dataset`);
      continue;
    }
    try {
      const splits = await syncListingSplits(db, fetcher, listing);
      log.log(`${listing.ticker} (${listing.listing_id}): ${splits.length} split(s) recorded`);
    } catch (error) {
      failures += 1;
      log.error(`${listing.ticker} (${listing.listing_id}): split sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { failures };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.POLYGON_API_KEY?.trim();
  if (!databaseUrl || !apiKey) throw new Error("DATABASE_URL and POLYGON_API_KEY are required");
  const pool = new Pool({ connectionString: databaseUrl });
  const fetcher = createPolygonHttpFetcher({ apiKey, baseUrl: process.env.POLYGON_API_BASE_URL });
  try {
    const { failures } = await syncSplits(pool, fetcher, process.argv.slice(2));
    if (failures > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
