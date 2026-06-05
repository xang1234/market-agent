import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { PeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { StatsRepository } from "../../fundamentals/src/stats-repository.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import type { ConsensusRepository } from "../../fundamentals/src/consensus-repository.ts";
import { emitPeerComparisonBlock } from "./metrics-comparison-emitter.ts";
import { emitRevenueBarsBlock } from "./revenue-bars-emitter.ts";
import { emitAnalystConsensusBlock } from "./analyst-consensus-emitter.ts";
import { emitPriceTargetRangeBlock } from "./price-target-range-emitter.ts";
import type { CurrentPriceSource } from "./current-price-source.ts";

export type SectionProducerDeps = {
  db: QueryExecutor;
  peers: PeerSetResolver;
  stats: StatsRepository;
  // Optional: when absent (or unsupported), the analyst_overview section is omitted.
  consensus?: ConsensusRepository;
  // Optional: when absent, the price_targets section is omitted.
  price?: CurrentPriceSource;
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

const REVENUE_BARS_PRODUCER: SectionProducer = (deps, ctx) =>
  emitRevenueBarsBlock(
    { db: deps.db },
    {
      primary: ctx.primary,
      snapshotId: ctx.snapshotId,
      blockId: sectionBlockId("revenue_trend"),
      asOf: ctx.asOf,
    },
  );

const ANALYST_CONSENSUS_PRODUCER: SectionProducer = (deps, ctx) => {
  if (deps.consensus === undefined) return Promise.resolve(null);
  return emitAnalystConsensusBlock(
    { db: deps.db, consensus: deps.consensus, clock: deps.clock },
    {
      primary: ctx.primary,
      snapshotId: ctx.snapshotId,
      blockId: sectionBlockId("analyst_overview"),
      asOf: ctx.asOf,
    },
  );
};

const PRICE_TARGET_RANGE_PRODUCER: SectionProducer = (deps, ctx) => {
  if (deps.consensus === undefined || deps.price === undefined) return Promise.resolve(null);
  return emitPriceTargetRangeBlock(
    { db: deps.db, consensus: deps.consensus, price: deps.price, clock: deps.clock },
    {
      primary: ctx.primary,
      snapshotId: ctx.snapshotId,
      blockId: sectionBlockId("price_targets"),
      asOf: ctx.asOf,
    },
  );
};

// Registry keyed by `${playbook_id}:${section_id}`. Sections absent here have no
// deterministic producer and are covered by the narrative memo.
const SECTION_PRODUCERS: ReadonlyMap<string, SectionProducer> = new Map([
  ["peer_comparison:peer_table", PEER_TABLE_PRODUCER],
  ["earnings_quality:revenue_trend", REVENUE_BARS_PRODUCER],
  ["earnings_quality:analyst_overview", ANALYST_CONSENSUS_PRODUCER],
  ["earnings_quality:price_targets", PRICE_TARGET_RANGE_PRODUCER],
]);

export function lookupSectionProducer(
  playbookId: string,
  sectionId: string,
): SectionProducer | undefined {
  return SECTION_PRODUCERS.get(`${playbookId}:${sectionId}`);
}
