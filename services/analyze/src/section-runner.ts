import type { AnalyzePlaybook } from "./playbook.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import { lookupSectionProducer, type SectionProducerDeps } from "./section-producers.ts";

export type RunSectionsInput = {
  playbook: AnalyzePlaybook;
  primary: IssuerSubjectRef | null;
  snapshotId: UUID;
  asOf: string;
};

// Walks the playbook's sections, invoking each registered deterministic producer
// and collecting its non-null seal input (in section order). Producers that need
// an issuer primary (peer_table) are skipped when `primary` is null. A producer
// returning null (no peers/facts) is skipped; a producer that throws propagates.
export async function runDeterministicSections(
  deps: SectionProducerDeps,
  input: RunSectionsInput,
): Promise<ReadonlyArray<SnapshotSealInput>> {
  const seals: SnapshotSealInput[] = [];
  for (const section of input.playbook.sections) {
    const producer = lookupSectionProducer(input.playbook.playbook_id, section.section_id);
    if (producer === undefined) continue;
    if (input.primary === null) continue; // every registered producer needs an issuer primary today
    const seal = await producer(deps, {
      primary: input.primary,
      snapshotId: input.snapshotId,
      asOf: input.asOf,
    });
    if (seal !== null) seals.push(seal);
  }
  return Object.freeze(seals);
}
