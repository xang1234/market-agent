import {
  FISCAL_PERIODS,
  normalizedStatement,
  type FiscalPeriod,
  type NormalizedStatement,
  type NormalizedStatementInput,
  type StatementBasis,
  type StatementFamily,
} from "./statement.ts";
import type { UUID } from "./subject-ref.ts";

export type StatementLookup = {
  issuer_id: UUID;
  family: StatementFamily;
  basis: StatementBasis;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
};

export type StatementRepository = {
  find(lookup: StatementLookup): Promise<NormalizedStatement | null>;
};

export type StatementRepositoryRecord = {
  issuer_id: UUID;
  basis: StatementBasis;
  statement: NormalizedStatementInput;
};

export function createInMemoryStatementRepository(
  records: ReadonlyArray<StatementRepositoryRecord>,
): StatementRepository {
  const byKey = new Map<string, NormalizedStatement>();
  for (const { issuer_id, basis, statement } of records) {
    const frozen = normalizedStatement(statement);
    if (frozen.basis !== basis) {
      throw new Error(
        `createInMemoryStatementRepository: record basis "${basis}" disagrees with statement basis "${frozen.basis}"`,
      );
    }
    if (frozen.subject.id !== issuer_id) {
      throw new Error(
        `createInMemoryStatementRepository: record issuer_id "${issuer_id}" disagrees with statement subject "${frozen.subject.id}"`,
      );
    }
    byKey.set(lookupKey({ issuer_id, family: frozen.family, basis, fiscal_year: frozen.fiscal_year, fiscal_period: frozen.fiscal_period }), frozen);
  }
  return {
    async find(lookup: StatementLookup): Promise<NormalizedStatement | null> {
      return byKey.get(lookupKey(lookup)) ?? null;
    },
  };
}

function lookupKey(lookup: StatementLookup): string {
  return `${lookup.issuer_id}|${lookup.family}|${lookup.basis}|${lookup.fiscal_year}-${lookup.fiscal_period}`;
}

// Period strings on the wire are "{fiscal_year}-{fiscal_period}" e.g. "2024-FY",
// "2023-Q3". The repo lookup uses parsed PeriodKey; the wire uses the raw
// string so callers can round-trip what they sent.
export type ParsedPeriod = {
  raw: string;
  fiscal_year: number;
  fiscal_period: FiscalPeriod;
};

export type ParsedPeriodResult =
  | { kind: "ok"; period: ParsedPeriod }
  | { kind: "error"; raw: string; reason: string };

const PERIOD_PATTERN = /^(\d{4})-(FY|Q[1-4])$/;

export function parsePeriod(raw: unknown): ParsedPeriodResult {
  if (typeof raw !== "string") {
    return { kind: "error", raw: String(raw), reason: "period must be a string" };
  }
  const match = PERIOD_PATTERN.exec(raw);
  if (!match) {
    return {
      kind: "error",
      raw,
      reason: `period must match "{fiscal_year}-{FY|Q1|Q2|Q3|Q4}"; received "${raw}"`,
    };
  }
  const fiscal_year = Number(match[1]);
  const fiscal_period = match[2] as FiscalPeriod;
  // FISCAL_PERIODS includes "FY" and "Q1".."Q4"; the regex already restricts
  // to that set so this assertion is a belt-and-suspenders safeguard.
  if (!FISCAL_PERIODS.includes(fiscal_period)) {
    return { kind: "error", raw, reason: `unknown fiscal_period "${fiscal_period}"` };
  }
  return {
    kind: "ok",
    period: { raw, fiscal_year, fiscal_period },
  };
}
