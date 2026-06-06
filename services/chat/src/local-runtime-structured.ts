import {
  cachedQuoteIsFresh,
  createPostgresMarketCacheRepository,
  type CachedQuote,
} from "../../market/src/cache-repository.ts";
import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";
import type { HydratedSubjectHandoff } from "../../resolver/src/flow.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import {
  loadRecentIssuerFundamentals,
  type IssuerFundamentalFact,
} from "../../fundamentals/src/issuer-fundamentals-reader.ts";

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

// The canonical reader (services/fundamentals/src/issuer-fundamentals-reader.ts)
// owns this shape now. Kept as an alias so the chat module + its test reference
// one local name.
export type IssuerFactSummary = IssuerFundamentalFact;

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

export type FactRecency = {
  latest_as_of: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  age_days: number;
  stale: boolean;
};

export type StructuredSubjectContext = {
  facts: ReadonlyArray<IssuerFactSummary>;
  quote: QuoteSummary | null;
  source_ids: ReadonlyArray<string>;
  fact_recency: FactRecency | null;
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
    fact_recency: factRecencyFrom(facts, now),
  });
}

async function loadIssuerFacts(
  db: QueryExecutor,
  issuer: (SubjectRef & { kind: "issuer" }) | null,
  limit: number,
): Promise<IssuerFactSummary[]> {
  if (issuer === null) return [];
  // The canonical reader owns the eligibility filter (reported, active, entitled
  // for the "app" channel, display-verified). Chat answers render on "app".
  return loadRecentIssuerFundamentals(db, issuer, { channel: "app", limit });
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

// Even an annual-only filer reports within ~365 days plus a filing lag; a newest
// reported fact older than this means the issuer has effectively stopped
// reporting (or ingestion is behind), not a normal quarterly gap.
export const STALE_FACT_AGE_DAYS = 400;

const FACT_RECENCY_DAY_MS = 86_400_000;

// Set-level recency for a loaded fact set: how old is the NEWEST reported fact.
// A fact set deliberately spans old comparison years, so freshness is a property
// of the newest fact, not each row. Pure and clock-injected for testing.
export function factRecencyFrom(
  facts: ReadonlyArray<IssuerFactSummary>,
  now: string,
): FactRecency | null {
  let latest: IssuerFactSummary | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const fact of facts) {
    const ms = Date.parse(fact.as_of);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = fact;
    }
  }
  if (latest === null) return null;
  const age_days = Math.max(0, Math.floor((Date.parse(now) - latestMs) / FACT_RECENCY_DAY_MS));
  return Object.freeze({
    latest_as_of: latest.as_of,
    fiscal_year: latest.fiscal_year,
    fiscal_period: latest.fiscal_period,
    age_days,
    stale: age_days > STALE_FACT_AGE_DAYS,
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

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

