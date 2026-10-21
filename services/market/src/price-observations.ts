// Share prices as provider responses stated them (#444): the insert-only
// price_observations table. A capture records the provider's exact token, the
// hash of the response it came in, and the earliest instant it proves the price
// was public. The financial engine binds the latest one known by a plan's
// cutoff. This module reads and writes only the table, so the engine and the
// snapshot verifier import it without depending on Polygon.

import type { PriceObservationKind } from "../../financial-core/src/contracts.ts";
import type { ListingQueryExecutor } from "./listings.ts";
import type { UUID } from "./subject-ref.ts";

/** One price as a response stated it. `known_at` is null when the capture proves no publication time. */
export type CapturedPrice = Readonly<{
  listing_id: UUID;
  source_id: UUID;
  kind: PriceObservationKind;
  price_text: string;
  currency: string;
  observed_at: string;
  known_at: string | null;
  fetched_at: string;
  body_sha256: string;
}>;

export type PriceObservation = CapturedPrice & Readonly<{ observation_id: UUID }>;

/** Records prices, skipping any already recorded: the same statement again is the same row. Returns how many were new. */
export async function recordPriceObservations(db: ListingQueryExecutor, prices: ReadonlyArray<CapturedPrice>): Promise<number> {
  if (prices.length === 0) return 0;
  const column = <K extends keyof CapturedPrice>(key: K) => prices.map((price) => price[key]);
  const { rows } = await db.query(
    `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
     select * from unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::timestamptz[], $8::timestamptz[], $9::text[])
     on conflict on constraint price_observations_identity do nothing
     returning observation_id`,
    [
      column("listing_id"), column("source_id"), column("kind"), column("price_text"), column("currency"),
      column("observed_at"), column("known_at"), column("fetched_at"), column("body_sha256"),
    ],
  );
  return rows.length;
}

export type LatestPriceObservations = Readonly<{
  /** The observations with the newest trade time known by the cutoff, at the latest time any of them was known, with their source's `sources.kind`. */
  latest: ReadonlyArray<PriceObservation & Readonly<{ known_at: string; source_kind: string }>>;
  /** Whether an observation traded by the cutoff has no provable publication time. */
  unknown_publication: boolean;
}>;

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const ROW = `o.observation_id::text, o.listing_id::text, o.source_id::text, o.kind, o.price_text, o.currency,
             to_char(o.observed_at at time zone 'UTC', ${ISO_UTC}) as observed_at,
             to_char(o.known_at at time zone 'UTC', ${ISO_UTC}) as known_at,
             to_char(o.fetched_at at time zone 'UTC', ${ISO_UTC}) as fetched_at, o.body_sha256, s.kind::text as source_kind`;
// Public information only: a source a user uploaded never grounds a certified figure.
const PUBLIC = `price_observations o join sources s on s.source_id = o.source_id and s.user_id is null`;

/** The listing's latest public price observations known by `asOf`. */
export async function loadLatestPriceObservations(db: ListingQueryExecutor, listingId: UUID, asOf: string): Promise<LatestPriceObservations> {
  const { rows } = await db.query<PriceObservation & { known_at: string; source_kind: string }>(
    `select ${ROW} from ${PUBLIC}
      where o.listing_id = $1::uuid and o.known_at <= $2::timestamptz
        and (o.observed_at, o.known_at) = (
          select o.observed_at, o.known_at from ${PUBLIC}
           where o.listing_id = $1::uuid and o.known_at <= $2::timestamptz
           order by o.observed_at desc, o.known_at desc limit 1)
      order by o.observation_id`,
    [listingId, asOf],
  );
  const unknown = await db.query<{ unknown: boolean }>(
    `select exists (select 1 from ${PUBLIC} where o.listing_id = $1::uuid and o.known_at is null and o.observed_at <= $2::timestamptz) as unknown`,
    [listingId, asOf],
  );
  return { latest: rows, unknown_publication: unknown.rows[0]!.unknown };
}
