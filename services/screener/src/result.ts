// Screener result-row + response envelope (spec §6.7.1).
//
// One row per matched subject. Each row is intentionally thinner than
// symbol-detail hydration: identity + display + rank + compact quote
// and fundamentals summaries — sufficient for screener-table rendering,
// no more. Selecting a row hands off `row.subject_ref` to the
// symbol-entry flow (cw0.6.3); the symbol workspace then refetches
// whatever it needs. We do NOT embed the full subject payload here.
//
// The response wraps an ordered row set with the bound query (so
// consumers can replay or cache by query identity), pagination metadata,
// and an `as_of` timestamp + `snapshot_compatible` flag mirroring the
// pattern from `services/market/src/series-query.ts`.

import { DELAY_CLASSES_FOR_SCREENER } from "./fields.ts";
import {
  LIMIT_MAX,
  LIMIT_MIN,
  normalizedScreenerQuery,
  type ScreenerPage,
  type ScreenerQuery,
} from "./query.ts";
import {
  freezeSubjectRef,
  type ScreenerSubjectRef,
} from "./subject-ref.ts";
import {
  assertBoolean,
  assertCurrency,
  assertHasFields,
  assertIntegerInRange,
  assertIso8601Utc,
  assertNonEmptyString,
  assertNonNegativeInteger,
  assertNullableFiniteNonNegative,
  assertNullableFiniteNumber,
  assertNullableFinitePositive,
  assertOneOf,
  assertPositiveInteger,
} from "./validators.ts";

// Compact quote snapshot — fixed shape so the screener table can render
// the same columns regardless of which clauses the query specified.
// Optional numeric fields are nullable, not undefined: `null` means
// "we know there is no value", `undefined` would mean "field absent".
export type ScreenerQuoteSummary = {
  last_price: number | null;
  prev_close: number | null;
  change_pct: number | null;
  volume: number | null;
  delay_class: string;
  currency: string;
  as_of: string;
};

// Compact fundamentals snapshot — keys mirror the FUNDAMENTALS dimension
// in `fields.ts`. All values nullable to express "data not available
// for this subject" without inventing a sentinel.
export type ScreenerFundamentalsSummary = {
  market_cap: number | null;
  pe_ratio: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  net_margin: number | null;
  revenue_growth_yoy: number | null;
};

// Display identity — `primary` is the headline label and is always
// present. The other fields are optional because they only make sense
// for certain subject kinds (e.g. `mic` for listings, `legal_name` for
// issuers). The screener service populates whichever fields it has.
export type ScreenerDisplay = {
  primary: string;
  ticker?: string;
  mic?: string;
  legal_name?: string;
  share_class?: string;
};

export type ScreenerResultRow = {
  subject_ref: ScreenerSubjectRef;
  display: ScreenerDisplay;
  // 1-based rank within the response. Strictly increasing across rows
  // so consumers can detect a corrupt or reordered batch by inspection.
  rank: number;
  quote: ScreenerQuoteSummary;
  fundamentals: ScreenerFundamentalsSummary;
};

