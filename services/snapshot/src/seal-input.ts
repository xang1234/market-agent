// The shared seal-input core: builders that assemble a SnapshotSealInput from
// the content backing a block. Fact-backed blocks (deterministic DB reads —
// peer_table's metrics_comparison, revenue_bars, analyst-grid metric cells)
// seal with a fact_binding per cited ref; claim-backed blocks (LLM-derived —
// analyst-grid reader cells) seal with claim/document refs plus tool-call
// provenance. Lives in services/snapshot because both the analyze and
// analyst-grids services consume it and it speaks entirely in snapshot-layer
// types. The caller seals the returned input inside its transaction.

import {
  DETERMINISTIC_SNAPSHOT_MANIFEST,
  STAGED_SNAPSHOT_MANIFEST,
  type SnapshotManifestDraft,
} from "./manifest-staging.ts";
import { compileDisclosurePolicy } from "./disclosure-policy.ts";
import type { SnapshotSealInput } from "./snapshot-sealer.ts";
import type {
  VerifierBlock,
  VerifierFact,
  VerifierFactBinding,
} from "./snapshot-verifier.ts";
import type { UUID } from "../../shared/src/subject-ref.ts";

// A fact row backing a cited ref, loaded from the facts table. source_id is
// required (the verifier binds every referenced fact to a source); the
// unit/period fields feed the fact-binding check. freshness_class (inherited
// from VerifierFact) is only set on rows that deliberately surface freshness
// (market facts); lean rows (toSealFactRow) omit it, so withRequiredDisclosures
// demands a pricing disclosure only for the facts that carry one.
export type FactRow = VerifierFact & { source_id: UUID };

// Project a full fact row down to the fields that seal into a snapshot. This is
// a load-bearing narrowing: it deliberately drops freshness_class (and the other
// non-binding columns), because surfacing freshness on the sealed VerifierFact
// makes the verifier demand a freshness disclosure block. peer_table achieves
// the same lean shape via its loadFactRows SELECT; minted facts go through here.
export function toSealFactRow(row: {
  fact_id: string;
  source_id: string;
  unit: string;
  period_kind: string;
  period_start: string | null;
  period_end: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
}): FactRow {
  return {
    fact_id: row.fact_id,
    source_id: row.source_id,
    unit: row.unit,
    period_kind: row.period_kind,
    period_start: row.period_start,
    period_end: row.period_end,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
  };
}

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

// The manifest skeleton every staged seal shares: empty ref lists, raw basis,
// no transforms, no parent. Builders spread this and override only the ref
// lists their content actually populates, so the two builders below can't
// drift on the fields they have no opinion about.
function stagedManifestBase(input: {
  subjectRefs: ReadonlyArray<{ kind: string; id: string }>;
  asOf: string;
  modelVersion: string | null;
}) {
  return {
    [STAGED_SNAPSHOT_MANIFEST]: true as const,
    subject_refs: Object.freeze(input.subjectRefs.map((s) => ({ kind: s.kind, id: s.id }))),
    fact_refs: Object.freeze([]),
    claim_refs: Object.freeze([]),
    event_refs: Object.freeze([]),
    document_refs: Object.freeze([]),
    series_specs: Object.freeze([]),
    source_ids: Object.freeze([]),
    tool_call_ids: Object.freeze([]),
    tool_call_result_hashes: Object.freeze([]),
    as_of: input.asOf,
    basis: "unadjusted" as const,
    normalization: "raw" as const,
    coverage_start: null,
    allowed_transforms: Object.freeze({}),
    model_version: input.modelVersion,
    parent_snapshot: null,
  };
}

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
    ...stagedManifestBase({
      subjectRefs,
      asOf: block.as_of,
      modelVersion: input.modelVersion ?? null,
    }),
    // Deterministic DB-fact content: exempt from the tool-call provenance
    // audit (facts are provenanced by fact.source_id, enforced by the
    // verifier's fact→source binding check).
    [DETERMINISTIC_SNAPSHOT_MANIFEST]: true,
    fact_refs: Object.freeze([...factRefs]),
    source_ids: Object.freeze(sourceIds),
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

