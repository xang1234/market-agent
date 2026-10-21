// A listing's stock splits as Polygon lists them (#387). One statement replaces
// the listing's rows with the provider's complete list and stamps its coverage,
// so a rerun converges, and a split the provider withdrew or moved to another
// date does not linger beside its replacement.

import { fetchPolygonSplits, type PolygonFetcher } from "./adapters/polygon.ts";
import type { ListingQueryExecutor } from "./listings.ts";
import { POLYGON_MARKET_SOURCE_ID } from "./provider-sources.ts";
import type { UUID } from "./subject-ref.ts";

// Each split_from shares before the split became split_to shares after it.
// NVDA's 10-for-1 on 2024-06-10 is split_from 1, split_to 10.
export type ListingSplit = Readonly<{
  execution_date: string;
  split_from: number;
  split_to: number;
  provider_ref: string | null;
}>;

export type SplitSyncListing = Readonly<{ listing_id: UUID; ticker: string }>;

export type SplitSyncExecutor = ListingQueryExecutor & {
  connect(): Promise<ListingQueryExecutor & { release(): void }>;
};

export async function syncListingSplits(
  db: SplitSyncExecutor,
  fetcher: PolygonFetcher,
  listing: SplitSyncListing,
  clock: () => Date = () => new Date(),
): Promise<ReadonlyArray<ListingSplit>> {
  const checkedAt = clock().toISOString();
  const splits = await fetchPolygonSplits(fetcher, listing.ticker);
  const client = await db.connect();
  try {
    await client.query("begin");
    // The replacement below sees only its own snapshot, so two syncs of one
    // listing at once would both commit and keep the union of their lists.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [listing.listing_id]);
    // A sync that fetched before the stored one leaves the newer list in place.
    const { rows } = await client.query(
      `select 1 from listing_split_coverage where listing_id = $1::uuid and checked_at > $2::timestamptz`,
      [listing.listing_id, checkedAt],
    );
    if (rows.length === 0) await replaceListingSplits(client, listing.listing_id, checkedAt, splits);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return splits;
}

async function replaceListingSplits(
  db: ListingQueryExecutor,
  listingId: UUID,
  checkedAt: string,
  splits: ReadonlyArray<ListingSplit>,
): Promise<void> {
  await db.query(
    `with incoming as (
       select * from unnest($4::date[], $5::numeric[], $6::numeric[], $7::text[])
         as t(execution_date, split_from, split_to, provider_ref)
     ), withdrawn as (
       delete from listing_splits
        where listing_id = $1::uuid and execution_date <> all($4::date[])
     ), recorded as (
       insert into listing_splits (listing_id, execution_date, split_from, split_to, source_id, provider_ref)
       select $1::uuid, execution_date, split_from, split_to, $2::uuid, provider_ref from incoming
       on conflict (listing_id, execution_date) do update
          set split_from = excluded.split_from,
              split_to = excluded.split_to,
              source_id = excluded.source_id,
              provider_ref = excluded.provider_ref
     )
     insert into listing_split_coverage (listing_id, checked_at, source_id)
     values ($1::uuid, $3::timestamptz, $2::uuid)
     on conflict (listing_id) do update
        set checked_at = excluded.checked_at, source_id = excluded.source_id`,
    [
      listingId,
      POLYGON_MARKET_SOURCE_ID,
      checkedAt,
      splits.map((split) => split.execution_date),
      splits.map((split) => split.split_from),
      splits.map((split) => split.split_to),
      splits.map((split) => split.provider_ref),
    ],
  );
}
