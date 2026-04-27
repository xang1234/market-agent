import type { QueryResult } from "pg";
import type { Portfolio, PortfolioCreateInput } from "./portfolio.ts";
import type {
  HoldingSubjectKind,
  PortfolioHolding,
  PortfolioHoldingCreateInput,
} from "./holdings.ts";

// Matches the watchlists / resolver minimal queryable surface. `pg.Client` and
// `pg.Pool` both satisfy it; tests stub it without importing the full pg type.
export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

export class PortfolioNotFoundError extends Error {
  readonly portfolio_id: string;
  constructor(portfolio_id: string) {
    super(`portfolio not found: ${portfolio_id}`);
    this.name = "PortfolioNotFoundError";
    this.portfolio_id = portfolio_id;
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

// pg returns numeric as string by default to preserve precision; coerce at the
// row seam since callers consume floats. Documented precision tradeoff — this
// surface is research-context exposure tracking, not tax-lot accounting
// (spec §4.2.1).
function toFiniteNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

type PortfolioRow = {
  portfolio_id: string;
  user_id: string;
  name: string;
  base_currency: string;
  created_at: Date | string;
  updated_at: Date | string;
};

function toPortfolio(row: PortfolioRow): Portfolio {
  return {
    portfolio_id: row.portfolio_id,
    user_id: row.user_id,
    name: row.name,
    base_currency: row.base_currency,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

export async function createPortfolio(
  db: QueryExecutor,
  userId: string,
  input: PortfolioCreateInput,
): Promise<Portfolio> {
  const result = await db.query<PortfolioRow>(
    `insert into portfolios (user_id, name, base_currency)
     values ($1, $2, $3)
     returning portfolio_id, user_id, name, base_currency, created_at, updated_at`,
    [userId, input.name, input.base_currency],
  );
  return toPortfolio(result.rows[0]);
}

// Scoped to user_id so a stray UUID guess can't leak another user's portfolio.
export async function getPortfolio(
  db: QueryExecutor,
  userId: string,
  portfolioId: string,
): Promise<Portfolio> {
  const result = await db.query<PortfolioRow>(
    `select portfolio_id, user_id, name, base_currency, created_at, updated_at
       from portfolios
      where portfolio_id = $1 and user_id = $2`,
    [portfolioId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new PortfolioNotFoundError(portfolioId);
  return toPortfolio(row);
}

export async function listPortfolios(
  db: QueryExecutor,
  userId: string,
): Promise<Portfolio[]> {
  const result = await db.query<PortfolioRow>(
    `select portfolio_id, user_id, name, base_currency, created_at, updated_at
       from portfolios
      where user_id = $1
      order by created_at asc, portfolio_id asc`,
    [userId],
  );
  return result.rows.map(toPortfolio);
}

export async function deletePortfolio(
  db: QueryExecutor,
  userId: string,
  portfolioId: string,
): Promise<void> {
  const result = await db.query(
    `delete from portfolios
      where portfolio_id = $1 and user_id = $2`,
    [portfolioId, userId],
  );
  if ((result.rowCount ?? 0) === 0) throw new PortfolioNotFoundError(portfolioId);
}

export class HoldingNotFoundError extends Error {
  readonly portfolio_holding_id: string;
  constructor(portfolio_holding_id: string) {
    super(`holding not found: ${portfolio_holding_id}`);
    this.name = "HoldingNotFoundError";
    this.portfolio_holding_id = portfolio_holding_id;
  }
}

type HoldingRow = {
  portfolio_holding_id: string;
  portfolio_id: string;
  subject_kind: HoldingSubjectKind;
  subject_id: string;
  quantity: string | number;
  cost_basis: string | number | null;
  opened_at: Date | string | null;
  closed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function toHolding(row: HoldingRow): PortfolioHolding {
  return {
    portfolio_holding_id: row.portfolio_holding_id,
    portfolio_id: row.portfolio_id,
    subject_ref: { kind: row.subject_kind, id: row.subject_id },
    quantity: toFiniteNumber(row.quantity),
    cost_basis: row.cost_basis === null ? null : toFiniteNumber(row.cost_basis),
    opened_at: toIsoOrNull(row.opened_at),
    closed_at: toIsoOrNull(row.closed_at),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

const HOLDING_COLUMNS = `portfolio_holding_id, portfolio_id, subject_kind, subject_id,
  quantity, cost_basis, opened_at, closed_at, created_at, updated_at`;

export async function createHolding(
  db: QueryExecutor,
  portfolioId: string,
  input: PortfolioHoldingCreateInput,
): Promise<PortfolioHolding> {
  const result = await db.query<HoldingRow>(
    `insert into portfolio_holdings
       (portfolio_id, subject_kind, subject_id, quantity, cost_basis, opened_at, closed_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning ${HOLDING_COLUMNS}`,
    [
      portfolioId,
      input.subject_ref.kind,
      input.subject_ref.id,
      input.quantity,
      input.cost_basis ?? null,
      input.opened_at ?? null,
      input.closed_at ?? null,
    ],
  );
  return toHolding(result.rows[0]);
}

export async function listHoldings(
  db: QueryExecutor,
  portfolioId: string,
): Promise<PortfolioHolding[]> {
  const result = await db.query<HoldingRow>(
    `select ${HOLDING_COLUMNS}
       from portfolio_holdings
      where portfolio_id = $1
      order by created_at asc, portfolio_holding_id asc`,
    [portfolioId],
  );
  return result.rows.map(toHolding);
}

export async function deleteHolding(
  db: QueryExecutor,
  portfolioId: string,
  portfolioHoldingId: string,
): Promise<void> {
  const result = await db.query(
    `delete from portfolio_holdings
      where portfolio_holding_id = $1 and portfolio_id = $2`,
    [portfolioHoldingId, portfolioId],
  );
  if ((result.rowCount ?? 0) === 0) throw new HoldingNotFoundError(portfolioHoldingId);
}
