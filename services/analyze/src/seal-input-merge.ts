import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

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

function dedupeFacts(facts: ReadonlyArray<unknown>): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const fact of facts) {
    const id = (fact as { fact_id?: string }).fact_id;
    if (id !== undefined) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(fact);
  }
  return out;
}

// Folds the narrative memo's seal input (base) and the deterministic sections'
// seal inputs into one. Concats blocks/facts/claims/events/documents, unions the
// manifest ref arrays and sources, takes the max as_of, and keeps base's scalar
// manifest fields (basis, normalization, model_version, …). Pure.
export function mergeSealInputs(
  base: SnapshotSealInput,
  sections: ReadonlyArray<SnapshotSealInput>,
): SnapshotSealInput {
  if (sections.length === 0) return base;
  for (const section of sections) {
    if (section.snapshot_id !== base.snapshot_id) {
      throw new Error(
        `mergeSealInputs: snapshot_id mismatch (${section.snapshot_id} != ${base.snapshot_id})`,
      );
    }
  }
  const all = [base, ...sections];
  const flat = <T>(pick: (s: SnapshotSealInput) => ReadonlyArray<T> | undefined): T[] =>
    all.flatMap((s) => [...(pick(s) ?? [])]);
  const maxAsOf = all
    .map((s) => s.manifest.as_of)
    .reduce((a, b) => (b > a ? b : a));

  return Object.freeze({
    ...base,
    blocks: Object.freeze(flat((s) => s.blocks)),
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
      as_of: maxAsOf,
    }),
  }) as SnapshotSealInput;
}
