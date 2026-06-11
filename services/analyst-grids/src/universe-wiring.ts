import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import {
  WatchlistNotFoundError,
  getWatchlist,
  listMembers,
  type QueryExecutor as WatchlistsQueryExecutor,
} from "../../watchlists/src/queries.ts";
import {
  PortfolioNotFoundError,
  getPortfolio,
  listHoldings,
  type QueryExecutor as PortfolioQueryExecutor,
} from "../../portfolio/src/queries.ts";
import { createSqlPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { FundamentalsQueryExecutor } from "../../fundamentals/src/sec-facts-repository.ts";
import type { UniverseResolverDeps } from "./universe.ts";
import { GridValidationError, type QueryExecutor } from "./types.ts";
import { createPostgresScreenRepository } from "../../screener/src/screen-repository.ts";
import { createPostgresCandidateRepository } from "../../screener/src/db-candidates.ts";
import { replayScreen, type ScreenSubject } from "../../screener/src/screen-subject.ts";
import { executeScreenerQuery } from "../../screener/src/executor.ts";

// Resolve ownership through the owning service's canonical user-scoped getter,
// and translate its "not found / not owned" error into the grid domain's single
// access-denied error so callers handle one type. Any other failure (e.g. a
// transient DB error) propagates unchanged rather than being masked as denied.
async function requireUniverseAccess(label: string, lookup: Promise<unknown>): Promise<void> {
  try {
    await lookup;
  } catch (error) {
    if (error instanceof WatchlistNotFoundError || error instanceof PortfolioNotFoundError) {
      throw new GridValidationError(`${label} not found or not accessible`);
    }
    throw error;
  }
}

// The minimal screener surface resolveScreen needs, injected so the mapping +
// ownership logic is unit-testable without Postgres.
export type ScreenResolverPorts = {
  find: (screenId: string) => Promise<ScreenSubject | null>;
  execute: (screen: ScreenSubject) => Promise<{ rows: ReadonlyArray<{ subject_ref: { kind: string; id: string } }> }>;
};

export async function resolveScreenWith(
  ports: ScreenResolverPorts,
  userId: string,
  screenId: string,
): Promise<ReadonlyArray<SubjectRef>> {
  const screen = await ports.find(screenId);
  if (!screen || screen.user_id !== userId) {
    throw new GridValidationError("screen not found or not accessible");
  }
  const result = await ports.execute(screen);
  return result.rows.map((r) => ({ kind: r.subject_ref.kind, id: r.subject_ref.id }) as SubjectRef);
}

// Binds the grid service's injected universe resolvers to the real services. The
// per-service QueryExecutor types are structurally identical to ours but nominally
// distinct, so each call asserts the specific target type (a canonical shared
// QueryExecutor would remove these casts — tracked for Plan 2).
export function createUniverseResolverDeps(db: QueryExecutor): UniverseResolverDeps {
  const peers = createSqlPeerSetResolver(db as FundamentalsQueryExecutor);
  return {
    resolveScreen: async (userId: string, screenId: string): Promise<ReadonlyArray<SubjectRef>> => {
      // The screener executor types are structural ({ rows } / { rows, rowCount? })
      // and pg's QueryResult satisfies both — no cast needed.
      const screens = createPostgresScreenRepository(db);
      const candidates = createPostgresCandidateRepository(db);
      return resolveScreenWith(
        {
          find: (id) => screens.find(id),
          execute: (screen) => executeScreenerQuery({ candidates, clock: () => new Date() }, replayScreen(screen)),
        },
        userId,
        screenId,
      );
    },
    resolveWatchlist: async (userId: string, watchlistId: string): Promise<ReadonlyArray<SubjectRef>> => {
      await requireUniverseAccess("watchlist", getWatchlist(db as WatchlistsQueryExecutor, userId, watchlistId));
      const members = await listMembers(db as WatchlistsQueryExecutor, watchlistId);
      return members.map((m) => m.subject_ref);
    },
    resolvePortfolio: async (userId: string, portfolioId: string): Promise<ReadonlyArray<SubjectRef>> => {
      await requireUniverseAccess("portfolio", getPortfolio(db as PortfolioQueryExecutor, userId, portfolioId));
      const holdings = await listHoldings(db as PortfolioQueryExecutor, portfolioId);
      return holdings.map((h) => h.subject_ref as SubjectRef);
    },
    resolvePeers: async (issuerId: string, limit: number): Promise<ReadonlyArray<SubjectRef>> => {
      const refs = await peers.resolvePeers(issuerId, { limit });
      return refs.map((r) => ({ kind: r.kind, id: r.id }));
    },
  };
}
