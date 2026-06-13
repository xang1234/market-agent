import test from "node:test";
import assert from "node:assert/strict";
import { buildClaimBackedSealInput } from "../src/block-seal-input.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import {
  DETERMINISTIC_SNAPSHOT_MANIFEST,
  auditManifestToolCallLog,
} from "../../snapshot/src/manifest-staging.ts";

const SNAPSHOT_ID = "8b6c8b1e-6a1f-4d2a-9a3b-0c1d2e3f4a5b";
const CLAIM_ID = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const DOC_ID = "2b3c4d5e-6f7a-4b2c-8d3e-4f5a6b7c8d9e";
const SOURCE_ID = "3c4d5e6f-7a8b-4c3d-8e4f-5a6b7c8d9e0f";
const TOOL_CALL_ID = "4d5e6f7a-8b9c-4d4e-8f5a-6b7c8d9e0f1a";
const SUBJECT_ID = "5e6f7a8b-9c0d-4e5f-8a6b-7c8d9e0f1a2b";
const AS_OF = "2026-06-10T00:00:00Z";

const BLOCK_ID = "6f7a8b9c-0d1e-4f6a-8b7c-8d9e0f1a2b3c";
function block() {
  return {
    id: BLOCK_ID,
    kind: "rich_text" as const,
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
    source_refs: [SOURCE_ID],
    data_ref: { kind: "rich_text", id: BLOCK_ID, params: { column_key: "reader_question" } },
    segments: [
      { type: "text", text: "Management flagged China tariff exposure in Q1." },
      { type: "ref", ref_kind: "claim", ref_id: CLAIM_ID },
    ],
  };
}

function sealInput() {
  return buildClaimBackedSealInput({
    block: block(),
    claims: [{ claim_id: CLAIM_ID, source_id: SOURCE_ID }],
    documents: [{ document_id: DOC_ID, source_id: SOURCE_ID }],
    subjectRefs: [{ kind: "issuer", id: SUBJECT_ID }],
    toolCalls: [{ tool_call_id: TOOL_CALL_ID, result_hash: "sha256:" + "a".repeat(64) }],
    modelVersion: "reader:test-model",
  });
}

test("claim-backed seal passes the snapshot verifier", async () => {
  const input = sealInput();
  const result = await verifySnapshotSeal(input);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test("manifest is STAGED, not deterministic, and carries tool-call provenance", () => {
  const input = sealInput();
  assert.notEqual(
    (input.manifest as Record<PropertyKey, unknown>)[DETERMINISTIC_SNAPSHOT_MANIFEST as unknown as PropertyKey],
    true,
  );
  assert.deepEqual(input.manifest.tool_call_ids, [TOOL_CALL_ID]);
  assert.deepEqual(input.manifest.claim_refs, [CLAIM_ID]);
  assert.deepEqual(input.manifest.document_refs, [DOC_ID]);
});

test("a block citing a claim missing from the manifest fails verification", async () => {
  const input = sealInput();
  const broken = { ...input, manifest: { ...input.manifest, claim_refs: [] } };
  const result = await verifySnapshotSeal(broken as typeof input);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.reason_code === "missing_claim_ref"));
});

test("buildClaimBackedSealInput throws on empty toolCalls", () => {
  assert.throws(
    () =>
      buildClaimBackedSealInput({
        block: block(),
        claims: [{ claim_id: CLAIM_ID, source_id: SOURCE_ID }],
        documents: [{ document_id: DOC_ID, source_id: SOURCE_ID }],
        subjectRefs: [{ kind: "issuer", id: SUBJECT_ID }],
        toolCalls: [],
        modelVersion: "reader:test-model",
      }),
    /LLM-derived blocks require at least one tool call ref/,
  );
});

test("the sealer-side audit accepts the manifest when tool_call_logs match", async () => {
  const input = sealInput();
  const fakeDb = {
    query: async () => ({
      rows: [{ tool_call_id: TOOL_CALL_ID, result_hash: "sha256:" + "a".repeat(64) }],
      rowCount: 1,
    }),
  };
  const audit = await auditManifestToolCallLog(fakeDb as never, input.manifest as never);
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.missing_tool_call_ids, []);
  assert.deepEqual(audit.mismatched_tool_call_ids, []);
});

test("the sealer-side audit rejects the manifest when the log hash mismatches", async () => {
  const input = sealInput();
  const fakeDb = {
    query: async () => ({
      rows: [{ tool_call_id: TOOL_CALL_ID, result_hash: "sha256:" + "b".repeat(64) }],
      rowCount: 1,
    }),
  };
  const audit = await auditManifestToolCallLog(fakeDb as never, input.manifest as never);
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.mismatched_tool_call_ids, [TOOL_CALL_ID]);
});
