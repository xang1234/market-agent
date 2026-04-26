import {
  assertIssuerRef,
  assertListingRef,
  freezeIssuerRef,
  type IssuerSubjectRef,
  type ListingSubjectRef,
  type UUID,
} from "./subject-ref.ts";
import {
  assertCurrency,
  assertIso8601Utc,
  assertNonEmptyString,
  assertUuid,
} from "./validators.ts";

export type IssuerProfileExchange = {
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

export type IssuerProfileRecord = Omit<IssuerProfile, "as_of" | "source_id">;

export type IssuerProfileRecordInput = {
  subject: IssuerSubjectRef;
  legal_name: string;
  former_names?: ReadonlyArray<string>;
  cik?: string;
  lei?: string;
  domicile?: string;
  sector?: string;
  industry?: string;
  exchanges?: ReadonlyArray<IssuerProfileExchange>;
};

export type IssuerProfileInput = IssuerProfileRecordInput & {
  as_of: string;
  source_id: UUID;
};

const OPTIONAL_STRING_FIELDS = ["cik", "lei", "domicile", "sector", "industry"] as const;
const EMPTY_FROZEN_STRINGS: ReadonlyArray<string> = Object.freeze([]);
const EMPTY_FROZEN_EXCHANGES: ReadonlyArray<IssuerProfileExchange> = Object.freeze([]);

export function freezeIssuerProfileRecord(input: IssuerProfileRecordInput): IssuerProfileRecord {
  assertNonEmptyString(input.legal_name, "issuerProfile.legal_name");

  const out: IssuerProfileRecord = {
    subject: freezeIssuerRef(input.subject, "issuerProfile.subject"),
    legal_name: input.legal_name,
    former_names: freezeFormerNames(input.former_names ?? EMPTY_FROZEN_STRINGS, "issuerProfile.former_names"),
    exchanges: freezeExchanges(input.exchanges ?? EMPTY_FROZEN_EXCHANGES, "issuerProfile.exchanges"),
  };
  for (const field of OPTIONAL_STRING_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    assertNonEmptyString(value, `issuerProfile.${field}`);
    out[field] = value;
  }
  return Object.freeze(out);
}

export function issuerProfile(input: IssuerProfileInput): IssuerProfile {
  assertIso8601Utc(input.as_of, "issuerProfile.as_of");
  assertUuid(input.source_id, "issuerProfile.source_id");
  return Object.freeze({
    ...freezeIssuerProfileRecord(input),
    as_of: input.as_of,
    source_id: input.source_id,
  });
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
  const seenListingIds = new Set<string>();
  for (let i = 0; i < p.exchanges.length; i++) {
    assertExchangeContract(p.exchanges[i], `issuerProfile.exchanges[${i}]`);
    const id = (p.exchanges[i] as IssuerProfileExchange).listing.id;
    if (seenListingIds.has(id)) {
      throw new Error(
        `issuerProfile.exchanges[${i}]: duplicate listing id "${id}" — each exchange must reference a distinct listing`,
      );
    }
    seenListingIds.add(id);
  }

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (p[field] !== undefined) {
      assertNonEmptyString(p[field], `issuerProfile.${field}`);
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
  if (exchanges.length === 0) return EMPTY_FROZEN_EXCHANGES;
  // Duplicate listing ids would double-count exchanges in any per-issuer aggregate.
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
        listing: Object.freeze({ kind: e.listing.kind, id: e.listing.id }),
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
  if (names.length === 0) return EMPTY_FROZEN_STRINGS;
  for (let i = 0; i < names.length; i++) {
    assertNonEmptyString(names[i], `${label}[${i}]`);
  }
  return Object.freeze([...names]);
}
