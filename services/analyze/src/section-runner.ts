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

export async function runDeterministicSections(
  deps: SectionProducerDeps,
  input: RunSectionsInput,
): Promise<ReadonlyArray<SnapshotSealInput>> {
  if (input.primary === null) return Object.freeze([]);
  const seals: SnapshotSealInput[] = [];
  for (const section of input.playbook.sections) {
    const producer = lookupSectionProducer(input.playbook.playbook_id, section.section_id);
    if (producer === undefined) continue;
    const seal = await producer(deps, {
      primary: input.primary,
      snapshotId: input.snapshotId,
      asOf: input.asOf,
    });
    if (seal !== null) seals.push(seal);
  }
  return Object.freeze(seals);
}
