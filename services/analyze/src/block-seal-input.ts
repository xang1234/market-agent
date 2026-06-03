// The shared seal-input core for fact-backed deterministic blocks (peer_table's
// metrics_comparison and revenue_bars). Given a block, the fact refs it cites,
// the subjects it covers, and the loaded fact rows, it: validates every ref has
// a row, derives the block's sources, finalizes the block with a fact_binding
// per ref (the verifier requires one for every cited fact), and assembles the
// staged manifest. The caller seals the returned input inside its transaction.

import {
  STAGED_SNAPSHOT_MANIFEST,
  type SnapshotManifestDraft,
} from "../../snapshot/src/manifest-staging.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import type {
  VerifierBlock,
  VerifierFact,
  VerifierFactBinding,
} from "../../snapshot/src/snapshot-verifier.ts";
import type { UUID } from "../../fundamentals/src/subject-ref.ts";

// A fact row backing a cited ref, loaded from the facts table. source_id is
// required (the verifier binds every referenced fact to a source); the
// unit/period fields feed the fact-binding check.
export type FactRow = VerifierFact & { source_id: UUID };

// The minimal block shape the core finalizes. Concrete builders (metrics_comparison,
// revenue_bars) structurally satisfy this and pass through unchanged except for the
// data_ref.params.fact_bindings the core injects — no index signature, so callers
// hand their concrete block straight in without a cast.
export type SealableBlock = {
  id: string;
  snapshot_id: UUID;
  as_of: string;
  data_ref: { kind: string; id: string; params?: Readonly<Record<string, unknown>> };
};

export function buildFactBackedSealInput(input: {
  block: SealableBlock;
  factRefs: ReadonlyArray<UUID>;
  subjectRefs: ReadonlyArray<{ kind: string; id: string }>;
  facts: ReadonlyArray<FactRow>;
  modelVersion?: string | null;
}): SnapshotSealInput {
  const { block, subjectRefs, facts } = input;
  // The core owns dedup, so callers pass raw refs (possibly with repeats).
  const factRefs = distinct(input.factRefs);

  const factById = new Map(facts.map((fact) => [fact.fact_id, fact]));
  const missing = factRefs.filter((ref) => !factById.has(ref));
  if (missing.length > 0) {
    throw new Error(
      `buildFactBackedSealInput: missing fact rows for value_refs: ${missing.join(", ")}`,
    );
  }

  const sourceIds = distinct(factRefs.map((ref) => factById.get(ref)!.source_id));

  // Every cited fact needs a fact_binding matching its unit + period; bind from
  // the authoritative loaded rows and finalize the block's data_ref.
  const factBindings = factRefs.map((ref) => factBinding(factById.get(ref)!));
  const sealedBlock: VerifierBlock = {
    ...(block as unknown as VerifierBlock),
    data_ref: { ...block.data_ref, params: { ...block.data_ref.params, fact_bindings: factBindings } },
  };

  const manifest: SnapshotManifestDraft = Object.freeze({
    [STAGED_SNAPSHOT_MANIFEST]: true,
    subject_refs: Object.freeze(subjectRefs.map((subject) => ({ kind: subject.kind, id: subject.id }))),
    fact_refs: Object.freeze([...factRefs]),
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

function factBinding(fact: FactRow): VerifierFactBinding {
  const { source_id: _source_id, ...binding } = fact;
  return binding;
}

function distinct(values: ReadonlyArray<UUID>): UUID[] {
  return [...new Set(values)];
}
