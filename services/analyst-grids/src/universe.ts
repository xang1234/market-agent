import { isSubjectRef, type SubjectRef } from "../../shared/src/subject-ref.ts";
import { GridValidationError, type UniverseSpec } from "./types.ts";

// Each non-manual source is injected so the grid service never imports
// screener/watchlist/portfolio/fundamentals internals directly.
export type UniverseResolverDeps = {
  resolveScreen: (userId: string, screenId: string) => Promise<ReadonlyArray<SubjectRef>>;
  resolveWatchlist: (userId: string, watchlistId: string) => Promise<ReadonlyArray<SubjectRef>>;
  resolvePortfolio: (userId: string, portfolioId: string) => Promise<ReadonlyArray<SubjectRef>>;
  resolvePeers: (issuerId: string, limit: number) => Promise<ReadonlyArray<SubjectRef>>;
};

export const DEFAULT_PEER_LIMIT = 5;
export const MAX_PEER_LIMIT = 50;

export async function resolveUniverse(
  deps: UniverseResolverDeps,
  userId: string,
  spec: UniverseSpec,
): Promise<ReadonlyArray<SubjectRef>> {
  switch (spec.source) {
    case "manual": {
      for (const ref of spec.subject_refs) {
        if (!isSubjectRef(ref)) {
          throw new GridValidationError("manual universe contains an invalid subject_ref");
        }
      }
      return spec.subject_refs;
    }
    case "screen":
      return deps.resolveScreen(userId, spec.screen_id);
    case "watchlist":
      return deps.resolveWatchlist(userId, spec.watchlist_id);
    case "portfolio":
      return deps.resolvePortfolio(userId, spec.portfolio_id);
    case "peers": {
      // spec.limit is user-controlled; clamp to a bounded, positive integer range
      // so a huge or non-positive value can't trigger runaway peer fan-out.
      const requested = spec.limit ?? DEFAULT_PEER_LIMIT;
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(1, Math.floor(requested)), MAX_PEER_LIMIT)
        : DEFAULT_PEER_LIMIT;
      return deps.resolvePeers(spec.issuer_id, limit);
    }
    default: {
      const _exhaustive: never = spec;
      throw new GridValidationError(`unknown universe source: ${(_exhaustive as UniverseSpec).source}`);
    }
  }
}
