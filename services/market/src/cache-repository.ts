import {
  normalizedBars,
  type AdjustmentBasis,
  type BarInterval,
  type BarRange,
  type NormalizedBar,
  type NormalizedBars,
} from "./bar.ts";
import { normalizedQuote, type NormalizedQuote } from "./quote.ts";
import type { ListingSubjectRef } from "./subject-ref.ts";

export type MarketCacheMetadata = {
  provider: string;
  fetched_at: string;
  expires_at: string;
};

export type CachedQuote = {
  quote: NormalizedQuote;
  provider: string;
  fetched_at: string;
  expires_at: string;
};

// Canonical freshness rule for a cached quote, mirroring findFreshQuote's SQL
// (`expires_at > now`). Exposed so consumers that read the latest cached quote
// directly (e.g. the chat structured-context loader) can apply the SAME notion
// of freshness instead of inventing their own age threshold.
export function cachedQuoteIsFresh(cached: CachedQuote, now: string): boolean {
  return Date.parse(cached.expires_at) > Date.parse(now);
}

export type CachedBars = {
  bars: NormalizedBars;
  provider: string;
  fetched_at: string;
  expires_at: string;
};

export type BarsCacheLookup = {
  listing: ListingSubjectRef;
  interval: BarInterval;
  range: BarRange;
  adjustment_basis: AdjustmentBasis;
  now: string;
};

export type MarketCacheRepository = {
  findFreshQuote(listing: ListingSubjectRef, now: string): Promise<CachedQuote | null>;
  findLatestQuote(listing: ListingSubjectRef): Promise<CachedQuote | null>;
  storeQuote(quote: NormalizedQuote, metadata: MarketCacheMetadata): Promise<void>;
  findFreshBars(lookup: BarsCacheLookup): Promise<CachedBars | null>;
  findLatestBars(
    listing: ListingSubjectRef,
    interval: BarInterval,
    range: BarRange,
    adjustment_basis: AdjustmentBasis,
  ): Promise<CachedBars | null>;
  storeBars(bars: NormalizedBars, metadata: MarketCacheMetadata): Promise<void>;
};

export type MarketCacheQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

type MarketCacheTransactionClient = MarketCacheQueryExecutor & {
  release(): void;
};

type MarketCacheTransactionalExecutor = MarketCacheQueryExecutor & {
  connect(): Promise<MarketCacheTransactionClient>;
};

export function createInMemoryMarketCacheRepository(): MarketCacheRepository {
  const quotes = new Map<string, CachedQuote[]>();
  const bars = new Map<string, CachedBars>();

  return {
    async findFreshQuote(listing, now) {
      return latestFreshQuote(quotes.get(listingKey(listing)) ?? [], now);
    },
    async findLatestQuote(listing) {
      return latestQuote(quotes.get(listingKey(listing)) ?? []);
    },
    async storeQuote(quote, metadata) {
      const key = listingKey(quote.listing);
      const list = quotes.get(key) ?? [];
      const cached = freezeCachedQuote(quote, metadata);
      const existing = list.findIndex((entry) => entry.quote.source_id === quote.source_id && entry.quote.as_of === quote.as_of);
      if (existing >= 0) list[existing] = cached;
      else list.push(cached);
      list.sort((a, b) => b.quote.as_of.localeCompare(a.quote.as_of));
      quotes.set(key, list);
    },
    async findFreshBars(lookup) {
      const cached = bars.get(barsKey(lookup.listing, lookup.interval, lookup.range, lookup.adjustment_basis));
      if (!cached) return null;
      return Date.parse(cached.expires_at) > Date.parse(lookup.now) ? cached : null;
    },
    async findLatestBars(listing, interval, range, adjustment_basis) {
      return bars.get(barsKey(listing, interval, range, adjustment_basis)) ?? null;
    },
    async storeBars(value, metadata) {
      bars.set(
        barsKey(value.listing, value.interval, value.range, value.adjustment_basis),
        freezeCachedBars(value, metadata),
      );
    },
  };
}

