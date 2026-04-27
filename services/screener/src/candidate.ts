// Pre-hydrated candidate registry (cw0.7.4 runtime).
//
// The screener executor needs every candidate's universe / market /
// fundamentals values to evaluate query clauses. Doing live HTTP fan-out
// to /v1/market/* and /v1/fundamentals/* per candidate per query would
// turn one screen run into N×K cross-service round-trips. Instead, the
// screener service owns a candidate registry that is pre-hydrated by an
// upstream poller (out of scope for this bead) or fixture-loaded for
// dev. The executor reads from the registry; the registry is the only
// place candidate identity + values live.
//
// Fields exposed in `universe` / `quote` / `fundamentals` mirror the
// closed registry in `fields.ts`. Adding a new screener-queryable field
// is still one registry edit there + a backing hydration step here —
// never an opaque pass-through to a provider payload.

import {
  ASSET_TYPES,
  DELAY_CLASSES_FOR_SCREENER,
  type AssetType,
} from "./fields.ts";
import type {
  ScreenerFundamentalsSummary,
  ScreenerQuoteSummary,
  ScreenerDisplay,
} from "./result.ts";
import { freezeSubjectRef, type ScreenerSubjectRef } from "./subject-ref.ts";
import {
  assertCurrency,
  assertHasFields,
  assertIso8601Utc,
  assertNonEmptyString,
  assertNullableFiniteNonNegative,
  assertNullableFiniteNumber,
  assertNullableFinitePositive,
  assertOneOf,
} from "./validators.ts";

export type ScreenerCandidateUniverse = {
  asset_type: AssetType;
  mic: string;
  trading_currency: string;
  domicile: string;
  sector: string;
  industry: string;
};

export type ScreenerCandidate = {
  subject_ref: ScreenerSubjectRef;
  display: ScreenerDisplay;
  universe: ScreenerCandidateUniverse;
  quote: ScreenerQuoteSummary;
  fundamentals: ScreenerFundamentalsSummary;
};

export type ScreenerCandidateRepository = {
  list(): ReadonlyArray<ScreenerCandidate>;
  findByRef(ref: ScreenerSubjectRef): ScreenerCandidate | null;
};

const QUOTE_FIELDS = [
  "last_price",
  "prev_close",
  "change_pct",
  "volume",
  "delay_class",
  "currency",
  "as_of",
] as const;

const FUNDAMENTALS_FIELDS = [
  "market_cap",
  "pe_ratio",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "revenue_growth_yoy",
] as const;

const UNIVERSE_FIELDS = [
  "asset_type",
  "mic",
  "trading_currency",
  "domicile",
  "sector",
  "industry",
] as const;

export function createInMemoryCandidateRepository(
  records: ReadonlyArray<ScreenerCandidate>,
): ScreenerCandidateRepository {
  // Pre-validate + freeze at construction so per-query reads never have to
  // re-check shape. Mirrors the listing/holders/issuer repos in the sibling
  // services.
  const frozen = records.map((r, i) => freezeCandidate(r, `candidates[${i}]`));
  const seen = new Set<string>();
  for (let i = 0; i < frozen.length; i++) {
    const key = `${frozen[i].subject_ref.kind}:${frozen[i].subject_ref.id}`;
    if (seen.has(key)) {
      throw new Error(`candidates[${i}].subject_ref: duplicate ${key}`);
    }
    seen.add(key);
  }
  const byKey = new Map<string, ScreenerCandidate>();
  for (const c of frozen) {
    byKey.set(`${c.subject_ref.kind}:${c.subject_ref.id}`, c);
  }
  const list = Object.freeze([...frozen]);
  return {
    list() {
      return list;
    },
    findByRef(ref) {
      return byKey.get(`${ref.kind}:${ref.id}`) ?? null;
    },
  };
}

