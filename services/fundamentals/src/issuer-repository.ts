import {
  freezeIssuerProfileRecord,
  type IssuerProfileRecord,
  type IssuerProfileRecordInput,
} from "./profile.ts";
import type { UUID } from "./subject-ref.ts";

export type { IssuerProfileRecord };

export type IssuerProfileRepository = {
  find(issuer_id: UUID): Promise<IssuerProfileRecord | null>;
};

export function createInMemoryIssuerProfileRepository(
  records: ReadonlyArray<IssuerProfileRecordInput>,
): IssuerProfileRepository {
  // Validate + freeze each record once so the per-request hot path can spread
  // them into envelopes without re-running asserts or rebuilding nested arrays.
  const byId = new Map<UUID, IssuerProfileRecord>();
  for (const input of records) {
    const frozen = freezeIssuerProfileRecord(input);
    byId.set(frozen.subject.id, frozen);
  }
  return {
    async find(issuer_id: UUID): Promise<IssuerProfileRecord | null> {
      return byId.get(issuer_id) ?? null;
    },
  };
}
