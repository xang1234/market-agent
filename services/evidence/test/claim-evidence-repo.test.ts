import test from "node:test";
import assert from "node:assert/strict";

import {
  createClaimEvidence,
  listClaimEvidenceForClaim,
} from "../src/claim-evidence-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const CLAIM_EVIDENCE_ID = "11111111-1111-4111-a111-111111111111";
const CLAIM_ID = "22222222-2222-4222-a222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-a333-333333333333";

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    claim_evidence_id: CLAIM_EVIDENCE_ID,
    claim_id: CLAIM_ID,
    document_id: DOCUMENT_ID,
    locator: { kind: "text_quote", offset_start: 10, offset_end: 40 },
    excerpt_hash: "sha256:abcdef",
    confidence: "0.91",
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

function recordingDb(rows = [evidenceRow()]) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: rows as R[],
        command: text.trimStart().startsWith("select") ? "SELECT" : "INSERT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

test("createClaimEvidence inserts an evidence locator without raw text", async () => {
  const { db, queries } = recordingDb();

  const evidence = await createClaimEvidence(db, {
    claim_id: CLAIM_ID,
    document_id: DOCUMENT_ID,
    locator: { kind: "text_quote", offset_start: 10, offset_end: 40 },
    excerpt_hash: "sha256:abcdef",
    confidence: 0.91,
  });

  assert.equal(evidence.claim_evidence_id, CLAIM_EVIDENCE_ID);
  assert.deepEqual(evidence.locator, { kind: "text_quote", offset_start: 10, offset_end: 40 });
  assert.equal(evidence.excerpt_hash, "sha256:abcdef");
  assert.equal(evidence.confidence, 0.91);
  assert.match(queries[0]!.text, /insert into claim_evidence/);
  assert.deepEqual(queries[0]!.values, [
    CLAIM_ID,
    DOCUMENT_ID,
    JSON.stringify({ kind: "text_quote", offset_start: 10, offset_end: 40 }),
    "sha256:abcdef",
    0.91,
  ]);
});

test("listClaimEvidenceForClaim returns evidence ordered by confidence and id", async () => {
  const { db, queries } = recordingDb([
    evidenceRow({ claim_evidence_id: "44444444-4444-4444-a444-444444444444", confidence: "0.95" }),
    evidenceRow({ claim_evidence_id: CLAIM_EVIDENCE_ID, confidence: "0.91" }),
  ]);

  const evidence = await listClaimEvidenceForClaim(db, CLAIM_ID);

  assert.equal(evidence.length, 2);
  assert.equal(evidence[0]!.confidence, 0.95);
  assert.match(queries[0]!.text, /where claim_id = \$1/);
  assert.match(queries[0]!.text, /order by confidence desc/);
  assert.match(queries[0]!.text, /claim_evidence_id/);
  assert.deepEqual(queries[0]!.values, [CLAIM_ID]);
});

test("claim evidence operations reject invalid inputs before querying", async () => {
  const { db, queries } = recordingDb();
  const valid = {
    claim_id: CLAIM_ID,
    document_id: DOCUMENT_ID,
    locator: { kind: "text_quote", offset_start: 10, offset_end: 40 },
    excerpt_hash: "sha256:abcdef",
    confidence: 0.91,
  };

  await assert.rejects(() => createClaimEvidence(db, { ...valid, claim_id: "not-a-uuid" }), /claim_id/);
  await assert.rejects(() => createClaimEvidence(db, { ...valid, document_id: "not-a-uuid" }), /document_id/);
  await assert.rejects(() => createClaimEvidence(db, { ...valid, locator: null as never }), /locator/);
  await assert.rejects(
    () => createClaimEvidence(db, { ...valid, locator: { kind: "text_quote", text: "raw body text" } }),
    /locator\.text/,
  );
  await assert.rejects(
    () => createClaimEvidence(db, { ...valid, locator: { kind: "nested", range: { excerpt: "raw quote" } } }),
    /locator\.range\.excerpt/,
  );
  await assert.rejects(
    () => createClaimEvidence(db, { ...valid, locator: { segments: [{ text: "raw quote" }] } }),
    /locator\.segments\[0\]\.text/,
  );
  await assert.rejects(
    () => createClaimEvidence(db, { ...valid, locator: { blocks: [{ metadata: { raw_text: "raw quote" } }] } }),
    /locator\.blocks\[0\]\.metadata\.raw_text/,
  );
  await assert.rejects(() => createClaimEvidence(db, { ...valid, excerpt_hash: " " }), /excerpt_hash/);
  await assert.rejects(() => createClaimEvidence(db, { ...valid, confidence: 1.1 }), /confidence/);
  await assert.rejects(() => listClaimEvidenceForClaim(db, "not-a-uuid"), /claim_id/);

  assert.equal(queries.length, 0);
});

test("listClaimEvidenceForClaim rejects stored confidence drift", async () => {
  const { db } = recordingDb([
    evidenceRow({ confidence: "NaN" }),
  ]);

  await assert.rejects(() => listClaimEvidenceForClaim(db, CLAIM_ID), /confidence/);
});
