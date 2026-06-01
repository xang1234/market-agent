// Assembles the snapshot seal input for a metrics_comparison block: a manifest
// binding the block's cell facts (fact_refs), their sources (source_ids), and
// the compared subjects, plus the verifier rows (facts + sources) the sealer
// checks against. The caller (the peer_comparison trigger) loads the fact rows
// from the DB and calls sealSnapshot with the result.
//
// This module authors the manifest: it derives fact_refs straight from the
// cells (and sources from the loaded fact rows). The verifier's extractBlockRefs
// independently re-derives the same cell refs to cross-check the manifest — the
// two must agree, but neither is generated from the other.

import {
  STAGED_SNAPSHOT_MANIFEST,
  type SnapshotManifestDraft,
} from "../../snapshot/src/manifest-staging.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import type { VerifierBlock, VerifierFact, VerifierFactBinding } from "../../snapshot/src/snapshot-verifier.ts";
import type { MetricsComparisonBlock } from "./metrics-comparison-block-builder.ts";
import type { UUID } from "../../fundamentals/src/subject-ref.ts";

// A fact row backing a cell, loaded from the facts table. source_id is required
// (the verifier binds every referenced fact to a source); the period/unit
// fields feed the fact-binding check.
export type PeerComparisonFactRow = VerifierFact & { source_id: UUID };

export function buildPeerComparisonSealInput(input: {
  block: MetricsComparisonBlock;
  facts: ReadonlyArray<PeerComparisonFactRow>;
  modelVersion?: string | null;
}): SnapshotSealInput {
  const { block, facts } = input;

  const factRefs = distinctCellValueRefs(block);
  const factById = new Map(facts.map((fact) => [fact.fact_id, fact]));
  const missing = factRefs.filter((ref) => !factById.has(ref));
  if (missing.length > 0) {
    throw new Error(
      `buildPeerComparisonSealInput: missing fact rows for cell value_refs: ${missing.join(", ")}`,
    );
  }

  const sourceIds = distinct(factRefs.map((ref) => factById.get(ref)!.source_id));

  // The verifier requires metrics_comparison (a sealed-data block) to declare a
  // fact_binding for every cell fact, matching the fact's unit + period. The
  // builder doesn't carry that metadata, so bind from the authoritative loaded
  // fact rows here and finalize the block's data_ref.
  const factBindings = factRefs.map((ref) => factBinding(factById.get(ref)!));
  const sealedBlock: VerifierBlock = {
    ...(block as unknown as VerifierBlock),
    data_ref: { ...block.data_ref, params: { ...block.data_ref.params, fact_bindings: factBindings } },
  };

  const manifest: SnapshotManifestDraft = Object.freeze({
    [STAGED_SNAPSHOT_MANIFEST]: true,
    subject_refs: Object.freeze(block.subjects.map((subject) => ({ kind: subject.kind, id: subject.id }))),
    fact_refs: Object.freeze(factRefs),
    claim_refs: Object.freeze([]),
    event_refs: Object.freeze([]),
    document_refs: Object.freeze([]),
    series_specs: Object.freeze([]),
    source_ids: Object.freeze(sourceIds),
    tool_call_ids: Object.freeze([]),
    tool_call_result_hashes: Object.freeze([]),
    as_of: block.as_of,
    basis: "unadjusted",
    normalization: "raw",
    coverage_start: null,
    allowed_transforms: Object.freeze({}),
    model_version: input.modelVersion ?? null,
    parent_snapshot: null,
  });

  return {
    snapshot_id: block.snapshot_id,
    manifest,
    blocks: [sealedBlock],
    facts: facts.map((fact) => ({ ...fact })),
    sources: sourceIds,
  };
}

// A fact's binding for data_ref.params: the fact_id plus the unit/period fields
// the verifier matches against (everything on the row except its source_id).
function factBinding(fact: PeerComparisonFactRow): VerifierFactBinding {
  const { source_id: _source_id, ...binding } = fact;
  return binding;
}

// Distinct non-null cell value_refs, in row-major order.
function distinctCellValueRefs(block: MetricsComparisonBlock): UUID[] {
  const refs: UUID[] = [];
  const seen = new Set<UUID>();
  for (const row of block.cells) {
    for (const cell of row) {
      if (cell === null || seen.has(cell.value_ref)) continue;
      seen.add(cell.value_ref);
      refs.push(cell.value_ref);
    }
  }
  return refs;
}

function distinct(values: ReadonlyArray<UUID>): UUID[] {
  return [...new Set(values)];
}
