// Issuer-profile lookup abstraction. Mirrors services/market's
// `ListingRepository` shape so swapping the dev in-memory backing for a
// DB-backed implementation later is a one-line wiring change. Production
// path queries the issuers/instruments/listings tables (already populated
// by the resolver flow's seeded chains); dev path uses a fixed map.

import type { IssuerProfile } from "./profile.ts";
import type { UUID } from "./subject-ref.ts";

// `IssuerProfileRecord` is the storage shape — already a fully-formed
// IssuerProfile minus the per-read `as_of` and `source_id`, which the
// repository attaches at lookup time so a single seeded record produces
// the same envelope regardless of how many times it's read.
export type IssuerProfileRecord = Omit<IssuerProfile, "as_of" | "source_id">;

export type IssuerProfileRepository = {
  find(issuer_id: UUID): Promise<IssuerProfileRecord | null>;
};

export class IssuerNotFoundError extends Error {
  readonly issuer_id: UUID;
  constructor(issuer_id: UUID) {
    super(`issuer not found: ${issuer_id}`);
    this.name = "IssuerNotFoundError";
    this.issuer_id = issuer_id;
  }
}

export function createInMemoryIssuerProfileRepository(
  records: ReadonlyArray<IssuerProfileRecord>,
): IssuerProfileRepository {
  const byId = new Map(records.map((r) => [r.subject.id, r] as const));
  return {
    async find(issuer_id: UUID): Promise<IssuerProfileRecord | null> {
      return byId.get(issuer_id) ?? null;
    },
  };
}
