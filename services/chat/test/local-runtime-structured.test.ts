import assert from "node:assert/strict";
import test from "node:test";

import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { CachedQuote } from "../../market/src/cache-repository.ts";
import type { HydratedSubjectHandoff } from "../../resolver/src/flow.ts";
import {
  factSummaryFromRow,
  loadStructuredSubjectContext,
  quoteSummaryFromCachedQuote,
  structuredEvidenceStatus,
  structuredRefsFromHandoff,
  type StructuredSubjectRefs,
} from "../src/local-runtime-structured.ts";

const ISSUER_ID = "b12a08d7-8ae4-4acf-bfac-8090845938c6";
const LISTING_ID = "07367650-14d7-4fbe-8668-4dc283e5fc13";
const INSTRUMENT_ID = "9764935b-0eb9-4e3b-83d6-67716750e4de";
const POLYGON_SOURCE_ID = "00000000-0000-4000-a000-000000000001";

function cachedQuote(overrides: Partial<CachedQuote["quote"]> = {}): CachedQuote {
  return {
    quote: {
      listing: { kind: "listing", id: LISTING_ID },
      price: 185.67,
      prev_close: 158.42,
      change_abs: 27.25,
      change_pct: 0.172,
      session_state: "regular",
      as_of: "2026-06-02T08:44:00.000Z",
      delay_class: "delayed_15m",
      currency: "USD",
      source_id: POLYGON_SOURCE_ID,
      ...overrides,
    },
    provider: "yahoo_finance_dev_market",
    fetched_at: "2026-06-02T08:44:01.000Z",
    expires_at: "2026-06-02T08:59:01.000Z",
  };
}

test("factSummaryFromRow coerces numeric/text columns and preserves provenance", () => {
  const summary = factSummaryFromRow({
    metric_key: "revenue",
    display_name: "Revenue",
    value_num: "190872000",
    value_text: null,
    unit: "currency",
    currency: "USD",
    fiscal_year: 2021,
    fiscal_period: "FY",
    as_of: "2026-05-08T16:57:05.951Z",
    source_id: POLYGON_SOURCE_ID,
  });

  assert.equal(summary.metric_key, "revenue");
  assert.equal(summary.display_name, "Revenue");
  // pg returns numeric as string; the summary exposes a real number for the LLM.
  assert.equal(summary.value_num, 190872000);
  assert.equal(summary.value_text, null);
  assert.equal(summary.unit, "currency");
  assert.equal(summary.currency, "USD");
  assert.equal(summary.fiscal_year, 2021);
  assert.equal(summary.fiscal_period, "FY");
  assert.equal(summary.as_of, "2026-05-08T16:57:05.951Z");
  assert.equal(summary.source_id, POLYGON_SOURCE_ID);
});

test("factSummaryFromRow keeps text-only facts and normalizes Date columns to ISO", () => {
  const summary = factSummaryFromRow({
    metric_key: "auditor",
    display_name: null,
    value_num: null,
    value_text: "Deloitte",
    unit: null,
    currency: null,
    fiscal_year: null,
    fiscal_period: null,
    as_of: new Date("2026-05-08T16:57:05.951Z"),
    source_id: "00000000-0000-4000-a000-000000000002",
  });

  assert.equal(summary.value_num, null);
  assert.equal(summary.value_text, "Deloitte");
  assert.equal(summary.as_of, "2026-05-08T16:57:05.951Z");
});

