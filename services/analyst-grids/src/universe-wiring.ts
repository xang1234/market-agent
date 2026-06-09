import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import { listMembers } from "../../watchlists/src/queries.ts";
import { listHoldings } from "../../portfolio/src/queries.ts";
import { createSqlPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { UniverseResolverDeps } from "./universe.ts";
import type { QueryExecutor } from "./types.ts";

// Binds the grid service's injected universe resolvers to the real services.
// resolveScreen throws in Plan 1 (screen execution needs the screener candidate
// registry, wired in Plan 2).
export function createUniverseResolverDeps(db: QueryExecutor): UniverseResolverDeps {
  const peers = createSqlPeerSetResolver(db as never);
  return {
    resolveScreen: async () => {
      throw new Error("screen universe resolution is not wired until Plan 2");
    },
    resolveWatchlist: async (_userId: string, watchlistId: string): Promise<ReadonlyArray<SubjectRef>> => {
      const members = await listMembers(db as never, watchlistId);
      return members.map((m) => m.subject_ref);
    },
    resolvePortfolio: async (_userId: string, portfolioId: string): Promise<ReadonlyArray<SubjectRef>> => {
      const holdings = await listHoldings(db as never, portfolioId);
      return holdings.map((h) => h.subject_ref as SubjectRef);
    },
    resolvePeers: async (issuerId: string, limit: number): Promise<ReadonlyArray<SubjectRef>> => {
      const refs = await peers.resolvePeers(issuerId, { limit });
      return refs.map((r) => ({ kind: r.kind, id: r.id }));
    },
  };
}
