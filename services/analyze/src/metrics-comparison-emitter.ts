// The peer_comparison playbook's deterministic emitter: produces the sealed
// metrics_comparison block for the `peer_table` section by composing the chain
// resolve peers -> fetch metrics -> materialize facts -> build block -> load the
// fact rows -> assemble the seal input. The caller (the analyze run path) seals
// the returned input inside its transaction and persists the returned block.
//
// It does NOT call sealSnapshot itself: sealing + block persistence are one
// transactional unit owned by the run, so the emitter returns the seal input
// rather than committing on its own.

import type { QueryExecutor } from "../../evidence/src/types.ts";
import { fetchPeerMetrics } from "../../fundamentals/src/peer-metrics.ts";
import type { PeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { StatsRepository } from "../../fundamentals/src/stats-repository.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import { materializePeerMetricFacts } from "./metrics-comparison-materializer.ts";
import { buildMetricsComparisonBlock, type MetricsComparisonBlock } from "./metrics-comparison-block-builder.ts";
import {
  buildPeerComparisonSealInput,
  type PeerComparisonFactRow,
} from "./metrics-comparison-snapshot.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

export type PeerComparisonEmitterDeps = {
  // Same-industry market-cap peers (fra-4tfk).
  peers: PeerSetResolver;
  // Per-issuer key-stats (fra-nta8 fetcher reads through this).
  stats: StatsRepository;
  // Evidence DB executor — ideally the run's transaction client, since the
  // materializer writes derived facts that the subsequent seal must see.
  db: QueryExecutor;
  clock?: () => Date;
};

export type PeerComparisonEmitInput = {
  // The analyzed subject; row 0 + primary_subject_ref of the table.
  primary: IssuerSubjectRef;
  snapshotId: UUID;
  blockId: string;
  // The run's as_of; the block + manifest carry it (cell facts are <= this).
  asOf: string;
  peerLimit?: number;
  title?: string;
};

export type PeerComparisonEmitResult = {
  // The finalized block (with data_ref.params.fact_bindings) to persist.
  block: MetricsComparisonBlock;
  // Seal input the run path passes to sealSnapshot within its transaction.
  sealInput: SnapshotSealInput;
};

// Returns null when there is nothing to compare — no peers, or no metric facts
// materialized for any subject — so the run path simply omits the peer_table.
export async function emitPeerComparisonBlock(
  deps: PeerComparisonEmitterDeps,
  input: PeerComparisonEmitInput,
): Promise<PeerComparisonEmitResult | null> {
  const clock = deps.clock ?? (() => new Date());

  const peerRefs = await deps.peers.resolvePeers(input.primary.id, { limit: input.peerLimit });
  if (peerRefs.length === 0) return null;

  // Primary leads the comparison; peers follow in resolver order.
  const subjects: ReadonlyArray<IssuerSubjectRef> = [input.primary, ...peerRefs];
  const peerMetrics = await fetchPeerMetrics(deps.stats, subjects.map((subject) => subject.id));
  const materialized = await materializePeerMetricFacts(deps.db, peerMetrics, { clock });

  const valueRefs = distinct(materialized.flatMap((peer) => peer.metrics.map((metric) => metric.value_ref)));
  if (valueRefs.length === 0) return null;

  const factRows = await loadFactRows(deps.db, valueRefs);
  const sources = distinct(factRows.map((row) => row.source_id));

  const block = buildMetricsComparisonBlock({
    peers: materialized,
    primary: input.primary,
    base: {
      id: input.blockId,
      snapshot_id: input.snapshotId,
      as_of: input.asOf,
      source_refs: sources,
      ...(input.title === undefined ? {} : { title: input.title }),
    },
  });

  const sealInput = buildPeerComparisonSealInput({ block, facts: factRows });
  // buildPeerComparisonSealInput finalizes the block (fact_bindings) into
  // sealInput.blocks[0]; that is the block to persist.
  return { block: sealInput.blocks[0] as unknown as MetricsComparisonBlock, sealInput };
}

type FactDbRow = {
  fact_id: string;
  source_id: string;
  unit: string;
  period_kind: string;
  period_start: Date | string | null;
  period_end: Date | string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
};

// Load the rows the verifier checks the sealed block against: each cell fact's
// source + unit/period, for the manifest + fact bindings.
async function loadFactRows(db: QueryExecutor, factIds: ReadonlyArray<UUID>): Promise<ReadonlyArray<PeerComparisonFactRow>> {
  if (factIds.length === 0) return [];
  const { rows } = await db.query<FactDbRow>(
    `select fact_id::text as fact_id,
            source_id::text as source_id,
            unit,
            period_kind::text as period_kind,
            period_start,
            period_end,
            fiscal_year,
            fiscal_period
       from facts
      where fact_id = any($1::uuid[])`,
    [factIds],
  );
  return rows.map((row) => ({
    fact_id: row.fact_id,
    source_id: row.source_id,
    unit: row.unit,
    period_kind: row.period_kind,
    period_start: dateString(row.period_start),
    period_end: dateString(row.period_end),
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
  }));
}

function dateString(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function distinct(values: ReadonlyArray<UUID>): UUID[] {
  return [...new Set(values)];
}
