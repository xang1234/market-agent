import type { QueryResult } from "pg";
import type { Portfolio } from "./portfolio.ts";

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
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function createPortfolio(
  db: QueryExecutor,
  userId: string,
  input: { name: string; base_currency: string },
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
