import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { PeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { StatsRepository } from "../../fundamentals/src/stats-repository.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import { emitPeerComparisonBlock } from "./metrics-comparison-emitter.ts";

export type SectionProducerDeps = {
  db: QueryExecutor;
  peers: PeerSetResolver;
  stats: StatsRepository;
  clock?: () => Date;
};

export type SectionProducerContext = {
  primary: IssuerSubjectRef;
  snapshotId: UUID;
  asOf: string;
};

export type SectionProducer = (
  deps: SectionProducerDeps,
  ctx: SectionProducerContext,
) => Promise<SnapshotSealInput | null>;

// Stable per-section block id. One block per section for now.
export function sectionBlockId(sectionId: string): string {
  return `${sectionId}-1`;
}

const PEER_TABLE_PRODUCER: SectionProducer = (deps, ctx) =>
  emitPeerComparisonBlock(
    { peers: deps.peers, stats: deps.stats, db: deps.db, clock: deps.clock },
    {
      primary: ctx.primary,
      snapshotId: ctx.snapshotId,
      blockId: sectionBlockId("peer_table"),
      asOf: ctx.asOf,
    },
  );

// Registry keyed by `${playbook_id}:${section_id}`. Sections absent here have no
// deterministic producer and are covered by the narrative memo.
const SECTION_PRODUCERS: ReadonlyMap<string, SectionProducer> = new Map([
  ["peer_comparison:peer_table", PEER_TABLE_PRODUCER],
]);

export function lookupSectionProducer(
  playbookId: string,
  sectionId: string,
): SectionProducer | undefined {
  return SECTION_PRODUCERS.get(`${playbookId}:${sectionId}`);
}
