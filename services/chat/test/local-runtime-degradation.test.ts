import assert from "node:assert/strict";
import test from "node:test";

import type { QueryExecutor } from "../../evidence/src/types.ts";
import { loadEvidenceOrEmpty } from "../src/local-runtime.ts";

const ISSUER_ID = "b12a08d7-8ae4-4acf-bfac-8090845938c6";

// A QueryExecutor whose every query rejects, simulating a DB that's down.
const failingDb: QueryExecutor = {
  query: (async () => {
    throw new Error("db down");
  }) as QueryExecutor["query"],
};

test("loadEvidenceOrEmpty degrades to empty evidence (preserving subject refs) when the load throws", async () => {
  const warnings: unknown[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const evidence = await loadEvidenceOrEmpty(failingDb, {
      subject_refs: [{ kind: "issuer", id: ISSUER_ID }],
      user_id: null,
    });

    assert.deepEqual(evidence.claim_refs, []);
    assert.deepEqual(evidence.document_refs, []);
    assert.deepEqual(evidence.subject_refs, [{ kind: "issuer", id: ISSUER_ID }]);
    assert.equal(warnings.length, 1, "the degradation must be logged, not silent");
  } finally {
    console.warn = original;
  }
});

test("loadEvidenceOrEmpty passes the underlying result through on success", async () => {
  // Empty subject_refs short-circuits loadLocalRuntimeEvidence before any query,
  // so this exercises the non-failing path without a DB: the wrapper returns the
  // real (empty) result unchanged.
  const evidence = await loadEvidenceOrEmpty(failingDb, {
    subject_refs: [],
    user_id: null,
  });

  assert.deepEqual(evidence.claim_refs, []);
  assert.deepEqual(evidence.subject_refs, []);
});