export function createPostgresMarketCacheRepository(
  db: MarketCacheQueryExecutor,
): MarketCacheRepository {
  return {
    async findFreshQuote(listing, now) {
      const { rows } = await db.query<QuoteRow>(
        `${QUOTE_SELECT}
           from market_quote_snapshots
          where listing_id = $1::uuid
            and expires_at > $2::timestamptz
          order by as_of desc, fetched_at desc
          limit 1`,
        [listing.id, now],
      );
      return rows[0] ? quoteFromRow(rows[0]) : null;
    },
    async findLatestQuote(listing) {
      const { rows } = await db.query<QuoteRow>(
        `${QUOTE_SELECT}
           from market_quote_snapshots
          where listing_id = $1::uuid
          order by as_of desc, fetched_at desc
          limit 1`,
        [listing.id],
      );
      return rows[0] ? quoteFromRow(rows[0]) : null;
    },
    async storeQuote(quote, metadata) {
      await db.query(
        `insert into market_quote_snapshots
           (listing_id, source_id, provider, price, prev_close, session_state, as_of,
            delay_class, currency, fetched_at, expires_at, payload)
         values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz,
                 $8, $9, $10::timestamptz, $11::timestamptz, $12::jsonb)
         on conflict (listing_id, source_id, as_of)
         do update set provider = excluded.provider,
                       price = excluded.price,
                       prev_close = excluded.prev_close,
                       session_state = excluded.session_state,
                       delay_class = excluded.delay_class,
                       currency = excluded.currency,
                       fetched_at = excluded.fetched_at,
                       expires_at = excluded.expires_at,
                       payload = excluded.payload,
                       updated_at = now()`,
        [
          quote.listing.id,
          quote.source_id,
          metadata.provider,
          quote.price,
          quote.prev_close,
          quote.session_state,
          quote.as_of,
          quote.delay_class,
          quote.currency,
          metadata.fetched_at,
          metadata.expires_at,
          JSON.stringify(quote),
        ],
      );
    },
    async findFreshBars(lookup) {
      const cached = await findBars(db, lookup.listing, lookup.interval, lookup.range, lookup.adjustment_basis, lookup.now);
      return cached;
    },
    async findLatestBars(listing, interval, range, adjustment_basis) {
      return findBars(db, listing, interval, range, adjustment_basis);
    },
    async storeBars(value, metadata) {
      await withCacheTransaction(db, async (tx) => {
        const { rows } = await tx.query<{ bar_range_id: string }>(
          `insert into market_bar_ranges
             (listing_id, source_id, provider, interval, adjustment_basis, range_start, range_end,
              as_of, delay_class, currency, fetched_at, expires_at, payload)
           values ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7::timestamptz,
                   $8::timestamptz, $9, $10, $11::timestamptz, $12::timestamptz, $13::jsonb)
           on conflict (listing_id, source_id, interval, adjustment_basis, range_start, range_end)
           do update set provider = excluded.provider,
                         as_of = excluded.as_of,
                         delay_class = excluded.delay_class,
                         currency = excluded.currency,
                         fetched_at = excluded.fetched_at,
                         expires_at = excluded.expires_at,
                         payload = excluded.payload,
                         updated_at = now()
           returning bar_range_id::text as bar_range_id`,
          [
            value.listing.id,
            value.source_id,
            metadata.provider,
            value.interval,
            value.adjustment_basis,
            value.range.start,
            value.range.end,
            value.as_of,
            value.delay_class,
            value.currency,
            metadata.fetched_at,
            metadata.expires_at,
            JSON.stringify(value),
          ],
        );
        const barRangeId = rows[0]?.bar_range_id;
        if (!barRangeId) throw new Error("market bar range upsert did not return an id");
        await tx.query(`delete from market_bars where bar_range_id = $1::uuid`, [barRangeId]);
        await insertBars(tx, barRangeId, value.bars);
      });
    },
  };
}

const QUOTE_SELECT = `select listing_id::text as listing_id,
                             source_id::text as source_id,
                             provider,
                             price::float8 as price,
                             prev_close::float8 as prev_close,
                             session_state,
                             as_of,
                             delay_class,
                             currency,
                             fetched_at,
                             expires_at`;

type QuoteRow = {
  listing_id: string;
  source_id: string;
  provider: string;
  price: number | string;
  prev_close: number | string;
  session_state: string;
  as_of: Date | string;
  delay_class: string;
  currency: string;
  fetched_at: Date | string;
  expires_at: Date | string;
};

type BarRangeRow = {
  bar_range_id: string;
  listing_id: string;
  source_id: string;
  provider: string;
  interval: string;
  adjustment_basis: string;
  range_start: Date | string;
  range_end: Date | string;
  as_of: Date | string;
  delay_class: string;
  currency: string;
  fetched_at: Date | string;
  expires_at: Date | string;
};

type BarRow = {
  ts: Date | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
};

