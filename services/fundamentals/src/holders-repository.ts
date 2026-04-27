import {
  freezeInsiderHoldersEnvelope,
  freezeInstitutionalHoldersEnvelope,
  type HolderKind,
  type HoldersEnvelope,
  type InsiderHoldersEnvelopeInput,
  type InstitutionalHoldersEnvelopeInput,
} from "./holders.ts";
import type { UUID } from "./subject-ref.ts";

export type HoldersRepository = {
  find(issuer_id: UUID, kind: HolderKind): Promise<HoldersEnvelope | null>;
};

export type HoldersRepositorySeed = {
  institutional?: ReadonlyArray<InstitutionalHoldersEnvelopeInput>;
  insider?: ReadonlyArray<InsiderHoldersEnvelopeInput>;
};

export function createInMemoryHoldersRepository(
  seed: HoldersRepositorySeed,
): HoldersRepository {
  const byKey = new Map<string, HoldersEnvelope>();
  for (const input of seed.institutional ?? []) {
    const envelope = freezeInstitutionalHoldersEnvelope(input);
    byKey.set(repoKey(envelope.subject.id, "institutional"), envelope);
  }
  for (const input of seed.insider ?? []) {
    const envelope = freezeInsiderHoldersEnvelope(input);
    byKey.set(repoKey(envelope.subject.id, "insider"), envelope);
  }
  return {
    async find(issuer_id: UUID, kind: HolderKind): Promise<HoldersEnvelope | null> {
      return byKey.get(repoKey(issuer_id, kind)) ?? null;
    },
  };
}

function repoKey(issuer_id: UUID, kind: HolderKind): string {
  return `${issuer_id}::${kind}`;
}
