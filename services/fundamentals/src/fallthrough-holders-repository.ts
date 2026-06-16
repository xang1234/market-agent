import type { HoldersRepository } from "./holders-repository.ts";

// Compose two holders repositories: try `primary`, and fall through to
// `fallback` when primary has no coverage (returns null). Used to serve official
// SEC insider data ahead of the yfinance dev provider.
export function createFallthroughHoldersRepository(
  primary: HoldersRepository,
  fallback: HoldersRepository,
): HoldersRepository {
  return {
    async find(issuer_id, kind) {
      return (await primary.find(issuer_id, kind)) ?? fallback.find(issuer_id, kind);
    },
  };
}