export type ScreenerResponse = {
  query: ScreenerQuery;
  rows: ReadonlyArray<ScreenerResultRow>;
  // Total matches before pagination. `total_count >= rows.length` and
  // `rows.length <= page.limit`. Consumers paginate by reissuing the
  // query with an updated `page.offset`.
  total_count: number;
  page: ScreenerPage;
  as_of: string;
  snapshot_compatible: boolean;
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

export function normalizedScreenerResponse(
  input: ScreenerResponse,
): ScreenerResponse {
  if (input === null || typeof input !== "object") {
    throw new Error("normalizedScreenerResponse: must be an object");
  }

  const query = normalizedScreenerQuery(input.query);
  assertBoolean(
    input.snapshot_compatible,
    "normalizedScreenerResponse.snapshot_compatible",
  );
  assertIso8601Utc(input.as_of, "normalizedScreenerResponse.as_of");
  assertNonNegativeInteger(
    input.total_count,
    "normalizedScreenerResponse.total_count",
  );

  const page = freezePageEcho(
    input.page,
    query.page,
    "normalizedScreenerResponse.page",
  );
  const rows = freezeRows(
    input.rows,
    page,
    input.total_count,
    "normalizedScreenerResponse.rows",
  );

  return Object.freeze({
    query,
    rows,
    total_count: input.total_count,
    page,
    as_of: input.as_of,
    snapshot_compatible: input.snapshot_compatible,
  });
}

export function assertScreenerResponseContract(
  value: unknown,
): asserts value is ScreenerResponse {
  if (value === null || typeof value !== "object") {
    throw new Error("screenerResponse: must be an object");
  }
  normalizedScreenerResponse(value as ScreenerResponse);
}

function freezePageEcho(
  value: unknown,
  queryPage: ScreenerPage,
  label: string,
): ScreenerPage {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;
  // Validate shape before the echo comparison: a stringly-typed `"50"`
  // would print identically to numeric 50 and produce a "expected 50,
  // got 50" error that hides the type mismatch. Asserting integer-in-range
  // first surfaces the real cause.
  const limit = raw.limit;
  assertIntegerInRange(limit, `${label}.limit`, LIMIT_MIN, LIMIT_MAX);
  if (limit !== queryPage.limit) {
    throw new Error(
      `${label}.limit: response page must echo query page (expected ${queryPage.limit}, got ${limit})`,
    );
  }
  const offset = raw.offset;
  if (offset !== undefined) {
    assertNonNegativeInteger(offset, `${label}.offset`);
  }
  const queryOffset = queryPage.offset ?? 0;
  const responseOffset = offset ?? 0;
  if (responseOffset !== queryOffset) {
    throw new Error(
      `${label}.offset: response page must echo query page (expected ${queryOffset}, got ${responseOffset})`,
    );
  }
  const out: { limit: number; offset?: number } = { limit: queryPage.limit };
  if (queryPage.offset !== undefined) {
    out.offset = queryPage.offset;
  }
  return Object.freeze(out);
}

function freezeRows(
  value: unknown,
  page: ScreenerPage,
  totalCount: number,
  label: string,
): ReadonlyArray<ScreenerResultRow> {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: must be an array`);
  }
  if (value.length > page.limit) {
    throw new Error(
      `${label}: row count (${value.length}) exceeds page.limit (${page.limit})`,
    );
  }
  if (value.length > totalCount) {
    throw new Error(
      `${label}: row count (${value.length}) exceeds total_count (${totalCount})`,
    );
  }

  const seenSubjectKeys = new Set<string>();
  let prevRank = 0;
  const frozen: ScreenerResultRow[] = [];

  for (let i = 0; i < value.length; i++) {
    const row = freezeRow(value[i], `${label}[${i}]`);
    if (row.rank <= prevRank) {
      throw new Error(
        `${label}[${i}].rank: ${row.rank} is not strictly greater than previous rank (${prevRank})`,
      );
    }
    prevRank = row.rank;
    const subjectKey = `${row.subject_ref.kind}:${row.subject_ref.id}`;
    if (seenSubjectKeys.has(subjectKey)) {
      throw new Error(
        `${label}[${i}].subject_ref: duplicate subject ${subjectKey}`,
      );
    }
    seenSubjectKeys.add(subjectKey);
    frozen.push(row);
  }

  return Object.freeze(frozen);
}

function freezeRow(value: unknown, label: string): ScreenerResultRow {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;

  const subject_ref = freezeSubjectRef(
    raw.subject_ref as ScreenerSubjectRef,
    `${label}.subject_ref`,
  );
  const display = freezeDisplay(raw.display, `${label}.display`);
  const rank = raw.rank;
  assertPositiveInteger(rank, `${label}.rank`);
  const quote = freezeQuote(raw.quote, `${label}.quote`);
  const fundamentals = freezeFundamentals(
    raw.fundamentals,
    `${label}.fundamentals`,
  );

  return Object.freeze({
    subject_ref,
    display,
    rank,
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

function freezeQuote(value: unknown, label: string): ScreenerQuoteSummary {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;
  assertHasFields(raw, QUOTE_FIELDS, label);

  // Prices are positive when present (matches market service convention);
  // change_pct can be any sign; volume is non-negative.
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

function freezeFundamentals(
  value: unknown,
  label: string,
): ScreenerFundamentalsSummary {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;
  assertHasFields(raw, FUNDAMENTALS_FIELDS, label);

  // market_cap is a non-negative quantity when present; the rest are
  // signed (margins, growth, P/E can all be negative).
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
