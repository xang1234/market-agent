import {
  cachedQuoteIsFresh,
  createPostgresMarketCacheRepository,
  type CachedQuote,
} from "../../market/src/cache-repository.ts";
import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";
import type { HydratedSubjectHandoff } from "../../resolver/src/flow.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";

// Structured (non-research) context for the chat analyst. The local runtime
// historically grounded answers only on research claims, so subjects with price
// and fundamentals but no extracted claims (the common case in dev, and any
// freshly-covered name in prod) looked like "no data". This module loads the
// latest quote and issuer fundamentals that already exist so the analyst can
// answer from them, only reporting insufficient_evidence when nothing exists.
//
// Subject identity is taken from the resolver's already-hydrated handoff rather
// than re-derived with SQL joins, and the quote is read through the canonical
// market cache repository instead of a bespoke query.

export type IssuerFactSummary = {
  metric_key: string;
  display_name: string | null;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  currency: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  as_of: string;
  source_id: string;
};

export type QuoteSummary = {
  listing_id: string;
  ticker: string | null;
  provider: string;
  price: number;
  prev_close: number;
  change_abs: number;
  // Fraction (change_abs / prev_close), matching NormalizedQuote — not a percent.
  change_pct: number;
  session_state: string;
  delay_class: string;
  currency: string;
  as_of: string;
  source_id: string;
  // When this cache entry expires. The chat path reads the latest cached quote
  // (it does not fetch live), so these two fields let the analyst tell a current
  // price from a stale one instead of presenting an old quote as live.
  expires_at: string;
  stale: boolean;
};

export type StructuredSubjectContext = {
  facts: ReadonlyArray<IssuerFactSummary>;
  quote: QuoteSummary | null;
  source_ids: ReadonlyArray<string>;
};

// The resolved identity the structured loaders key off: an issuer for facts and
// its listings (with display tickers) for quotes. Both already live in the
// resolver handoff, so callers pass them straight through.
export type StructuredSubjectRefs = {
  issuer: (SubjectRef & { kind: "issuer" }) | null;
  listings: ReadonlyArray<{ ref: ListingSubjectRef; ticker: string | null }>;
};

export const NO_STRUCTURED_REFS: StructuredSubjectRefs = Object.freeze({
  issuer: null,
  listings: Object.freeze([]),
});

// The degraded structured context: used when there is no resolved subject, or
// when the structured load fails and the turn falls back rather than throwing.
export const NO_STRUCTURED_CONTEXT: StructuredSubjectContext = Object.freeze({
  facts: Object.freeze([]),
  quote: null,
  source_ids: Object.freeze([]),
});

type FactRow = {
  metric_key: string;
  display_name: string | null;
  value_num: number | string | null;
  value_text: string | null;
  unit: string | null;
  currency: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  as_of: Date | string;
  source_id: string;
};

const DEFAULT_FACT_LIMIT = 24;

// Pulls the already-resolved issuer + listings out of the resolver handoff so
// the loaders never re-derive the subject graph. An issuer-kind subject is its
// own issuer; a listing/instrument carries its issuer_ref in context.
export function structuredRefsFromHandoff(handoff: HydratedSubjectHandoff): StructuredSubjectRefs {
  const ctx = handoff.context;
  const issuer = ctx.issuer?.subject_ref
    ?? ctx.listing?.issuer_ref
    ?? ctx.instrument?.issuer_ref
    ?? (handoff.subject_ref.kind === "issuer" ? handoff.subject_ref : null);
  const listingContexts = ctx.listing ? [ctx.listing] : ctx.active_listings ?? [];
  const listings = listingContexts.map((listing) => ({
    ref: listing.subject_ref,
    ticker: listing.ticker,
  }));
  return Object.freeze({ issuer: issuer ?? null, listings: Object.freeze(listings) });
}

