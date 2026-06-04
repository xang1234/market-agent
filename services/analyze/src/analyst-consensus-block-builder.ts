// Assembles an analyst_consensus block from materialized consensus facts: the
// analyst_count ref + one distribution bucket per rating, each carrying its
// backing fact (count_ref) and the pre-rendered count (the block contract
// carries display-ready data so the web stays a dumb renderer).

import type { MaterializedConsensus } from "./analyst-consensus-materializer.ts";
import type { UUID } from "../../fundamentals/src/subject-ref.ts";

export type AnalystConsensusBucket = {
  bucket: string;
  count_ref: UUID;
  count: number;
};

export type AnalystConsensusBlockBase = {
  id: string;
  snapshot_id: UUID;
  as_of: string;
  source_refs: ReadonlyArray<UUID>;
  title?: string;
};

export type AnalystConsensusBlock = {
  id: string;
  kind: "analyst_consensus";
  snapshot_id: UUID;
  data_ref: { kind: string; id: string; params?: Readonly<Record<string, unknown>> };
  source_refs: ReadonlyArray<UUID>;
  as_of: string;
  title?: string;
  analyst_count_ref: UUID;
  distribution: ReadonlyArray<AnalystConsensusBucket>;
  coverage_warning?: string;
};

export function buildAnalystConsensusBlock(input: {
  materialized: MaterializedConsensus;
  base: AnalystConsensusBlockBase;
  coverage_warning?: string;
}): AnalystConsensusBlock {
  const { materialized, base } = input;
  return {
    id: base.id,
    kind: "analyst_consensus",
    snapshot_id: base.snapshot_id,
    data_ref: { kind: "analyst_consensus", id: base.id },
    source_refs: base.source_refs,
    as_of: base.as_of,
    ...(base.title === undefined ? {} : { title: base.title }),
    analyst_count_ref: materialized.analyst_count_ref,
    distribution: materialized.buckets.map((bucket) => ({
      bucket: bucket.bucket,
      count_ref: bucket.count_ref,
      count: bucket.count,
    })),
    ...(input.coverage_warning === undefined ? {} : { coverage_warning: input.coverage_warning }),
  };
}
