import test from "node:test";
import assert from "node:assert/strict";
import { combinedDefaultRefs } from "../src/local-runtime.ts";

test("combinedDefaultRefs unions evidence + structured source_ids and collects fact_ids", () => {
  const refs = combinedDefaultRefs(
    // evidence
    [{ source_ids: ["s-evi-1", "s-shared"], claim_refs: ["c-1"], document_refs: ["d-1"] } as never],
    // structured context entries
    [
      {
        source_ids: ["s-shared", "s-fact-1", "s-quote-1"],
        facts: [{ fact_id: "f-1" }, { fact_id: "f-2" }],
      },
    ],
  );
  assert.deepEqual(refs.source_refs, ["s-evi-1", "s-shared", "s-fact-1", "s-quote-1"]);
  assert.deepEqual(refs.claim_refs, ["c-1"]);
  assert.deepEqual(refs.document_refs, ["d-1"]);
  assert.deepEqual(refs.provenance_fact_refs, ["f-1", "f-2"]);
});

test("combinedDefaultRefs with no structured context equals the evidence-only refs", () => {
  const refs = combinedDefaultRefs(
    [{ source_ids: ["s-1"], claim_refs: ["c-1"], document_refs: [] } as never],
    [],
  );
  assert.deepEqual(refs.source_refs, ["s-1"]);
  assert.deepEqual(refs.provenance_fact_refs, []);
});
