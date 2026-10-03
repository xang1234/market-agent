// Three independent claims a displayed block can carry (#193), not a trust
// score. Each is derived on the server, on every read, from the snapshot the
// block was sealed with and the financial certificates recorded for that
// snapshot. Nothing stored in the block, sent by a client, or written by the
// model can set one.
//
// - evidence: every value the block cites binds to its sealed snapshot's
//   manifest (the refs the seal verifier checks, plus sealed series). A seal
//   alone never certifies arithmetic.
// - calculation: the server independently recomputed the result from recorded
//   inputs. Only a financial_answer whose run, unit, and presentation have a
//   certificate in this snapshot (the financial verifier's path).
// - public_by_cutoff: the exact source versions were public by the requested
//   time. The same certificate: the financial verifier seals a unit only when
//   every input's publication proof is public by its knowledge cutoff.
//   Stored-by-cutoff checks (a fact's or bar's as_of) do not prove it.
//
// ponytail: claims are per top-level block; a section's children are not
// assessed separately.

import { dataRefSeriesRefs, extractBlockRefs, type VerifierBlock } from "./snapshot-verifier.ts";
import type { JsonObject } from "./manifest-staging.ts";

export type BlockProof = {
  evidence: "linked" | "unknown";
  calculation: "verified" | "not_verified";
  public_by_cutoff: "proven" | "unknown";
};

export type SealedSnapshotRecord = {
  fact_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  event_refs: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  source_ids: ReadonlyArray<string>;
  series_refs: ReadonlyArray<string>;
  certificates: ReadonlyArray<{ run_id: string; unit_id: string; presentation_hash: string }>;
};

export const UNPROVEN: BlockProof = Object.freeze({ evidence: "unknown", calculation: "not_verified", public_by_cutoff: "unknown" });

// `snapshot` is null when the block has no sealed snapshot (a legacy or
// unsealed message): nothing about it is claimed.
export function deriveBlockProof(block: unknown, snapshot: SealedSnapshotRecord | null): BlockProof {
  if (snapshot === null || !isRecord(block)) return UNPROVEN;
  if (isCertified(block, snapshot)) {
    return Object.freeze({ evidence: "linked", calculation: "verified", public_by_cutoff: "proven" });
  }
  return Object.freeze({ ...UNPROVEN, evidence: citesOnlySealed(block, snapshot) ? "linked" : "unknown" });
}

function isCertified(block: Record<string, unknown>, snapshot: SealedSnapshotRecord): boolean {
  if (block.kind !== "financial_answer" || !isRecord(block.financial)) return false;
  const { run_id, unit_id } = block.financial;
  return snapshot.certificates.some((certificate) =>
    certificate.run_id === run_id && certificate.unit_id === unit_id && certificate.presentation_hash === block.presentation_hash
  );
}

// At least one cited value, and every one in the manifest. A block whose refs
// cannot be read (the seal's extractor rejects them) is not linked.
function citesOnlySealed(block: Record<string, unknown>, snapshot: SealedSnapshotRecord): boolean {
  try {
    return citedRefsAllSealed(block, snapshot);
  } catch {
    return false;
  }
}

function citedRefsAllSealed(block: Record<string, unknown>, snapshot: SealedSnapshotRecord): boolean {
  const manifest: Record<string, ReadonlySet<string>> = {
    fact: new Set(snapshot.fact_refs),
    claim: new Set(snapshot.claim_refs),
    event: new Set(snapshot.event_refs),
    document: new Set(snapshot.document_refs),
    source: new Set(snapshot.source_ids),
    series: new Set(snapshot.series_refs),
  };
  const params = isRecord(block.data_ref) && isRecord(block.data_ref.params) ? block.data_ref.params : {};
  const cited = [
    ...extractBlockRefs(block as unknown as VerifierBlock).map((ref) => [ref.ref_kind, ref.ref_id] as const),
    // Both forms the seal accepts: series_ref and series_refs.
    ...dataRefSeriesRefs(params as JsonObject).map((id) => ["series", id] as const),
    ...(Array.isArray(params.fact_bindings) ? params.fact_bindings : [])
      .flatMap((binding) => isRecord(binding) && typeof binding.fact_id === "string" ? [["fact", binding.fact_id] as const] : []),
  ];
  return cited.length > 0 && cited.every(([kind, id]) => manifest[kind]?.has(id) === true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
