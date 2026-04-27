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

import { ASSET_TYPES, type AssetType } from "./fields.ts";
import {
  freezeDisplay,
  freezeFundamentalsSummary,
  freezeQuoteSummary,
  type ScreenerFundamentalsSummary,
  type ScreenerQuoteSummary,
  type ScreenerDisplay,
} from "./result.ts";
import { freezeSubjectRef, type ScreenerSubjectRef } from "./subject-ref.ts";
import { assertHasFields, assertNonEmptyString, assertOneOf } from "./validators.ts";

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
  const byKey = new Map<string, ScreenerCandidate>();
  const frozen: ScreenerCandidate[] = [];
  for (let i = 0; i < records.length; i++) {
    const c = freezeCandidate(records[i], `candidates[${i}]`);
    const key = `${c.subject_ref.kind}:${c.subject_ref.id}`;
    if (byKey.has(key)) {
      throw new Error(`candidates[${i}].subject_ref: duplicate ${key}`);
    }
    byKey.set(key, c);
    frozen.push(c);
  }
  const list = Object.freeze(frozen);
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
  const quote = freezeQuoteSummary(raw.quote, `${label}.quote`);
  const fundamentals = freezeFundamentalsSummary(
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

