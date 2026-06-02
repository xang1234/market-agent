import assert from "node:assert/strict";
import test from "node:test";

import type { LocalRuntimeEvidence } from "../../evidence/src/local-runtime-evidence.ts";
import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import { settleEvidenceLoads } from "../src/local-runtime.ts";
import type { StructuredSubjectContext } from "../src/local-runtime-structured.ts";

const SUBJECT_REFS: ReadonlyArray<SnapshotSubjectRef> = [
  { kind: "issuer", id: "b12a08d7-8ae4-4acf-bfac-8090845938c6" },
];

function evidence(): LocalRuntimeEvidence {
  return {
    claims: [],
    source_ids: ["00000000-0000-4000-a000-000000000001"],
    document_refs: [],
    claim_refs: ["11111111-1111-4111-a111-111111111111"],
    subject_refs: SUBJECT_REFS,
    verifier_sources: [],
    verifier_documents: [],
    verifier_claims: [],
  };
}

function structured(): StructuredSubjectContext {
  return {
    facts: [],
    quote: null,
    source_ids: ["00000000-0000-4000-a000-000000000002"],
  };
}

function fulfilled<T>(value: T): PromiseFulfilledResult<T> {
  return { status: "fulfilled", value };
}

function rejected(reason: unknown): PromiseRejectedResult {
  return { status: "rejected", reason };
}

test("settleEvidenceLoads passes both loads through when both succeed", () => {
  const rejects: string[] = [];
  const out = settleEvidenceLoads(
    fulfilled(evidence()),
    fulfilled(structured()),
    SUBJECT_REFS,
    (loader) => rejects.push(loader),
  );

  assert.equal(out.evidence.claim_refs.length, 1);
  assert.deepEqual(out.structured.source_ids, ["00000000-0000-4000-a000-000000000002"]);
  assert.deepEqual(rejects, []);
});

test("settleEvidenceLoads keeps the surviving evidence when structured load throws", () => {
  const rejects: string[] = [];
  const out = settleEvidenceLoads(
    fulfilled(evidence()),
    rejected(new Error("db hiccup")),
    SUBJECT_REFS,
    (loader) => rejects.push(loader),
  );

  // Claims survive; structured context degrades to empty rather than failing the turn.
  assert.equal(out.evidence.claim_refs.length, 1);
  assert.equal(out.structured.quote, null);
  assert.deepEqual(out.structured.facts, []);
  assert.deepEqual(out.structured.source_ids, []);
  assert.deepEqual(rejects, ["structured_context"]);
});

test("settleEvidenceLoads keeps the surviving structured context when evidence load throws", () => {
  const rejects: string[] = [];
  const out = settleEvidenceLoads(
    rejected(new Error("db hiccup")),
    fulfilled(structured()),
    SUBJECT_REFS,
    (loader) => rejects.push(loader),
  );

  // Structured context survives; evidence degrades to empty but preserves subject refs.
  assert.deepEqual(out.evidence.claim_refs, []);
  assert.deepEqual(out.evidence.subject_refs, SUBJECT_REFS);
  assert.deepEqual(out.structured.source_ids, ["00000000-0000-4000-a000-000000000002"]);
  assert.deepEqual(rejects, ["evidence"]);
});

test("settleEvidenceLoads degrades both to empty when both throw", () => {
  const rejects: string[] = [];
  const out = settleEvidenceLoads(
    rejected(new Error("evidence down")),
    rejected(new Error("structured down")),
    SUBJECT_REFS,
    (loader) => rejects.push(loader),
  );

  // Both empty → the caller's structuredEvidenceStatus reports insufficient_evidence
  // (a clean signal) instead of the turn throwing a 500.
  assert.deepEqual(out.evidence.claim_refs, []);
  assert.equal(out.structured.quote, null);
  assert.deepEqual(out.structured.facts, []);
  assert.deepEqual(rejects.sort(), ["evidence", "structured_context"]);
});