test("quoteSummaryFromCachedQuote maps the canonical quote and the supplied ticker", () => {
  // `now` before expires_at (2026-06-02T08:59:01Z) → fresh.
  const summary = quoteSummaryFromCachedQuote(cachedQuote(), "AAOI", "2026-06-02T08:50:00.000Z");

  assert.equal(summary.listing_id, LISTING_ID);
  assert.equal(summary.ticker, "AAOI");
  assert.equal(summary.provider, "yahoo_finance_dev_market");
  assert.equal(summary.price, 185.67);
  assert.equal(summary.prev_close, 158.42);
  // change_abs/change_pct come straight from NormalizedQuote — no recomputation,
  // and change_pct stays the canonical fraction (not a percent).
  assert.equal(summary.change_abs, 27.25);
  assert.equal(summary.change_pct, 0.172);
  assert.equal(summary.session_state, "regular");
  assert.equal(summary.delay_class, "delayed_15m");
  assert.equal(summary.currency, "USD");
  assert.equal(summary.source_id, POLYGON_SOURCE_ID);
  // Freshness is surfaced so the analyst can present the price honestly.
  assert.equal(summary.expires_at, "2026-06-02T08:59:01.000Z");
  assert.equal(summary.stale, false);
});

test("quoteSummaryFromCachedQuote flags a quote whose cache entry has expired as stale", () => {
  // `now` past expires_at (2026-06-02T08:59:01Z) → the cached price is stale and
  // must not be presented to the analyst as if it were current.
  const summary = quoteSummaryFromCachedQuote(cachedQuote(), "AAOI", "2026-06-03T00:00:00.000Z");

  assert.equal(summary.stale, true);
  assert.equal(summary.expires_at, "2026-06-02T08:59:01.000Z");
});

test("structuredRefsFromHandoff reads issuer + listing from a listing-resolved handoff", () => {
  const refs = structuredRefsFromHandoff(handoffWithListing());

  assert.deepEqual(refs.issuer, { kind: "issuer", id: ISSUER_ID });
  assert.equal(refs.listings.length, 1);
  assert.deepEqual(refs.listings[0].ref, { kind: "listing", id: LISTING_ID });
  assert.equal(refs.listings[0].ticker, "AAOI");
});

test("structuredRefsFromHandoff derives the issuer for an issuer-only handoff with active_listings", () => {
  const refs = structuredRefsFromHandoff(handoffIssuerOnly());

  assert.deepEqual(refs.issuer, { kind: "issuer", id: ISSUER_ID });
  // active_listings feed the quote lookup when there is no single primary listing.
  assert.equal(refs.listings.length, 1);
  assert.equal(refs.listings[0].ticker, "AAOI");
});

test("structuredRefsFromHandoff yields no listings when the subject has none", () => {
  const refs = structuredRefsFromHandoff(handoffIssuerNoListings());

  assert.deepEqual(refs.issuer, { kind: "issuer", id: ISSUER_ID });
  assert.equal(refs.listings.length, 0);
});

test("structuredEvidenceStatus is available when ANY of claims, facts, or quote exist", () => {
  const quote = quoteSummaryFromCachedQuote(cachedQuote(), "AAOI");

  // The original bug: claims alone gated the answer. Now structured data counts.
  assert.equal(structuredEvidenceStatus({ claimCount: 0, factCount: 60, quote: null }), "available");
  assert.equal(structuredEvidenceStatus({ claimCount: 0, factCount: 0, quote }), "available");
  assert.equal(structuredEvidenceStatus({ claimCount: 2, factCount: 0, quote: null }), "available");
  // Only when nothing at all is available do we report insufficient evidence.
  assert.equal(
    structuredEvidenceStatus({ claimCount: 0, factCount: 0, quote: null }),
    "insufficient_evidence",
  );
});

// A QueryExecutor that routes by SQL text: the facts query hits `from facts`,
// the quote query hits `market_quote_snapshots`. Either handler may return an
// Error to simulate a failing DB read for that one table.
function routedDb(handlers: {
  facts: () => unknown[] | Error;
  quote: () => unknown[] | Error;
}): QueryExecutor {
  const run = (handler: () => unknown[] | Error) => {
    const result = handler();
    if (result instanceof Error) throw result;
    return result;
  };
  return {
    query: (async (text: string) => {
      if (text.includes("from facts")) return { rows: run(handlers.facts) };
      if (text.includes("market_quote_snapshots")) return { rows: run(handlers.quote) };
      return { rows: [] };
    }) as QueryExecutor["query"],
  };
}

