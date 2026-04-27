// `base_currency` is required at create time. The DB enforces NOT NULL; this
// module enforces format (ISO 4217) and presence at the API contract boundary
// so missing input surfaces as a 400 rather than a 500 from a constraint.

import { assertCurrency, assertNonEmptyString } from "./validators.ts";

export type UUID = string;

export type Portfolio = {
  portfolio_id: UUID;
  user_id: UUID;
  name: string;
  base_currency: string;
  created_at: string;
  updated_at: string;
};

export const PORTFOLIO_NAME_MAX_LENGTH = 200;

export type PortfolioCreateInput = {
  name: string;
  base_currency: string;
};

export function assertPortfolioCreateInput(
  raw: unknown,
): asserts raw is PortfolioCreateInput {
  if (raw === null || typeof raw !== "object") {
    throw new Error("portfolio: request body must be an object");
  }
  const obj = raw as Record<string, unknown>;
  assertNonEmptyString(obj.name, "portfolio.name");
  const nameLength = (obj.name as string).length;
  if (nameLength > PORTFOLIO_NAME_MAX_LENGTH) {
    throw new Error(
      `portfolio.name: must be <= ${PORTFOLIO_NAME_MAX_LENGTH} characters; received ${nameLength}`,
    );
  }
  assertCurrency(obj.base_currency, "portfolio.base_currency");
}
