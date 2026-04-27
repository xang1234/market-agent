import {
  freezeEarningsEventsEnvelope,
  type EarningsEventsEnvelope,
  type EarningsEventsEnvelopeInput,
} from "./earnings.ts";
import type { UUID } from "./subject-ref.ts";

export type EarningsRepository = {
  find(issuer_id: UUID): Promise<EarningsEventsEnvelope | null>;
};

export function createInMemoryEarningsRepository(
  records: ReadonlyArray<EarningsEventsEnvelopeInput>,
): EarningsRepository {
  // Pre-validate + freeze each envelope at construction; hot path is a Map.get.
  const byId = new Map<UUID, EarningsEventsEnvelope>();
  for (const input of records) {
    const envelope = freezeEarningsEventsEnvelope(input);
    byId.set(envelope.subject.id, envelope);
  }
  return {
    async find(issuer_id: UUID): Promise<EarningsEventsEnvelope | null> {
      return byId.get(issuer_id) ?? null;
    },
  };
}
