import assert from "node:assert/strict";
import test from "node:test";

import { citedRefs } from "../src/local-runtime.ts";

const CLAIM = { claim_id: "11111111-1111-4111-8111-111111111111", document_id: "22222222-2222-4222-8222-222222222222", source_id: "33333333-3333-4333-8333-333333333333" };
const OTHER = { claim_id: "44444444-4444-4444-8444-444444444444", document_id: "55555555-5555-4555-8555-555555555555", source_id: "66666666-6666-4666-8666-666666666666" };
const CHART_SOURCE = "77777777-7777-4777-8777-777777777777";

test("an analyst answer cites only the claims it quotes, their documents and sources, and its figures' sources (#398)", () => {
  const narrative = {
    kind: "rich_text",
    source_refs: [CLAIM.source_id, CHART_SOURCE],
    segments: [{ type: "text", text: "AMD said " }, { type: "ref", ref_kind: "claim", ref_id: CLAIM.claim_id, format: "export controls led to charges." }],
  };
  assert.deepEqual(citedRefs(narrative, [CLAIM, OTHER]), {
    source_refs: [CLAIM.source_id, CHART_SOURCE],
    claim_refs: [CLAIM.claim_id],
    document_refs: [CLAIM.document_id],
    provenance_fact_refs: [],
  });
  assert.deepEqual(citedRefs({ kind: "rich_text", segments: [{ type: "text", text: "No research claims are on file for AMD." }] }, [CLAIM, OTHER]), {
    source_refs: [],
    claim_refs: [],
    document_refs: [],
    provenance_fact_refs: [],
  }, "a fallback sentence cites nothing");
});
