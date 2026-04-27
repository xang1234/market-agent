// get_holders contract: see spec/finance_research_tool_registry.json.

import { freezeIssuerRef, type IssuerSubjectRef, type UUID } from "./subject-ref.ts";
import {
  assertCurrency,
  assertFiniteNumber,
  assertIso8601Utc,
  assertIsoDate,
  assertNonEmptyString,
  assertNonNegativeInteger,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

export const HOLDER_KINDS = ["institutional", "insider"] as const;
export type HolderKind = (typeof HOLDER_KINDS)[number];

export const INSIDER_TRANSACTION_TYPES = [
  "buy",
  "sell",
  "option_exercise",
  "gift",
  "other",
] as const;
export type InsiderTransactionType = (typeof INSIDER_TRANSACTION_TYPES)[number];

export type InstitutionalHolder = {
  holder_name: string;
  shares_held: number;
  market_value: number;
  percent_of_shares_outstanding: number;
  shares_change: number;
  filing_date: string;
};

export type InsiderTransaction = {
  insider_name: string;
  insider_role: string;
  transaction_date: string;
  transaction_type: InsiderTransactionType;
  shares: number;
  price: number | null;
  value: number | null;
};

export type InstitutionalHoldersEnvelope = {
  subject: IssuerSubjectRef;
  family: "holders";
  kind: "institutional";
  currency: string;
  holders: ReadonlyArray<InstitutionalHolder>;
  as_of: string;
  source_id: UUID;
};

export type InsiderHoldersEnvelope = {
  subject: IssuerSubjectRef;
  family: "holders";
  kind: "insider";
  currency: string;
  holders: ReadonlyArray<InsiderTransaction>;
  as_of: string;
  source_id: UUID;
};

export type HoldersEnvelope = InstitutionalHoldersEnvelope | InsiderHoldersEnvelope;

export type InstitutionalHoldersEnvelopeInput = {
  subject: IssuerSubjectRef;
  currency: string;
  holders: ReadonlyArray<InstitutionalHolder>;
  as_of: string;
  source_id: UUID;
};

export type InsiderHoldersEnvelopeInput = {
  subject: IssuerSubjectRef;
  currency: string;
  holders: ReadonlyArray<InsiderTransaction>;
  as_of: string;
  source_id: UUID;
};

export function freezeInstitutionalHoldersEnvelope(
  input: InstitutionalHoldersEnvelopeInput,
): InstitutionalHoldersEnvelope {
  const subject = freezeIssuerRef(input.subject, "institutionalHolders.subject");
  assertCurrency(input.currency, "institutionalHolders.currency");
  assertIso8601Utc(input.as_of, "institutionalHolders.as_of");
  assertUuid(input.source_id, "institutionalHolders.source_id");
  if (!Array.isArray(input.holders)) {
    throw new Error("institutionalHolders.holders: must be an array");
  }
  const seen = new Set<string>();
  const frozen: InstitutionalHolder[] = [];
  for (let i = 0; i < input.holders.length; i++) {
    const h = freezeInstitutionalHolder(input.holders[i], `institutionalHolders.holders[${i}]`);
    // Two filings for the same (holder, date) would double-count in any top-N rollup.
    const dedupKey = `${h.holder_name}::${h.filing_date}`;
    if (seen.has(dedupKey)) {
      throw new Error(
        `institutionalHolders.holders[${i}]: duplicate (${h.holder_name}, ${h.filing_date})`,
      );
    }
    seen.add(dedupKey);
    frozen.push(h);
  }
  // Newest filings first, then largest position ties first.
  frozen.sort((a, b) => {
    const cmp = b.filing_date.localeCompare(a.filing_date);
    return cmp !== 0 ? cmp : b.shares_held - a.shares_held;
  });
  return Object.freeze({
    subject,
    family: "holders",
    kind: "institutional",
    currency: input.currency,
    holders: Object.freeze(frozen),
    as_of: input.as_of,
    source_id: input.source_id,
  });
}

export function freezeInsiderHoldersEnvelope(
  input: InsiderHoldersEnvelopeInput,
): InsiderHoldersEnvelope {
  const subject = freezeIssuerRef(input.subject, "insiderHolders.subject");
  assertCurrency(input.currency, "insiderHolders.currency");
  assertIso8601Utc(input.as_of, "insiderHolders.as_of");
  assertUuid(input.source_id, "insiderHolders.source_id");
  if (!Array.isArray(input.holders)) {
    throw new Error("insiderHolders.holders: must be an array");
  }
  const frozen: InsiderTransaction[] = [];
  for (let i = 0; i < input.holders.length; i++) {
    frozen.push(freezeInsiderTransaction(input.holders[i], `insiderHolders.holders[${i}]`));
  }
  // Most recent transactions first.
  frozen.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  return Object.freeze({
    subject,
    family: "holders",
    kind: "insider",
    currency: input.currency,
    holders: Object.freeze(frozen),
    as_of: input.as_of,
    source_id: input.source_id,
  });
}

function freezeInstitutionalHolder(
  input: InstitutionalHolder,
  label: string,
): InstitutionalHolder {
  if (input === null || typeof input !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  assertNonEmptyString(input.holder_name, `${label}.holder_name`);
  assertNonNegativeInteger(input.shares_held, `${label}.shares_held`);
  assertFiniteNumber(input.market_value, `${label}.market_value`);
  assertFiniteNumber(input.percent_of_shares_outstanding, `${label}.percent_of_shares_outstanding`);
  if (
    input.percent_of_shares_outstanding < 0 ||
    input.percent_of_shares_outstanding > 100
  ) {
    throw new Error(
      `${label}.percent_of_shares_outstanding: must be between 0 and 100; received ${input.percent_of_shares_outstanding}`,
    );
  }
  assertFiniteNumber(input.shares_change, `${label}.shares_change`);
  assertIsoDate(input.filing_date, `${label}.filing_date`);
  return Object.freeze({
    holder_name: input.holder_name,
    shares_held: input.shares_held,
    market_value: input.market_value,
    percent_of_shares_outstanding: input.percent_of_shares_outstanding,
    shares_change: input.shares_change,
    filing_date: input.filing_date,
  });
}

function freezeInsiderTransaction(input: InsiderTransaction, label: string): InsiderTransaction {
  if (input === null || typeof input !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  assertNonEmptyString(input.insider_name, `${label}.insider_name`);
  assertNonEmptyString(input.insider_role, `${label}.insider_role`);
  assertIsoDate(input.transaction_date, `${label}.transaction_date`);
  assertOneOf(input.transaction_type, INSIDER_TRANSACTION_TYPES, `${label}.transaction_type`);
  assertNonNegativeInteger(input.shares, `${label}.shares`);
  if (input.price !== null) {
    assertFiniteNumber(input.price, `${label}.price`);
    if (input.price < 0) {
      throw new Error(`${label}.price: must be non-negative when present; received ${input.price}`);
    }
  }
  if (input.value !== null) {
    assertFiniteNumber(input.value, `${label}.value`);
  }
  // A non-null price with a null value (or vice versa) indicates the
  // upstream record is mid-transformation; reject it instead of letting
  // the UI render an inconsistent row.
  if ((input.price === null) !== (input.value === null)) {
    throw new Error(
      `${label}: price and value must both be null or both be present (received price=${input.price}, value=${input.value})`,
    );
  }
  return Object.freeze({
    insider_name: input.insider_name,
    insider_role: input.insider_role,
    transaction_date: input.transaction_date,
    transaction_type: input.transaction_type,
    shares: input.shares,
    price: input.price,
    value: input.value,
  });
}
