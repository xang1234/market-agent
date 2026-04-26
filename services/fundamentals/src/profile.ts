// IssuerProfile is the durable, deterministic identity envelope the
// fundamentals service exposes for an issuer (spec §6.3 — "owns company
// profile, ..."). Used by the symbol-detail overview tab (P1.3) as the
// company-blurb data, and by financials/earnings tabs as the issuer
// identity context they share.
//
// Why a separate envelope from the resolver's HydratedSubjectContext:
// - Resolver hydration is the *search-result* shape — minimal, geared at
//   "what subject is this user typing about?".
// - This profile is the *symbol-detail* shape — explicit as_of, source_id,
//   and exchange list with canonical listing SubjectRefs so the UI can
//   chain to /v1/market/quote without re-resolving identity.
//
// Both eventually read the same `issuers` table; this envelope is the
// fundamentals-owned read model rather than a resolver leak.

import {
  assertIssuerRef,
  assertListingRef,
  freezeIssuerRef,
  freezeListingRef,
  type IssuerSubjectRef,
  type ListingSubjectRef,
  type UUID,
} from "./subject-ref.ts";
import {
  assertCurrency,
  assertIso8601Utc,
  assertUuid,
} from "./validators.ts";

export type IssuerProfileExchange = {
  // Canonical listing identity. Letting the profile cite listings by
  // SubjectRef (not just MIC+ticker text) is what makes the symbol-detail
  // shell "open exchange XNAS" / "fetch quote for the XNAS listing" a
  // type-safe lookup rather than a string-join.
  listing: ListingSubjectRef;
  mic: string;
  ticker: string;
  trading_currency: string;
  timezone: string;
};

export type IssuerProfile = {
  subject: IssuerSubjectRef;
  legal_name: string;
  former_names: ReadonlyArray<string>;
  cik?: string;
  lei?: string;
  domicile?: string;
  sector?: string;
  industry?: string;
  exchanges: ReadonlyArray<IssuerProfileExchange>;
  as_of: string;
  source_id: UUID;
};

export type IssuerProfileInput = {
  subject: IssuerSubjectRef;
  legal_name: string;
  former_names?: ReadonlyArray<string>;
  cik?: string;
  lei?: string;
  domicile?: string;
  sector?: string;
  industry?: string;
  exchanges?: ReadonlyArray<IssuerProfileExchange>;
  as_of: string;
  source_id: UUID;
};

export function issuerProfile(input: IssuerProfileInput): IssuerProfile {
  assertIssuerRef(input.subject, "issuerProfile.subject");
  assertNonEmptyString(input.legal_name, "issuerProfile.legal_name");
  assertIso8601Utc(input.as_of, "issuerProfile.as_of");
  assertUuid(input.source_id, "issuerProfile.source_id");

  const former_names = freezeFormerNames(
    input.former_names ?? [],
    "issuerProfile.former_names",
  );
  const exchanges = freezeExchanges(
    input.exchanges ?? [],
    "issuerProfile.exchanges",
  );

  const out: IssuerProfile = {
    subject: freezeIssuerRef(input.subject, "issuerProfile.subject"),
    legal_name: input.legal_name,
    former_names,
    exchanges,
    as_of: input.as_of,
    source_id: input.source_id,
  };
  if (input.cik !== undefined) out.cik = assertOptionalString(input.cik, "issuerProfile.cik");
  if (input.lei !== undefined) out.lei = assertOptionalString(input.lei, "issuerProfile.lei");
  if (input.domicile !== undefined) {
    out.domicile = assertOptionalString(input.domicile, "issuerProfile.domicile");
  }
  if (input.sector !== undefined) {
    out.sector = assertOptionalString(input.sector, "issuerProfile.sector");
  }
  if (input.industry !== undefined) {
    out.industry = assertOptionalString(input.industry, "issuerProfile.industry");
  }
  return Object.freeze(out);
}

export function assertIssuerProfileContract(
  value: unknown,
): asserts value is IssuerProfile {
  if (value === null || typeof value !== "object") {
    throw new Error("issuerProfile: must be an object");
  }
  const p = value as Record<string, unknown>;
  assertIssuerRef(p.subject, "issuerProfile.subject");
  assertNonEmptyString(p.legal_name, "issuerProfile.legal_name");
  assertIso8601Utc(p.as_of, "issuerProfile.as_of");
  assertUuid(p.source_id, "issuerProfile.source_id");

  if (!Array.isArray(p.former_names)) {
    throw new Error("issuerProfile.former_names: must be an array");
  }
  for (let i = 0; i < p.former_names.length; i++) {
    assertNonEmptyString(p.former_names[i], `issuerProfile.former_names[${i}]`);
  }

  if (!Array.isArray(p.exchanges)) {
    throw new Error("issuerProfile.exchanges: must be an array");
  }
  for (let i = 0; i < p.exchanges.length; i++) {
    assertExchangeContract(p.exchanges[i], `issuerProfile.exchanges[${i}]`);
  }

  for (const key of ["cik", "lei", "domicile", "sector", "industry"] as const) {
    if (p[key] !== undefined) {
      assertOptionalString(p[key], `issuerProfile.${key}`);
    }
  }
}

function assertExchangeContract(
  value: unknown,
  label: string,
): asserts value is IssuerProfileExchange {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  const e = value as Record<string, unknown>;
  assertListingRef(e.listing, `${label}.listing`);
  assertNonEmptyString(e.mic, `${label}.mic`);
  assertNonEmptyString(e.ticker, `${label}.ticker`);
  assertCurrency(e.trading_currency, `${label}.trading_currency`);
  assertNonEmptyString(e.timezone, `${label}.timezone`);
}

function freezeExchanges(
  exchanges: ReadonlyArray<IssuerProfileExchange>,
  label: string,
): ReadonlyArray<IssuerProfileExchange> {
  if (!Array.isArray(exchanges)) {
    throw new Error(`${label}: must be an array`);
  }
  // Reject duplicates of the same listing — two entries pointing at the
  // same listing UUID would let downstream rendering count an exchange
  // twice in any per-issuer aggregate.
  const seen = new Set<string>();
  const frozen: IssuerProfileExchange[] = [];
  for (let i = 0; i < exchanges.length; i++) {
    const e = exchanges[i];
    assertExchangeContract(e, `${label}[${i}]`);
    if (seen.has(e.listing.id)) {
      throw new Error(
        `${label}[${i}]: duplicate listing id "${e.listing.id}" — each exchange must reference a distinct listing`,
      );
    }
    seen.add(e.listing.id);
    frozen.push(
      Object.freeze({
        listing: freezeListingRef(e.listing, `${label}[${i}].listing`),
        mic: e.mic,
        ticker: e.ticker,
        trading_currency: e.trading_currency,
        timezone: e.timezone,
      }),
    );
  }
  return Object.freeze(frozen);
}

function freezeFormerNames(
  names: ReadonlyArray<string>,
  label: string,
): ReadonlyArray<string> {
  if (!Array.isArray(names)) {
    throw new Error(`${label}: must be an array`);
  }
  for (let i = 0; i < names.length; i++) {
    assertNonEmptyString(names[i], `${label}[${i}]`);
  }
  return Object.freeze([...names]);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: must be a non-empty string; received ${String(value)}`);
  }
}

function assertOptionalString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: must be a non-empty string when present; received ${String(value)}`);
  }
  return value;
}
