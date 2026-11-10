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
import { CanonicalJsonError, hashCanonical } from "../../financial-core/src/canonical.ts";
import { isRecord } from "../../shared/src/http.ts";

export type BlockProof = {
  evidence: "linked" | "unknown";
  calculation: "verified" | "not_verified";
  public_by_cutoff: "proven" | "unknown";
  // A scenario price comparison's alone (#224): whether the scenario answer it
  // compares still holds its certificate, which its link back to that answer
  // names. Its own evidence may be unknown meanwhile, as when a source it
  // cites is no longer public.
  scenario_calculation?: "verified" | "not_verified";
};

export type SealedSnapshotRecord = {
  fact_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  event_refs: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  source_ids: ReadonlyArray<string>;
  series_refs: ReadonlyArray<string>;
  // The series whose specs say the seal checked their points (PERF_POINTS);
  // a chart sealed before that check is not linked.
  checked_series_refs: ReadonlyArray<string>;
  certificates: ReadonlyArray<{ run_id: string; unit_id: string; presentation_hash: string }>;
  // The scenario price comparisons whose seal bound their content as stored
  // and whose scenario certificate stands at this read, by proof key
  // (comparisonProofKey), and whether every source each cites is still public.
  live_comparisons?: ReadonlyArray<Readonly<{ key: string; sources_public: boolean }>>;
};

// Linkage means the values shown are the evidence cited, not merely that the
// block cites something sealed. Kinds that display literal values with no
// per-value reference are never linked: the seal accepts a single fact binding
// on any block, and it drops these charts' embedded points without comparing
// them to the sealed series, so nothing ties what is drawn to what is cited.
// A price chart is the exception (#236): the seal recomputes each drawn line
// from the series it cites (chart-points.ts).
const LITERAL_VALUE_KINDS: ReadonlySet<string> = new Set([
  "table",
  "line_chart",
  "segment_trajectory",
  "sentiment_trend",
  "mention_volume",
]);

export const UNPROVEN: BlockProof = Object.freeze({ evidence: "unknown", calculation: "not_verified", public_by_cutoff: "unknown" });