const REFS_WITH_LISTING: StructuredSubjectRefs = {
  issuer: { kind: "issuer", id: ISSUER_ID },
  listings: [{ ref: { kind: "listing", id: LISTING_ID }, ticker: "AAOI" }],
};

const QUOTE_ROW = {
  listing_id: LISTING_ID,
  source_id: POLYGON_SOURCE_ID,
  provider: "yahoo_finance_dev_market",
  price: 185.67,
  prev_close: 158.42,
  session_state: "regular",
  as_of: "2026-06-02T08:44:00.000Z",
  delay_class: "delayed_15m",
  currency: "USD",
  fetched_at: "2026-06-02T08:44:01.000Z",
  expires_at: "2026-06-02T08:59:01.000Z",
};

const FACT_ROW = {
  metric_key: "revenue",
  display_name: "Revenue",
  value_num: "190872000",
  value_text: null,
  unit: "currency",
  currency: "USD",
  fiscal_year: 2021,
  fiscal_period: "FY",
  as_of: "2026-05-08T16:57:05.951Z",
  source_id: "00000000-0000-4000-a000-000000000002",
};

test("loadStructuredSubjectContext keeps the quote when the facts read fails", async () => {
  const ctx = await loadStructuredSubjectContext(
    routedDb({ facts: () => new Error("facts table hiccup"), quote: () => [QUOTE_ROW] }),
    REFS_WITH_LISTING,
    { now: "2026-06-02T08:50:00.000Z" },
  );

  // A failing facts read must not discard a perfectly good quote.
  assert.deepEqual(ctx.facts, []);
  assert.ok(ctx.quote);
  assert.equal(ctx.quote?.price, 185.67);
  assert.equal(ctx.quote?.stale, false);
});

test("loadStructuredSubjectContext keeps the facts when the quote read fails", async () => {
  const ctx = await loadStructuredSubjectContext(
    routedDb({ facts: () => [FACT_ROW], quote: () => new Error("quote cache hiccup") }),
    REFS_WITH_LISTING,
    { now: "2026-06-02T08:50:00.000Z" },
  );

  // A failing quote read must not discard the issuer fundamentals.
  assert.equal(ctx.quote, null);
  assert.equal(ctx.facts.length, 1);
  assert.equal(ctx.facts[0].metric_key, "revenue");
});

function baseHandoff(): HydratedSubjectHandoff {
  return {
    subject_ref: { kind: "listing", id: LISTING_ID },
    identity_level: "listing",
    display_label: "Applied Optoelectronics, Inc.",
    display_labels: { primary: "Applied Optoelectronics, Inc.", ticker: "AAOI", mic: "XNAS" },
    normalized_input: "aaoi",
    resolution_path: "direct_ref",
    confidence: 0.97,
    context: {},
  };
}

function listingContext() {
  return {
    subject_ref: { kind: "listing" as const, id: LISTING_ID },
    instrument_ref: { kind: "instrument" as const, id: INSTRUMENT_ID },
    issuer_ref: { kind: "issuer" as const, id: ISSUER_ID },
    mic: "XNAS",
    ticker: "AAOI",
    trading_currency: "USD",
    timezone: "America/New_York",
  };
}

function handoffWithListing(): HydratedSubjectHandoff {
  return { ...baseHandoff(), context: { listing: listingContext() } };
}

function handoffIssuerOnly(): HydratedSubjectHandoff {
  return {
    ...baseHandoff(),
    subject_ref: { kind: "issuer", id: ISSUER_ID },
    identity_level: "issuer",
    context: {
      issuer: { subject_ref: { kind: "issuer", id: ISSUER_ID }, legal_name: "Applied Optoelectronics, Inc." },
      active_listings: [listingContext()],
    },
  };
}

function handoffIssuerNoListings(): HydratedSubjectHandoff {
  return {
    ...baseHandoff(),
    subject_ref: { kind: "issuer", id: ISSUER_ID },
    identity_level: "issuer",
    context: {
      issuer: { subject_ref: { kind: "issuer", id: ISSUER_ID }, legal_name: "Applied Optoelectronics, Inc." },
    },
  };
}
