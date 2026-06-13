import { isSubjectRef, isUuid, type SubjectRef } from "../../shared/src/subject-ref.ts";
import { GridValidationError, UNIVERSE_SOURCES, type UniverseSpec } from "./types.ts";

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

function requireUuid(value: unknown, field: string): void {
  if (!isUuid(value)) {
    throw new GridValidationError(`universe_spec.${field} must be a uuid`);
  }
}

// The single universe_spec contract, owning the narrowing from raw request
// JSON. Enforced at grid creation (parseCreateInput → HTTP 400) and again at
// run time (resolveUniverse) so a stored spec that validates always resolves
// — an unchecked id would otherwise surface as a pg uuid error (HTTP 500).
export function validateUniverseSpec(value: unknown): asserts value is UniverseSpec {
  if (typeof value !== "object" || value === null) {
    throw new GridValidationError("'universe_spec' is required");
  }
  const spec = value as { source?: unknown } & Record<string, unknown>;
  if (typeof spec.source !== "string" || !(UNIVERSE_SOURCES as readonly string[]).includes(spec.source)) {
    throw new GridValidationError(`'universe_spec.source' must be one of: ${UNIVERSE_SOURCES.join(", ")}`);
  }
  switch (spec.source as UniverseSpec["source"]) {
    case "manual": {
      if (!Array.isArray(spec.subject_refs)) {
        throw new GridValidationError("manual universe requires a subject_refs array");
      }
      for (const ref of spec.subject_refs) {
        if (!isSubjectRef(ref)) {
          throw new GridValidationError("manual universe contains an invalid subject_ref");
        }
      }
      return;
    }
    case "screen":
      return requireUuid(spec.screen_id, "screen_id");
    case "watchlist":
      return requireUuid(spec.watchlist_id, "watchlist_id");
    case "portfolio":
      return requireUuid(spec.portfolio_id, "portfolio_id");
    case "peers":
      return requireUuid(spec.issuer_id, "issuer_id");
  }
}

export async function resolveUniverse(
  deps: UniverseResolverDeps,
  userId: string,
  spec: UniverseSpec,
): Promise<ReadonlyArray<SubjectRef>> {
  validateUniverseSpec(spec);
  switch (spec.source) {
    case "manual":
      return spec.subject_refs;
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
