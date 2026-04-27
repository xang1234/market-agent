// Portfolio domain (fra-cw0.9.1, spec §3.16, §4.2.1).
//
// A Portfolio is a user-owned research container — NOT a brokerage account
// surrogate. Its only structural job at this phase is to bind a name and a
// required `base_currency` so downstream holdings (.9.2) and overlay inputs
// (.9.3) can interpret cost assumptions and overlay totals in one explicit
// reporting currency. No FX accounting, no tax lots, no settlement.
//
// `base_currency` is required at create time. The DB enforces NOT NULL; this
// module enforces format (ISO 4217) and presence at the API contract boundary
// so missing input surfaces as a 400 rather than a 500 from a constraint.

import {
  assertCurrency,
  assertNonEmptyString,
  assertUuid,
} from "./validators.ts";

export type UUID = string;

export type Portfolio = {
  portfolio_id: UUID;
  user_id: UUID;
  name: string;
  base_currency: string;
  created_at: string;
  updated_at: string;
};

// Cap matches the screener's saved-screen name length. Plenty for any sensible
// portfolio label and prevents kilobyte-long strings from reaching the DB.
export const PORTFOLIO_NAME_MAX_LENGTH = 200;

export type PortfolioCreateInput = {
  name: string;
  base_currency: string;
};

// Validates a raw create-payload from the HTTP boundary. Throws on missing or
// malformed `name` / `base_currency`. Callers should treat thrown errors as 400.
export function assertPortfolioCreateInput(
  raw: unknown,
): asserts raw is PortfolioCreateInput {
  if (raw === null || typeof raw !== "object") {
    throw new Error("portfolio: request body must be an object");
  }
  const obj = raw as Record<string, unknown>;
  assertNonEmptyString(obj.name, "portfolio.name");
  if ((obj.name as string).length > PORTFOLIO_NAME_MAX_LENGTH) {
    throw new Error(
      `portfolio.name: must be <= ${PORTFOLIO_NAME_MAX_LENGTH} characters`,
    );
  }
  assertCurrency(obj.base_currency, "portfolio.base_currency");
}

// Narrowing guard for a Portfolio row read back from the DB. Used at module
// seams (and by tests) to confirm the row is well-formed before handing it
// out as a typed value.
export function assertPortfolio(value: unknown): asserts value is Portfolio {
  if (value === null || typeof value !== "object") {
    throw new Error("portfolio: must be an object");
  }
  const obj = value as Record<string, unknown>;
  assertUuid(obj.portfolio_id, "portfolio.portfolio_id");
  assertUuid(obj.user_id, "portfolio.user_id");
  assertNonEmptyString(obj.name, "portfolio.name");
  assertCurrency(obj.base_currency, "portfolio.base_currency");
  assertNonEmptyString(obj.created_at, "portfolio.created_at");
  assertNonEmptyString(obj.updated_at, "portfolio.updated_at");
}
