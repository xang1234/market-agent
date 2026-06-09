import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import { listMembers, type QueryExecutor as WatchlistsQueryExecutor } from "../../watchlists/src/queries.ts";
import {
  getPortfolio,
  listHoldings,
  type QueryExecutor as PortfolioQueryExecutor,
} from "../../portfolio/src/queries.ts";
import { createSqlPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { FundamentalsQueryExecutor } from "../../fundamentals/src/sec-facts-repository.ts";
import type { UniverseResolverDeps } from "./universe.ts";
import { GridValidationError, type QueryExecutor } from "./types.ts";

// Assert the watchlist belongs to the requesting user before resolving its
// members. Without this, a grid could name another user's watchlist_id and leak
// its members when the run engine wires these resolvers (Plan 2). Portfolios get
// the same guarantee via getPortfolio, which is already user-scoped.
async function assertOwnsWatchlist(
  db: QueryExecutor,
  userId: string,
  watchlistId: string,
): Promise<void> {
  const { rows } = await db.query<{ ok: number }>(
    `select 1 as ok from watchlists where watchlist_id = $1 and user_id = $2`,
    [watchlistId, userId],
  );
  if (rows.length === 0) {
    throw new GridValidationError("watchlist not found or not accessible");
  }
}

// Binds the grid service's injected universe resolvers to the real services. The
// per-service QueryExecutor types are structurally identical to ours but nominally
// distinct, so each call asserts the specific target type (a canonical shared
// QueryExecutor would remove these casts — tracked for Plan 2). resolveScreen throws
// in Plan 1 (screen execution needs the screener candidate registry, wired in Plan 2).
export function createUniverseResolverDeps(db: QueryExecutor): UniverseResolverDeps {
  const peers = createSqlPeerSetResolver(db as FundamentalsQueryExecutor);
  return {
    resolveScreen: async () => {
      throw new Error("screen universe resolution is not wired until Plan 2");
    },
    resolveWatchlist: async (userId: string, watchlistId: string): Promise<ReadonlyArray<SubjectRef>> => {
      await assertOwnsWatchlist(db, userId, watchlistId);
      const members = await listMembers(db as WatchlistsQueryExecutor, watchlistId);
      return members.map((m) => m.subject_ref);
    },
    resolvePortfolio: async (userId: string, portfolioId: string): Promise<ReadonlyArray<SubjectRef>> => {
      // getPortfolio is user-scoped and throws if the portfolio isn't owned.
      await getPortfolio(db as PortfolioQueryExecutor, userId, portfolioId);
      const holdings = await listHoldings(db as PortfolioQueryExecutor, portfolioId);
      return holdings.map((h) => h.subject_ref as SubjectRef);
    },
    resolvePeers: async (issuerId: string, limit: number): Promise<ReadonlyArray<SubjectRef>> => {
      const refs = await peers.resolvePeers(issuerId, { limit });
      return refs.map((r) => ({ kind: r.kind, id: r.id }));
    },
  };
}