export async function loadStructuredSubjectContext(
  db: QueryExecutor,
  refs: StructuredSubjectRefs,
  options: { factLimit?: number; now?: string } = {},
): Promise<StructuredSubjectContext> {
  const now = options.now ?? new Date().toISOString();
  // facts and quote are independent DB reads; settle them separately so a failing
  // facts query doesn't discard a good quote (or vice-versa). The caller degrades
  // the whole structured context only when it truly has nothing.
  const [factsResult, quoteResult] = await Promise.allSettled([
    loadIssuerFacts(db, refs.issuer, options.factLimit ?? DEFAULT_FACT_LIMIT),
    loadLatestListingQuote(db, refs.listings, now),
  ]);
  if (factsResult.status === "rejected") {
    console.warn("[chat] issuer facts load failed; serving without fundamentals", factsResult.reason);
  }
  if (quoteResult.status === "rejected") {
    console.warn("[chat] quote load failed; serving without a price", quoteResult.reason);
  }
  const facts = factsResult.status === "fulfilled" ? factsResult.value : [];
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;

  const sourceIds = unique([
    ...facts.map((fact) => fact.source_id),
    ...(quote ? [quote.source_id] : []),
  ]);

  return Object.freeze({
    facts: Object.freeze(facts),
    quote,
    source_ids: Object.freeze(sourceIds),
  });
}

async function loadIssuerFacts(
  db: QueryExecutor,
  issuer: (SubjectRef & { kind: "issuer" }) | null,
  limit: number,
): Promise<IssuerFactSummary[]> {
  if (issuer === null) return [];
  const { rows } = await db.query<FactRow>(
    // method = 'reported' matches every canonical fact reader (sec-facts-repository,
    // screener db-candidates) so derived/estimated facts never leak into the answer.
    `select m.metric_key,
            m.display_name,
            f.value_num,
            f.value_text,
            f.unit,
            f.currency,
            f.fiscal_year,
            f.fiscal_period,
            f.as_of,
            f.source_id::text as source_id
       from facts f
       join metrics m on m.metric_id = f.metric_id
      where f.subject_kind = 'issuer'
        and f.subject_id = $1::uuid
        and f.method = 'reported'
        and f.superseded_by is null
        and f.invalidated_at is null
      order by f.fiscal_year desc nulls last,
               f.as_of desc,
               m.metric_key
      limit $2`,
    [issuer.id, limit],
  );
  return rows.map(factSummaryFromRow);
}

// Reads each listing's latest quote through the canonical market cache repository
// and returns the freshest across the subject's listings (usually just one).
async function loadLatestListingQuote(
  db: QueryExecutor,
  listings: StructuredSubjectRefs["listings"],
  now: string,
): Promise<QuoteSummary | null> {
  if (listings.length === 0) return null;
  const cache = createPostgresMarketCacheRepository(db);
  const quotes = await Promise.all(
    listings.map(async (listing) => {
      const cached = await cache.findLatestQuote(listing.ref);
      return cached ? quoteSummaryFromCachedQuote(cached, listing.ticker, now) : null;
    }),
  );
  return quotes.reduce<QuoteSummary | null>(
    (freshest, quote) =>
      quote && (freshest === null || quote.as_of > freshest.as_of) ? quote : freshest,
    null,
  );
}

export function factSummaryFromRow(row: FactRow): IssuerFactSummary {
  return Object.freeze({
    metric_key: row.metric_key,
    display_name: row.display_name,
    value_num: numericOrNull(row.value_num),
    value_text: row.value_text,
    unit: row.unit,
    currency: row.currency,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
    as_of: isoString(row.as_of),
    source_id: row.source_id,
  });
}

export function quoteSummaryFromCachedQuote(
  cached: CachedQuote,
  ticker: string | null,
  now: string = new Date().toISOString(),
): QuoteSummary {
  const quote = cached.quote;
  return Object.freeze({
    listing_id: quote.listing.id,
    ticker,
    provider: cached.provider,
    price: quote.price,
    prev_close: quote.prev_close,
    change_abs: quote.change_abs,
    change_pct: quote.change_pct,
    session_state: quote.session_state,
    delay_class: quote.delay_class,
    currency: quote.currency,
    as_of: quote.as_of,
    source_id: quote.source_id,
    expires_at: cached.expires_at,
    stale: !cachedQuoteIsFresh(cached, now),
  });
}

export function structuredEvidenceStatus(input: {
  claimCount: number;
  factCount: number;
  quote: QuoteSummary | null;
}): "available" | "insufficient_evidence" {
  const hasAny = input.claimCount > 0 || input.factCount > 0 || input.quote !== null;
  return hasAny ? "available" : "insufficient_evidence";
}

function numericOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