async function withCacheTransaction<T>(
  db: MarketCacheQueryExecutor,
  fn: (tx: MarketCacheQueryExecutor) => Promise<T>,
): Promise<T> {
  if (!isTransactionalExecutor(db)) {
    return fn(db);
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function isTransactionalExecutor(
  db: MarketCacheQueryExecutor,
): db is MarketCacheTransactionalExecutor {
  return typeof (db as { connect?: unknown }).connect === "function";
}

async function insertBars(
  db: MarketCacheQueryExecutor,
  barRangeId: string,
  bars: ReadonlyArray<NormalizedBar>,
): Promise<void> {
  if (bars.length === 0) return;

  const maxBarsPerInsert = 5_000;
  for (let offset = 0; offset < bars.length; offset += maxBarsPerInsert) {
    await insertBarChunk(db, barRangeId, bars.slice(offset, offset + maxBarsPerInsert));
  }
}

async function insertBarChunk(
  db: MarketCacheQueryExecutor,
  barRangeId: string,
  bars: ReadonlyArray<NormalizedBar>,
): Promise<void> {
  const values: unknown[] = [barRangeId];
  const placeholders = bars.map((bar, index) => {
    const base = index * 6 + 2;
    values.push(bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume);
    return `($1::uuid, $${base}::timestamptz, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });

  await db.query(
    `insert into market_bars (bar_range_id, ts, open, high, low, close, volume)
     values ${placeholders.join(", ")}`,
    values,
  );
}

async function findBars(
  db: MarketCacheQueryExecutor,
  listing: ListingSubjectRef,
  interval: BarInterval,
  range: BarRange,
  adjustment_basis: AdjustmentBasis,
  now?: string,
): Promise<CachedBars | null> {
  const expiryPredicate = now ? "and expires_at > $5::timestamptz" : "";
  const values = now
    ? [listing.id, interval, adjustment_basis, range.start, now, range.end]
    : [listing.id, interval, adjustment_basis, range.start, range.end];
  const endIndex = now ? 6 : 5;
  const { rows } = await db.query<BarRangeRow>(
    `select bar_range_id::text as bar_range_id,
            listing_id::text as listing_id,
            source_id::text as source_id,
            provider,
            interval,
            adjustment_basis,
            range_start,
            range_end,
            as_of,
            delay_class,
            currency,
            fetched_at,
            expires_at
       from market_bar_ranges
      where listing_id = $1::uuid
        and interval = $2
        and adjustment_basis = $3
        and range_start = $4::timestamptz
        and range_end = $${endIndex}::timestamptz
        ${expiryPredicate}
      order by fetched_at desc
      limit 1`,
    values,
  );
  const row = rows[0];
  if (!row) return null;
  const barRows = await db.query<BarRow>(
    `select ts, open::float8 as open, high::float8 as high, low::float8 as low,
            close::float8 as close, volume::float8 as volume
       from market_bars
      where bar_range_id = $1::uuid
      order by ts asc`,
    [row.bar_range_id],
  );
  return barsFromRows(row, barRows.rows);
}

function quoteFromRow(row: QuoteRow): CachedQuote {
  return freezeCachedQuote(
    normalizedQuote({
      listing: { kind: "listing", id: row.listing_id },
      price: numberValue(row.price),
      prev_close: numberValue(row.prev_close),
      session_state: row.session_state as NormalizedQuote["session_state"],
      as_of: isoString(row.as_of),
      delay_class: row.delay_class as NormalizedQuote["delay_class"],
      currency: row.currency,
      source_id: row.source_id,
    }),
    {
      provider: row.provider,
      fetched_at: isoString(row.fetched_at),
      expires_at: isoString(row.expires_at),
    },
  );
}

function barsFromRows(row: BarRangeRow, bars: BarRow[]): CachedBars {
  const normalized = normalizedBars({
    listing: { kind: "listing", id: row.listing_id },
    interval: row.interval as BarInterval,
    range: {
      start: isoString(row.range_start),
      end: isoString(row.range_end),
    },
    bars: bars.map((bar): NormalizedBar => ({
      ts: isoString(bar.ts),
      open: numberValue(bar.open),
      high: numberValue(bar.high),
      low: numberValue(bar.low),
      close: numberValue(bar.close),
      volume: numberValue(bar.volume),
    })),
    as_of: isoString(row.as_of),
    delay_class: row.delay_class as NormalizedBars["delay_class"],
    currency: row.currency,
    source_id: row.source_id,
    adjustment_basis: row.adjustment_basis as AdjustmentBasis,
  });
  return freezeCachedBars(normalized, {
    provider: row.provider,
    fetched_at: isoString(row.fetched_at),
    expires_at: isoString(row.expires_at),
  });
}

function latestFreshQuote(entries: CachedQuote[], now: string): CachedQuote | null {
  const nowMs = Date.parse(now);
  return latestQuote(entries.filter((entry) => Date.parse(entry.expires_at) > nowMs));
}

function latestQuote(entries: CachedQuote[]): CachedQuote | null {
  return [...entries].sort((a, b) =>
    b.quote.as_of.localeCompare(a.quote.as_of) || b.fetched_at.localeCompare(a.fetched_at)
  )[0] ?? null;
}

function freezeCachedQuote(quote: NormalizedQuote, metadata: MarketCacheMetadata): CachedQuote {
  return Object.freeze({
    quote,
    provider: metadata.provider,
    fetched_at: metadata.fetched_at,
    expires_at: metadata.expires_at,
  });
}

function freezeCachedBars(bars: NormalizedBars, metadata: MarketCacheMetadata): CachedBars {
  return Object.freeze({
    bars,
    provider: metadata.provider,
    fetched_at: metadata.fetched_at,
    expires_at: metadata.expires_at,
  });
}

function listingKey(listing: ListingSubjectRef): string {
  return `${listing.kind}:${listing.id}`;
}

function barsKey(
  listing: ListingSubjectRef,
  interval: BarInterval,
  range: BarRange,
  adjustment_basis: AdjustmentBasis,
): string {
  return `${listingKey(listing)}:${interval}:${adjustment_basis}:${range.start}:${range.end}`;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function numberValue(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}