// `snapshot` is null when the block has no sealed snapshot (a legacy or
// unsealed message): nothing about it is claimed.
export function deriveBlockProof(block: unknown, snapshot: SealedSnapshotRecord | null): BlockProof {
  if (snapshot === null || !isRecord(block)) return UNPROVEN;
  if (block.kind === "scenario_price_comparison") return comparisonProof(block, snapshot);
  // A Call (#604) is the agent's opinion: its seal stores it unchanged, but it claims nothing.
  if (block.kind === "call") return UNPROVEN;
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

// A scenario price comparison (#224) is source-linked, never a verified
// calculation: its seal generated it again from the stored close and the
// scenario's certificate and bound its snapshot to the hash of that block
// (scenario-price-comparison.ts), and this read finds the binding, the
// certificate, and the EPS's and the price's sources still public. Its cited
// sources must all be sealed. A named gap shows no value, so it claims nothing.
function comparisonProof(block: Record<string, unknown>, snapshot: SealedSnapshotRecord): BlockProof {
  const key = comparisonProofKey(block);
  const live = key === null ? undefined : snapshot.live_comparisons?.find((entry) => entry.key === key);
  if (live === undefined) return UNPROVEN_COMPARISON;
  const sources = new Set(snapshot.source_ids);
  const price = (block.comparison as { outcome: { price: { source_id: string } } }).outcome.price.source_id;
  const linked = live.sources_public && Array.isArray(block.source_refs) && block.source_refs.includes(price) &&
    block.source_refs.every((id) => typeof id === "string" && sources.has(id));
  return Object.freeze({ ...UNPROVEN, evidence: linked ? "linked" : "unknown", scenario_calculation: "verified" });
}

const UNPROVEN_COMPARISON: BlockProof = Object.freeze({ ...UNPROVEN, scenario_calculation: "not_verified" });

/**
 * The hash a comparison's seal binds its whole block by (0079). Canonical, so
 * the block read back from jsonb hashes the same; null for a block no seal
 * could have bound.
 */
export function comparisonBlockHash(block: unknown): string | null {
  try {
    return hashCanonical("scenario_price_comparison", block);
  } catch (error) {
    if (error instanceof CanonicalJsonError) return null;
    throw error;
  }
}

/** What identifies a shown comparison: its snapshot and the hash of its block. Null for one that shows no price. */
export function comparisonProofKey(block: Record<string, unknown>): string | null {
  const { snapshot_id: snapshotId, comparison } = block;
  if (typeof snapshotId !== "string" || !isRecord(comparison) || !isRecord(comparison.outcome) || comparison.outcome.kind !== "comparison") return null;
  const hash = comparisonBlockHash(block);
  return hash === null ? null : `${snapshotId.toLowerCase()}:${hash}`;
}

// At least one cited value, and every one in the manifest. A block whose refs
// cannot be read (the seal's extractor rejects them) is not linked.
function citesOnlySealed(block: Record<string, unknown>, snapshot: SealedSnapshotRecord): boolean {
  if (typeof block.kind === "string" && LITERAL_VALUE_KINDS.has(block.kind)) return false;
  try {
    if (block.kind === "perf_comparison" && !eachLineHasItsOwnSeries(block, snapshot)) return false;
    if (!citedSeriesAllChecked(block, snapshot)) return false;
    return citedRefsAllSealed(block, snapshot);
  } catch {
    return false;
  }
}

// The lines the seal checked: embedded points, line i drawn from series ref i,
// no ref shared, each sealed with the point check. A live-rendered chart has
// no points to have checked.
function eachLineHasItsOwnSeries(block: Record<string, unknown>, snapshot: SealedSnapshotRecord): boolean {
  const params = isRecord(block.data_ref) && isRecord(block.data_ref.params) ? block.data_ref.params : {};
  const refs = dataRefSeriesRefs(params as JsonObject);
  const checked = new Set(snapshot.checked_series_refs);
  return Array.isArray(block.series) && block.series.length > 0 && block.series.length === refs.length &&
    new Set(refs).size === refs.length && refs.every((ref) => checked.has(ref));
}

// A price return in prose shows its line's last point (#317): the seal checks it
// against a line whose points it checked only since #236.
function citedSeriesAllChecked(block: Record<string, unknown>, snapshot: SealedSnapshotRecord): boolean {
  const checked = new Set(snapshot.checked_series_refs);
  return extractBlockRefs(block as unknown as VerifierBlock).every((ref) => ref.ref_kind !== "series" || checked.has(ref.ref_id));
}

function citedRefsAllSealed(block: Record<string, unknown>, snapshot: SealedSnapshotRecord): boolean {
  const params = isRecord(block.data_ref) && isRecord(block.data_ref.params) ? block.data_ref.params : {};
  // Both forms the seal accepts: series_ref and series_refs.
  const seriesRefs = dataRefSeriesRefs(params as JsonObject);
  const manifest: Record<string, ReadonlySet<string>> = {
    fact: new Set(snapshot.fact_refs),
    claim: new Set(snapshot.claim_refs),
    event: new Set(snapshot.event_refs),
    document: new Set(snapshot.document_refs),
    source: new Set(snapshot.source_ids),
    series: new Set(snapshot.series_refs),
  };
  const cited = [
    ...extractBlockRefs(block as unknown as VerifierBlock).map((ref) => [ref.ref_kind, ref.ref_id] as const),
    ...seriesRefs.map((id) => ["series", id] as const),
    ...(Array.isArray(params.fact_bindings) ? params.fact_bindings : [])
      .flatMap((binding) => isRecord(binding) && typeof binding.fact_id === "string" ? [["fact", binding.fact_id] as const] : []),
  ];
  return cited.length > 0 && cited.every(([kind, id]) => manifest[kind]?.has(id) === true);
}
