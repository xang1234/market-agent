// A listing's stock splits as split-repository.ts last stored them in full
// (#387). This module reads only the tables and imports no provider, so the
// financial engine and SEC ingestion read splits without depending on Polygon.

import type { ListingQueryExecutor } from "./listings.ts";
import type { UUID } from "./subject-ref.ts";

/** A split as stored: its ratios are the exact text of their numeric columns. */
export type RecordedListingSplit = Readonly<{
  execution_date: string;
  split_from: string;
  split_to: string;
  provider_ref: string | null;
}>;

export type ListingSplitHistory =
  | Readonly<{ checked_at: null }>
  | Readonly<{ checked_at: string; source_id: UUID; splits: ReadonlyArray<RecordedListingSplit> }>;

/** The splits of the one listing whose splits apply to a subject, and the time zone their dates are in. */
export type SubjectSplitHistory =
  | Readonly<{ status: "ok"; listing_id: UUID; timezone: string; checked_at: string; splits: ReadonlyArray<RecordedListingSplit> }>
  | Readonly<{ status: "gap"; reason_code: "split_listing_unresolved" | "split_history_missing" }>;

/**
 * The split history of a subject's one common-stock listing active at `asOf`.
 * A second share class or venue may have split differently, so more than one
 * listing is as unresolved as none.
 */
export async function loadSubjectSplitHistory(
  db: ListingQueryExecutor,
  subject: Readonly<{ kind: "issuer" | "listing"; id: string }>,
  asOf: string,
): Promise<SubjectSplitHistory> {
  const { rows } = await db.query<{ listing_id: UUID; timezone: string }>(
    `select l.listing_id::text as listing_id, l.timezone
       from listings l join instruments i on i.instrument_id = l.instrument_id
      where i.asset_type = 'common_stock'
        and (case when $1 = 'issuer' then i.issuer_id else l.listing_id end) = $2::uuid
        and (l.active_from is null or l.active_from <= $3::timestamptz)
        and (l.active_to is null or l.active_to > $3::timestamptz)`,
    [subject.kind, subject.id, asOf],
  );
  if (rows.length !== 1) return { status: "gap", reason_code: "split_listing_unresolved" };
  const { listing_id, timezone } = rows[0]!;
  const history = await loadListingSplits(db, listing_id);
  if (history.checked_at === null) return { status: "gap", reason_code: "split_history_missing" };
  return { status: "ok", listing_id, timezone, checked_at: history.checked_at, splits: history.splits };
}

type HistoryRow = {
  checked_at: Date;
  source_id: string;
  execution_date: string | null;
  split_from: string;
  split_to: string;
  provider_ref: string | null;
};

export async function loadListingSplits(db: ListingQueryExecutor, listingId: UUID): Promise<ListingSplitHistory> {
  const { rows } = await db.query<HistoryRow>(
    `select c.checked_at, c.source_id::text as source_id, s.execution_date::text as execution_date,
            s.split_from::text as split_from, s.split_to::text as split_to, s.provider_ref
       from listing_split_coverage c
       left join listing_splits s on s.listing_id = c.listing_id
      where c.listing_id = $1::uuid
      order by s.execution_date`,
    [listingId],
  );
  if (rows.length === 0) return Object.freeze({ checked_at: null });
  return Object.freeze({
    checked_at: rows[0].checked_at.toISOString(),
    source_id: rows[0].source_id,
    splits: Object.freeze(
      rows.flatMap(({ execution_date, split_from, split_to, provider_ref }) =>
        execution_date === null ? [] : [Object.freeze({ execution_date, split_from, split_to, provider_ref })],
      ),
    ),
  });
}
