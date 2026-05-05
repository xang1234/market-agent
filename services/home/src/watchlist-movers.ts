import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";
import { assertUuid } from "../../market/src/validators.ts";

import { HomeFindingFeedError } from "./finding-feed-repo.ts";
import { quoteRow } from "./quote-row.ts";
import type {
  HomeOmittedListing,
  HomeQuoteProvider,
  HomeQuoteRow,
  HomeWatchlistMovers,
  HomeWatchlistMoversReason,
} from "./secondary-types.ts";
import type { QueryExecutor } from "./types.ts";

export const DEFAULT_HOME_WATCHLIST_MOVERS_LIMIT = 5;
export const MAX_HOME_WATCHLIST_MOVERS_LIMIT = 20;

export type GetHomeWatchlistMoversRequest = {
  user_id: string;
  quoteProvider: HomeQuoteProvider;
  limit?: number;
};

type ListingMemberRow = {
  subject_id: string;
  has_watchlist: boolean;
};

export async function getHomeWatchlistMovers(
  db: QueryExecutor,
  request: GetHomeWatchlistMoversRequest,
): Promise<HomeWatchlistMovers> {
  assertUuid(request.user_id, "user_id");
  const limit = resolveLimit(request.limit);

  // Single round-trip: probe the default manual watchlist's existence and
  // pull listing-kind members in one query. The CTE returns the watchlist id
  // (or null) and zero or more member rows; an absent watchlist yields one
  // sentinel row with `subject_id IS NULL` and `has_watchlist = false`.
  const result = await db.query<{ subject_id: string | null; has_watchlist: boolean }>(
    `with default_wl as (
       select watchlist_id
         from watchlists
        where user_id = $1::uuid and mode = 'manual'
        limit 1
     )
     select wm.subject_id::text as subject_id,
            (select watchlist_id is not null from default_wl) as has_watchlist
       from default_wl
  left join watchlist_members wm
         on wm.watchlist_id = default_wl.watchlist_id
        and wm.subject_kind = 'listing'
      union all
     select null::text as subject_id,
            false as has_watchlist
      where not exists (select 1 from default_wl)`,
    [request.user_id],
  );

  if (result.rows.length === 0 || result.rows[0].has_watchlist === false) {
    return frozen({ reason: "no_default_watchlist", rows: [], omitted: [] });
  }

  const memberRows: ListingMemberRow[] = result.rows
    .filter((row): row is { subject_id: string; has_watchlist: true } => row.subject_id !== null)
    .map((row) => ({ subject_id: row.subject_id, has_watchlist: true }));

  if (memberRows.length === 0) {
    return frozen({ reason: "empty_watchlist", rows: [], omitted: [] });
  }

  const refs: ListingSubjectRef[] = memberRows.map((row) => ({
    kind: "listing",
    id: row.subject_id,
  }));
  const results = await request.quoteProvider(refs);
  const byId = new Map<string, (typeof results)[number]>();
  for (const result of results) {
    if (!result?.quote || result.quote.listing?.kind !== "listing") continue;
    byId.set(result.quote.listing.id, result);
  }

  const priced: HomeQuoteRow[] = [];
  const omitted: HomeOmittedListing[] = [];
  for (const ref of refs) {
    const result = byId.get(ref.id);
    if (!result) {
      omitted.push(Object.freeze({ listing: ref, reason: "no_quote" }));
      continue;
    }
    priced.push(quoteRow(ref, result));
  }

  // |change_pct| desc, signed change_pct desc as a tie-break (positive moves
  // edge out negatives at equal magnitude), then listing.id asc for stability.
  priced.sort((a, b) => {
    const magDelta = Math.abs(b.change_pct) - Math.abs(a.change_pct);
    if (magDelta !== 0) return magDelta;
    if (a.change_pct !== b.change_pct) return b.change_pct - a.change_pct;
    return a.listing.id < b.listing.id ? -1 : a.listing.id > b.listing.id ? 1 : 0;
  });

  return frozen({
    reason: "ok",
    rows: priced.slice(0, limit),
    omitted,
  });
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_HOME_WATCHLIST_MOVERS_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new HomeFindingFeedError("limit must be a positive integer");
  }
  return Math.min(limit, MAX_HOME_WATCHLIST_MOVERS_LIMIT);
}

function frozen(value: {
  reason: HomeWatchlistMoversReason;
  rows: ReadonlyArray<HomeQuoteRow>;
  omitted: ReadonlyArray<HomeOmittedListing>;
}): HomeWatchlistMovers {
  return Object.freeze({
    reason: value.reason,
    rows: Object.freeze(value.rows),
    omitted: Object.freeze(value.omitted),
  });
}
