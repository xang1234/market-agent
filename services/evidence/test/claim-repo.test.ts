import test from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_MODALITIES,
  CLAIM_POLARITIES,
  CLAIM_STATUSES,
  createClaim,
  listClaimsForDocument,
} from "../src/claim-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const CLAIM_ID = "11111111-1111-4111-a111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-a222-222222222222";
const SOURCE_ID = "33333333-3333-4333-a333-333333333333";

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    claim_id: CLAIM_ID,
    document_id: DOCUMENT_ID,
    predicate: "beats_estimates",
    text_canonical: "Apple beat Q1 revenue estimates",
    polarity: "positive",
    modality: "asserted",
    reported_by_source_id: SOURCE_ID,
    attributed_to_type: "company",
    attributed_to_id: "apple",
    effective_time: new Date("2026-05-01T00:00:00.000Z"),
    confidence: "0.84",
    status: "extracted",
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    updated_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

function recordingDb(rows = [claimRow()]) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: rows as R[],
        command: text.includes("insert") ? "INSERT" : "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

test("createClaim inserts modality, attribution, effective time, confidence, and status", async () => {
  const { db, queries } = recordingDb();

  const claim = await createClaim(db, {
    document_id: DOCUMENT_ID,
    predicate: "beats_estimates",
    text_canonical: "Apple beat Q1 revenue estimates",
    polarity: "positive",
    modality: "asserted",
    reported_by_source_id: SOURCE_ID,
    attributed_to_type: "company",
    attributed_to_id: "apple",
    effective_time: "2026-05-01T00:00:00Z",
    confidence: 0.84,
    status: "extracted",
  });

  assert.equal(claim.claim_id, CLAIM_ID);
  assert.equal(claim.modality, "asserted");
  assert.equal(claim.confidence, 0.84);
  assert.equal(claim.effective_time, "2026-05-01T00:00:00.000Z");
  assert.equal(queries.length, 1);
  assert.match(queries[0]!.text, /insert into claims/);
  assert.deepEqual(queries[0]!.values, [
    DOCUMENT_ID,
    "beats_estimates",
    "Apple beat Q1 revenue estimates",
    "positive",
    "asserted",
    SOURCE_ID,
    "company",
    "apple",
    "2026-05-01T00:00:00Z",
    0.84,
    "extracted",
  ]);
});

test("listClaimsForDocument returns claims ordered by effective time and creation time", async () => {
  const { db, queries } = recordingDb([
    claimRow({ claim_id: CLAIM_ID, effective_time: null }),
    claimRow({
      claim_id: "44444444-4444-4444-a444-444444444444",
      modality: "rumored",
      status: "extracted",
      confidence: 0.42,
    }),
  ]);

  const claims = await listClaimsForDocument(db, DOCUMENT_ID);

  assert.equal(claims.length, 2);
  assert.equal(claims[1]!.modality, "rumored");
  assert.equal(claims[1]!.confidence, 0.42);
  assert.match(queries[0]!.text, /where document_id = \$1/);
  assert.match(queries[0]!.text, /order by effective_time/);
  assert.deepEqual(queries[0]!.values, [DOCUMENT_ID]);
});

test("createClaim rejects invalid claim inputs before querying", async () => {
  const { db, queries } = recordingDb();
  const valid = {
    document_id: DOCUMENT_ID,
    predicate: "beats_estimates",
    text_canonical: "Apple beat Q1 revenue estimates",
    polarity: "positive" as const,
    modality: "asserted" as const,
    reported_by_source_id: SOURCE_ID,
    attributed_to_type: "company",
    attributed_to_id: "apple",
    effective_time: "2026-05-01T00:00:00Z",
    confidence: 0.84,
    status: "extracted" as const,
  };

  await assert.rejects(() => createClaim(db, { ...valid, document_id: "not-a-uuid" }), /document_id/);
  await assert.rejects(() => createClaim(db, { ...valid, predicate: " " }), /predicate/);
  await assert.rejects(() => createClaim(db, { ...valid, text_canonical: " " }), /text_canonical/);
  await assert.rejects(() => createClaim(db, { ...valid, polarity: "bullish" as never }), /polarity/);
  await assert.rejects(() => createClaim(db, { ...valid, modality: "certain" as never }), /modality/);
  await assert.rejects(() => createClaim(db, { ...valid, reported_by_source_id: "not-a-uuid" }), /reported_by_source_id/);
  await assert.rejects(() => createClaim(db, { ...valid, status: "published" as never }), /status/);
  await assert.rejects(() => createClaim(db, { ...valid, confidence: 1.1 }), /confidence/);
  await assert.rejects(() => createClaim(db, { ...valid, effective_time: "2026-05-01" }), /effective_time/);

  assert.equal(queries.length, 0);
});

test("CLAIM_MODALITIES and CLAIM_STATUSES pin the schema enums", () => {
  assert.deepEqual(CLAIM_MODALITIES, ["asserted", "estimated", "speculative", "rumored", "quoted"]);
  assert.deepEqual(CLAIM_POLARITIES, ["positive", "negative", "neutral", "mixed"]);
  assert.deepEqual(CLAIM_STATUSES, ["extracted", "corroborated", "disputed", "rejected"]);
  assert.equal(Object.isFrozen(CLAIM_MODALITIES), true);
  assert.equal(Object.isFrozen(CLAIM_POLARITIES), true);
  assert.equal(Object.isFrozen(CLAIM_STATUSES), true);
});
