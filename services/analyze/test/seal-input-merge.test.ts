import test from "node:test";
import assert from "node:assert/strict";

import { mergeSealInputs } from "../src/seal-input-merge.ts";
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

function seal(over: Partial<SnapshotSealInput> & { manifest?: Record<string, unknown> } = {}): SnapshotSealInput {
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
    manifest: { fact_refs: ["f1"], source_ids: ["s1", "s2"], subject_refs: [{ kind: "issuer", id: "i1" }, { kind: "issuer", id: "i2" }], as_of: "2026-03-01T00:00:00.000Z" },
  });

  const merged = mergeSealInputs(base, [section]);

  assert.deepEqual(merged.blocks.map((b) => (b as { id: string }).id), ["memo", "peer"]);
  assert.deepEqual((merged.facts ?? []).map((f) => (f as { fact_id: string }).fact_id), ["f1"]);
  assert.deepEqual([...merged.manifest.fact_refs], ["f1"]);
  assert.deepEqual([...merged.manifest.claim_refs], ["c1"]);
  assert.deepEqual([...merged.manifest.source_ids], ["s1", "s2"]);
  assert.deepEqual([...(merged.sources ?? [])], ["s1", "s2"]);
  assert.equal(merged.manifest.subject_refs.length, 2);
  // as_of takes the max across inputs.
  assert.equal(merged.manifest.as_of, "2026-03-01T00:00:00.000Z");
});

test("mergeSealInputs throws on a snapshot_id mismatch", () => {
  const base = seal();
  const section = seal({ snapshot_id: "22222222-2222-4222-a222-222222222222" });
  assert.throws(() => mergeSealInputs(base, [section]), /snapshot_id/);
});
