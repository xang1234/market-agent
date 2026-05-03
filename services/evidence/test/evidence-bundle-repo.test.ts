import test from "node:test";
import assert from "node:assert/strict";

import { assembleEvidenceBundle } from "../src/evidence-bundle-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const CLAIM_A = "11111111-1111-4111-a111-111111111111";
const CLAIM_B = "22222222-2222-4222-a222-222222222222";
const EVENT_ID = "33333333-3333-4333-a333-333333333333";
const DOCUMENT_A = "44444444-4444-4444-8444-444444444444";
const DOCUMENT_B = "55555555-5555-4555-8555-555555555555";

type Query = { text: string; values?: unknown[] };

function recordingDb(rows: Record<string, unknown>[]) {
  const queries: Query[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: rows as R[],
        command: "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

test("assembleEvidenceBundle returns metadata-only documents and evidence locators", async () => {
  const { db } = recordingDb([
    bundleRow({
      claim_id: CLAIM_A,
      document_id: DOCUMENT_A,
      title: "Q1 10-Q",
      author: "Apple Inc.",
      published_at: new Date("2026-05-01T00:00:00.000Z"),
      canonical_url: "https://www.sec.gov/aapl-q1",
      trust_tier: "primary",
      locator: { kind: "xbrl_fact", fact_id: "revenue" },
      excerpt_hash: "sha256:abc123",
      confidence: "0.97",
      raw_blob_id: "sha256:raw",
      content_hash: "sha256:content",
      raw_body: "must not leak",
    }),
  ]);

  const bundle = await assembleEvidenceBundle(db, { claim_ids: [CLAIM_A] });

  assert.deepEqual(bundle.documents, [
    {
      document_id: DOCUMENT_A,
      title: "Q1 10-Q",
      author: "Apple Inc.",
      published_at: "2026-05-01T00:00:00.000Z",
      canonical_url: "https://www.sec.gov/aapl-q1",
      source: { trust_tier: "primary" },
    },
  ]);
  assert.deepEqual(bundle.evidence, [
    {
      claim_id: CLAIM_A,
      document_id: DOCUMENT_A,
      locator: { kind: "xbrl_fact", fact_id: "revenue" },
      excerpt_hash: "sha256:abc123",
      confidence: 0.97,
    },
  ]);
  assert.equal(JSON.stringify(bundle).includes("raw_blob_id"), false);
  assert.equal(JSON.stringify(bundle).includes("raw_body"), false);
  assert.equal(JSON.stringify(bundle).includes("content_hash"), false);
});

test("assembleEvidenceBundle produces deterministic document and evidence ordering", async () => {
  const { db } = recordingDb([
    bundleRow({
      claim_id: CLAIM_B,
      document_id: DOCUMENT_B,
      published_at: null,
      claim_evidence_id: "99999999-9999-4999-8999-999999999999",
      confidence: "0.80",
    }),
    bundleRow({
      claim_id: CLAIM_A,
      document_id: DOCUMENT_A,
      published_at: new Date("2026-04-01T00:00:00.000Z"),
      claim_evidence_id: "88888888-8888-4888-8888-888888888888",
      confidence: "0.95",
    }),
    bundleRow({
      claim_id: CLAIM_A,
      document_id: DOCUMENT_B,
      published_at: null,
      claim_evidence_id: "77777777-7777-4777-8777-777777777777",
      confidence: "0.70",
    }),
  ]);

  const bundle = await assembleEvidenceBundle(db, { claim_ids: [CLAIM_B, CLAIM_A, CLAIM_A] });

  assert.deepEqual(bundle.documents.map((document) => document.document_id), [DOCUMENT_A, DOCUMENT_B]);
  assert.deepEqual(
    bundle.evidence.map((evidence) => `${evidence.claim_id}:${evidence.document_id}:${evidence.confidence}`),
    [`${CLAIM_A}:${DOCUMENT_A}:0.95`, `${CLAIM_A}:${DOCUMENT_B}:0.7`, `${CLAIM_B}:${DOCUMENT_B}:0.8`],
  );
});

test("assembleEvidenceBundle expands event ids to source claim ids in SQL", async () => {
  const { db, queries } = recordingDb([
    bundleRow({ claim_id: CLAIM_A, document_id: DOCUMENT_A }),
  ]);

  await assembleEvidenceBundle(db, { event_ids: [EVENT_ID] });

  assert.match(queries[0]!.text, /from events/i);
  assert.match(queries[0]!.text, /jsonb_array_elements_text/i);
  assert.deepEqual(queries[0]!.values, [[], [EVENT_ID]]);
});

test("assembleEvidenceBundle rejects empty or invalid inputs before querying", async () => {
  const { db, queries } = recordingDb([]);

  await assert.rejects(() => assembleEvidenceBundle(db, {}), /claim_ids or event_ids/);
  await assert.rejects(() => assembleEvidenceBundle(db, { claim_ids: ["not-a-uuid"] }), /claim_ids\[0\]/);
  await assert.rejects(() => assembleEvidenceBundle(db, { event_ids: ["not-a-uuid"] }), /event_ids\[0\]/);

  assert.equal(queries.length, 0);
});

function bundleRow(overrides: Record<string, unknown> = {}) {
  return {
    claim_evidence_id: "66666666-6666-4666-8666-666666666666",
    claim_id: CLAIM_A,
    document_id: DOCUMENT_A,
    locator: { kind: "text_quote", offset_start: 10, offset_end: 20 },
    excerpt_hash: "sha256:abcdef",
    confidence: "0.91",
    title: "Document",
    author: "Reporter",
    published_at: new Date("2026-05-03T00:00:00.000Z"),
    canonical_url: "https://example.com/doc",
    trust_tier: "secondary",
    ...overrides,
  };
}