function freezeCandidate(
  value: unknown,
  label: string,
): ScreenerCandidate {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const subject_ref = freezeSubjectRef(
    raw.subject_ref as ScreenerSubjectRef,
    `${label}.subject_ref`,
  );
  const display = freezeDisplay(raw.display, `${label}.display`);
  const universe = freezeUniverse(raw.universe, `${label}.universe`);
  const quote = freezeQuoteValues(raw.quote, `${label}.quote`);
  const fundamentals = freezeFundamentalsValues(
    raw.fundamentals,
    `${label}.fundamentals`,
  );
  return Object.freeze({
    subject_ref,
    display,
    universe,
    quote,
    fundamentals,
  });
}

function freezeDisplay(value: unknown, label: string): ScreenerDisplay {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;
  assertNonEmptyString(raw.primary, `${label}.primary`);
  const out: ScreenerDisplay = { primary: raw.primary };
  for (const key of ["ticker", "mic", "legal_name", "share_class"] as const) {
    if (raw[key] !== undefined) {
      assertNonEmptyString(raw[key], `${label}.${key}`);
      out[key] = raw[key] as string;
    }
  }
  return Object.freeze(out);
}

function freezeUniverse(
  value: unknown,
  label: string,
): ScreenerCandidateUniverse {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;
  assertHasFields(raw, UNIVERSE_FIELDS, label);
  assertOneOf(raw.asset_type, ASSET_TYPES, `${label}.asset_type`);
  for (const key of ["mic", "trading_currency", "domicile", "sector", "industry"] as const) {
    assertNonEmptyString(raw[key], `${label}.${key}`);
  }
  return Object.freeze({
    asset_type: raw.asset_type as AssetType,
    mic: raw.mic as string,
    trading_currency: raw.trading_currency as string,
    domicile: raw.domicile as string,
    sector: raw.sector as string,
    industry: raw.industry as string,
  });
}

function freezeQuoteValues(
  value: unknown,
  label: string,
): ScreenerQuoteSummary {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;
  assertHasFields(raw, QUOTE_FIELDS, label);

  const last_price = raw.last_price;
  assertNullableFinitePositive(last_price, `${label}.last_price`);
  const prev_close = raw.prev_close;
  assertNullableFinitePositive(prev_close, `${label}.prev_close`);
  const change_pct = raw.change_pct;
  assertNullableFiniteNumber(change_pct, `${label}.change_pct`);
  const volume = raw.volume;
  assertNullableFiniteNonNegative(volume, `${label}.volume`);
  const delay_class = raw.delay_class;
  assertOneOf(delay_class, DELAY_CLASSES_FOR_SCREENER, `${label}.delay_class`);
  const currency = raw.currency;
  assertCurrency(currency, `${label}.currency`);
  const as_of = raw.as_of;
  assertIso8601Utc(as_of, `${label}.as_of`);

  return Object.freeze({
    last_price,
    prev_close,
    change_pct,
    volume,
    delay_class,
    currency,
    as_of,
  });
}

function freezeFundamentalsValues(
  value: unknown,
  label: string,
): ScreenerFundamentalsSummary {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;
  assertHasFields(raw, FUNDAMENTALS_FIELDS, label);

  const market_cap = raw.market_cap;
  assertNullableFiniteNonNegative(market_cap, `${label}.market_cap`);
  const pe_ratio = raw.pe_ratio;
  assertNullableFiniteNumber(pe_ratio, `${label}.pe_ratio`);
  const gross_margin = raw.gross_margin;
  assertNullableFiniteNumber(gross_margin, `${label}.gross_margin`);
  const operating_margin = raw.operating_margin;
  assertNullableFiniteNumber(operating_margin, `${label}.operating_margin`);
  const net_margin = raw.net_margin;
  assertNullableFiniteNumber(net_margin, `${label}.net_margin`);
  const revenue_growth_yoy = raw.revenue_growth_yoy;
  assertNullableFiniteNumber(revenue_growth_yoy, `${label}.revenue_growth_yoy`);

  return Object.freeze({
    market_cap,
    pe_ratio,
    gross_margin,
    operating_margin,
    net_margin,
    revenue_growth_yoy,
  });
}
