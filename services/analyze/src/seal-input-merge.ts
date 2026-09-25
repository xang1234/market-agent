import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

export class SealInputMergeError extends Error {
  constructor(message: string) {
    super(`mergeSealInputs: ${message}`);
    this.name = "SealInputMergeError";
  }
}

function uniq<T>(values: ReadonlyArray<T>): T[] {
  return [...new Set(values)];
}

function dedupeSubjectRefs(refs: ReadonlyArray<SnapshotSubjectRef>): SnapshotSubjectRef[] {
  const seen = new Set<string>();
  const out: SnapshotSubjectRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/** Key-order-independent JSON, so two loads of one fact row compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item) && !(item instanceof Date)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
      : item,
  );
}

// The same fact loaded twice is kept once; one fact id carrying two different
// rows is a producer bug and is never resolved by picking one.
function dedupeFacts(facts: ReadonlyArray<unknown>): unknown[] {
  const seen = new Map<string, string>();
  const out: unknown[] = [];
  for (const fact of facts) {
    const id = (fact as { fact_id?: string }).fact_id;
    if (id !== undefined) {
      const payload = canonical(fact);
      const earlier = seen.get(id);
      if (earlier !== undefined) {
        if (earlier !== payload) throw new SealInputMergeError(`fact ${id} appears with different payloads`);
        continue;
      }
      seen.set(id, payload);
    }
    out.push(fact);
  }
  return out;
}

function assertDistinctBlocks(blocks: ReadonlyArray<unknown>): void {
  const seen = new Set<string>();
  for (const block of blocks) {
    const id = (block as { id?: string }).id;
    if (id === undefined) continue;
    if (seen.has(id)) throw new SealInputMergeError(`block ${id} appears more than once`);
    seen.add(id);
  }
}

// Scalar context every merged input must share. Merging never picks a winner:
// a section computed at another cutoff, basis, or normalization is a different
// answer, not a newer one.
const SHARED_MANIFEST_FIELDS = ["as_of", "basis", "normalization", "coverage_start"] as const;

function assertSameContext(base: SnapshotSealInput, section: SnapshotSealInput): void {
  if (section.snapshot_id !== base.snapshot_id) {
    throw new SealInputMergeError(`snapshot_id mismatch (${section.snapshot_id} != ${base.snapshot_id})`);
  }
  if ((section.thread_id ?? null) !== (base.thread_id ?? null)) {
    throw new SealInputMergeError("inputs belong to different threads");
  }
  for (const field of SHARED_MANIFEST_FIELDS) {
    if (section.manifest[field] !== base.manifest[field]) {
      throw new SealInputMergeError(`${field} differs (${String(section.manifest[field])} != ${String(base.manifest[field])})`);
    }
  }
}

// Folds the narrative memo's seal input (base) and the deterministic sections'
// seal inputs into one. Concats blocks/facts/claims/events/documents and unions
// the manifest ref arrays and sources. Every input must share the snapshot,
// thread, cutoff (as_of), basis, normalization, and coverage start; base's
// remaining scalar fields (model_version, …) are kept. Only uncertified inputs
// merge: a verified financial unit is sealed alone under its own certificate,
// never folded into a memo snapshot. Pure.
export function mergeSealInputs(
  base: SnapshotSealInput,
  sections: ReadonlyArray<SnapshotSealInput>,
): SnapshotSealInput {
  const all = [base, ...sections];
  if (all.some((input) => input.financial != null)) {
    throw new SealInputMergeError("a certified financial unit is sealed alone and cannot be merged");
  }
  if (sections.length === 0) return base;
  for (const section of sections) assertSameContext(base, section);
  const flat = <T>(pick: (s: SnapshotSealInput) => ReadonlyArray<T> | undefined): T[] =>
    all.flatMap((s) => [...(pick(s) ?? [])]);
  const blocks = flat((s) => s.blocks);
  assertDistinctBlocks(blocks);

  return Object.freeze({
    ...base,
    blocks: Object.freeze(blocks),
    facts: Object.freeze(dedupeFacts(flat((s) => s.facts)) as never),
    claims: Object.freeze(flat((s) => s.claims) as never),
    events: Object.freeze(flat((s) => s.events) as never),
    documents: Object.freeze(flat((s) => s.documents) as never),
    sources: Object.freeze(uniq(flat((s) => s.sources)) as never),
    manifest: Object.freeze({
      ...base.manifest,
      subject_refs: Object.freeze(dedupeSubjectRefs(flat((s) => s.manifest.subject_refs))),
      fact_refs: Object.freeze(uniq(flat((s) => s.manifest.fact_refs))),
      claim_refs: Object.freeze(uniq(flat((s) => s.manifest.claim_refs))),
      document_refs: Object.freeze(uniq(flat((s) => s.manifest.document_refs))),
      event_refs: Object.freeze(uniq(flat((s) => s.manifest.event_refs))),
      source_ids: Object.freeze(uniq(flat((s) => s.manifest.source_ids))),
      tool_call_ids: Object.freeze(uniq(flat((s) => s.manifest.tool_call_ids))),
      tool_call_result_hashes: Object.freeze(flat((s) => s.manifest.tool_call_result_hashes)),
      series_specs: Object.freeze(flat((s) => s.manifest.series_specs)),
    }),
  }) as SnapshotSealInput;
}
