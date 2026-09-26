import test from "node:test";
import assert from "node:assert/strict";

import { mergeSealInputs, SealInputMergeError } from "../src/seal-input-merge.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";

function manifest(over: Record<string, unknown> = {}) {
  return {
    subject_refs: [],
    fact_refs: [],
    claim_refs: [],
    event_refs: [],
    document_refs: [],
    series_specs: [],
    source_ids: [],
    tool_call_ids: [],
    tool_call_result_hashes: [],
    as_of: "2026-01-01T00:00:00.000Z",
    basis: "unadjusted",
    normalization: "raw",
    coverage_start: null,
    allowed_transforms: null,
    model_version: "dev",
    parent_snapshot: null,
    ...over,
  };
}

function seal(over: Omit<Partial<SnapshotSealInput>, "manifest"> & { manifest?: Record<string, unknown> } = {}): SnapshotSealInput {
  return {
    snapshot_id: SNAP,
    blocks: [],
    facts: [],
    sources: [],
    ...over,
    manifest: manifest(over.manifest) as never,
  } as SnapshotSealInput;
}

test("mergeSealInputs returns base unchanged when there are no sections", () => {
  const base = seal({ blocks: [{ id: "memo" }] as never });
  assert.equal(mergeSealInputs(base, []), base);
});

test("mergeSealInputs concats blocks/facts and unions manifest refs", () => {
  const base = seal({
    blocks: [{ id: "memo" }] as never,
    sources: ["s1"],
    manifest: { claim_refs: ["c1"], source_ids: ["s1"], subject_refs: [{ kind: "issuer", id: "i1" }], as_of: "2026-01-01T00:00:00.000Z" },
  });
  const section = seal({
    blocks: [{ id: "peer" }] as never,
    facts: [{ fact_id: "f1" }] as never,
    sources: ["s1", "s2"],
    manifest: { fact_refs: ["f1"], source_ids: ["s1", "s2"], subject_refs: [{ kind: "issuer", id: "i1" }, { kind: "issuer", id: "i2" }], as_of: "2026-01-01T00:00:00.000Z" },
  });

  const merged = mergeSealInputs(base, [section]);

  assert.deepEqual(merged.blocks.map((b) => (b as { id: string }).id), ["memo", "peer"]);
  assert.deepEqual((merged.facts ?? []).map((f) => (f as { fact_id: string }).fact_id), ["f1"]);
  assert.deepEqual([...merged.manifest.fact_refs], ["f1"]);
  assert.deepEqual([...merged.manifest.claim_refs], ["c1"]);
  assert.deepEqual([...merged.manifest.source_ids], ["s1", "s2"]);
  assert.deepEqual([...(merged.sources ?? [])], ["s1", "s2"]);
  assert.equal(merged.manifest.subject_refs.length, 2);
  assert.equal(merged.manifest.as_of, "2026-01-01T00:00:00.000Z");
});

test("a section at a later cutoff is rejected, never folded in under the maximum as_of", () => {
  const historical = seal({ blocks: [{ id: "memo" }] as never, manifest: { as_of: "2024-01-15T00:00:00.000Z" } });
  const later = seal({ blocks: [{ id: "peer" }] as never, manifest: { as_of: "2026-03-01T00:00:00.000Z" } });
  assert.throws(() => mergeSealInputs(historical, [later]), (error: Error) => error instanceof SealInputMergeError && /as_of differs/.test(error.message));
});

test("inputs must share basis, normalization, coverage start, and thread", () => {
  const base = seal({ blocks: [{ id: "memo" }] as never });
  for (const [over, pattern] of [
    [{ manifest: { basis: "split_adjusted" } }, /basis differs/],
    [{ manifest: { normalization: "per_share" } }, /normalization differs/],
    [{ manifest: { coverage_start: "2020-01-01T00:00:00.000Z" } }, /coverage_start differs/],
    [{ thread_id: "33333333-3333-4333-a333-333333333333" }, /different threads/],
  ] as const) {
    assert.throws(() => mergeSealInputs(base, [seal({ blocks: [{ id: "peer" }] as never, ...over } as never)]), pattern);
  }
});

test("one fact id with two different payloads fails instead of deduplicating silently", () => {
  const base = seal({ blocks: [{ id: "memo" }] as never, facts: [{ fact_id: "f1", value_num: "10", unit: "USD" }] as never });
  const same = seal({ blocks: [{ id: "peer" }] as never, facts: [{ unit: "USD", value_num: "10", fact_id: "f1" }] as never });
  assert.equal(mergeSealInputs(base, [same]).facts!.length, 1, "the same row loaded twice is kept once");
  const different = seal({ blocks: [{ id: "peer" }] as never, facts: [{ fact_id: "f1", value_num: "11", unit: "USD" }] as never });
  assert.throws(() => mergeSealInputs(base, [different]), /fact f1 appears with different payloads/);
});

test("a block id used by two inputs is rejected", () => {
  assert.throws(() => mergeSealInputs(seal({ blocks: [{ id: "x" }] as never }), [seal({ blocks: [{ id: "x" }] as never })]), /block x appears more than once/);
});

test("a certified financial unit never merges, even alone", () => {
  const certified = seal({ financial: { owner_user_id: "o", run_id: "r", unit_id: "u" } } as never);
  assert.throws(() => mergeSealInputs(seal(), [certified]), /certified financial unit/);
  assert.throws(() => mergeSealInputs(certified, []), /certified financial unit/);
});

test("mergeSealInputs throws on a snapshot_id mismatch", () => {
  const base = seal();
  const section = seal({ snapshot_id: "22222222-2222-4222-a222-222222222222" });
  assert.throws(() => mergeSealInputs(base, [section]), /snapshot_id/);
});