export type ClaimSealClaim = { claim_id: UUID; source_id: UUID };
export type ClaimSealDocument = { document_id: UUID; source_id: UUID };
export type SealToolCallRef = { tool_call_id: UUID; result_hash: string };

// The claim-backed sibling of buildFactBackedSealInput, for LLM-derived blocks
// (analyst-grid reader cells). The manifest is STAGED only — never
// DETERMINISTIC — so the sealer's tool-call provenance audit applies: every
// tool_call_id must exist in tool_call_logs with a matching result_hash.
export function buildClaimBackedSealInput(input: {
  block: SealableBlock & {
    kind: string;
    source_refs: ReadonlyArray<string>;
    segments: ReadonlyArray<unknown>;
  };
  claims: ReadonlyArray<ClaimSealClaim>;
  documents: ReadonlyArray<ClaimSealDocument>;
  subjectRefs: ReadonlyArray<{ kind: string; id: string }>;
  toolCalls: ReadonlyArray<SealToolCallRef>;
  modelVersion?: string | null;
}): SnapshotSealInput {
  if (input.toolCalls.length === 0) {
    throw new Error("buildClaimBackedSealInput: LLM-derived blocks require at least one tool call ref");
  }

  const claimRefs = distinct(input.claims.map((claim) => claim.claim_id));
  const documentRefs = distinct(input.documents.map((doc) => doc.document_id));
  const sourceIds = distinct([
    ...input.claims.map((claim) => claim.source_id),
    ...input.documents.map((doc) => doc.source_id),
  ]);

  const manifest: SnapshotManifestDraft = Object.freeze({
    ...stagedManifestBase({
      subjectRefs: input.subjectRefs,
      asOf: input.block.as_of,
      modelVersion: input.modelVersion ?? null,
    }),
    claim_refs: Object.freeze(claimRefs),
    document_refs: Object.freeze(documentRefs),
    source_ids: Object.freeze(sourceIds),
    tool_call_ids: Object.freeze(input.toolCalls.map((t) => t.tool_call_id)),
    tool_call_result_hashes: Object.freeze(
      input.toolCalls.map((t) => ({ tool_call_id: t.tool_call_id, result_hash: t.result_hash })),
    ),
  });

  return {
    snapshot_id: input.block.snapshot_id,
    manifest,
    blocks: [input.block as unknown as VerifierBlock],
    claims: input.claims.map((claim) => ({ ...claim })),
    documents: input.documents.map((doc) => ({ ...doc })),
    sources: sourceIds,
  };
}

// Append the disclosure blocks the seal's facts require (delayed/eod pricing,
// filing-time basis). compileDisclosurePolicy generates sealable disclosure
// blocks from the facts' freshness; the verifier re-derives the same requirement
// from the same facts, so coverage matches by construction. A no-op when no fact
// surfaces freshness (lean rows / non-market facts), so it is safe to wrap any
// seal. FactRow omits freshness_class (not a binding field), but materializers
// that mint market facts leave it on the row at runtime — read it here.
export function withRequiredDisclosures(seal: SnapshotSealInput): SnapshotSealInput {
  const compiled = compileDisclosurePolicy({
    snapshot_id: seal.snapshot_id,
    manifest: {
      subject_refs: seal.manifest.subject_refs,
      source_ids: seal.manifest.source_ids,
      as_of: seal.manifest.as_of,
      basis: seal.manifest.basis,
      normalization: seal.manifest.normalization,
    },
    facts: seal.facts.map((fact) => ({
      fact_id: fact.fact_id,
      source_id: fact.source_id ?? null,
      freshness_class: fact.freshness_class,
    })),
  });
  if (compiled.required_disclosure_blocks.length === 0) return seal;
  return {
    ...seal,
    blocks: [...seal.blocks, ...compiled.required_disclosure_blocks],
  };
}
