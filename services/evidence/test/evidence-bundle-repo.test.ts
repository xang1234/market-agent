import test from "node:test";
import assert from "node:assert/strict";

import {
  assembleEvidenceBundle,
  buildEvidenceBundle,
  getEvidenceBundle,
} from "../src/evidence-bundle-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const CLAIM_A = "11111111-1111-4111-a111-111111111111";
const CLAIM_B = "22222222-2222-4222-a222-222222222222";
const EVENT_ID = "33333333-3333-4333-a333-333333333333";
const DOCUMENT_A = "44444444-4444-4444-8444-444444444444";
const DOCUMENT_B = "55555555-5555-4555-8555-555555555555";

type Query = { text: string; values?: unknown[] };

function recordingDb(rows: Record<string, unknown>[], storedBundleRows: Record<string, unknown>[] = []) {
  const queries: Query[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (/insert into evidence_bundles/i.test(text)) {
        return {
          rows: (storedBundleRows.length > 0 ? [] : [{ bundle: JSON.parse(String(values?.[1])) }]) as R[],
          command: "INSERT",
          rowCount: storedBundleRows.length > 0 ? 0 : 1,
          oid: 0,
          fields: [],
        };
      }
      if (/from evidence_bundles/i.test(text)) {
        return {
          rows: storedBundleRows as R[],
          command: "SELECT",
          rowCount: storedBundleRows.length,
          oid: 0,
          fields: [],
        };
      }
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

test("buildEvidenceBundle derives the same bundle_id from canonical content", async () => {
  const rows = [
    bundleRow({ claim_id: CLAIM_B, document_id: DOCUMENT_B, confidence: "0.80" }),
    bundleRow({ claim_id: CLAIM_A, document_id: DOCUMENT_A, confidence: "0.95" }),
  ];
  const first = await buildEvidenceBundle(recordingDb(rows).db, { claim_ids: [CLAIM_B, CLAIM_A] });
  const second = await buildEvidenceBundle(recordingDb([...rows].reverse()).db, { claim_ids: [CLAIM_A, CLAIM_B] });

  assert.match(first.bundle_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(second.bundle_id, first.bundle_id);
  assert.deepEqual(second, first);
});

test("getEvidenceBundle resolves a deterministic bundle_id and returns the same payload", async () => {
  const rows = [bundleRow({ claim_id: CLAIM_A, document_id: DOCUMENT_A, confidence: "0.95" })];
  const build = recordingDb(rows);
  const built = await buildEvidenceBundle(build.db, { claim_ids: [CLAIM_A] });

  const fetch = recordingDb([], [{ bundle: built }]);
  const fetched = await getEvidenceBundle(fetch.db, built.bundle_id);

  assert.deepEqual(fetched, built);
  assert.equal(build.queries.some((query) => /insert into evidence_bundles/i.test(query.text)), true);
  assert.match(fetch.queries[0]!.text, /from evidence_bundles/i);
  assert.deepEqual(fetch.queries[0]!.values, [built.bundle_id]);
});

test("buildEvidenceBundle persists the immutable bundle payload under the deterministic id", async () => {
  const { db, queries } = recordingDb([bundleRow({ claim_id: CLAIM_A, document_id: DOCUMENT_A })]);

  const built = await buildEvidenceBundle(db, { claim_ids: [CLAIM_A] });

  const insert = queries.find((query) => /insert into evidence_bundles/i.test(query.text));
  assert.ok(insert);
  assert.doesNotMatch(insert.text, /do update/i);
  assert.deepEqual(insert.values, [built.bundle_id, JSON.stringify(built)]);
});

test("buildEvidenceBundle rejects a conflicting stored payload for the same bundle_id", async () => {
  const rows = [bundleRow({ claim_id: CLAIM_A, document_id: DOCUMENT_A })];
  const built = await buildEvidenceBundle(recordingDb(rows).db, { claim_ids: [CLAIM_A] });
  const conflicting = {
    ...built,
    evidence: [{ ...built.evidence[0]!, confidence: 0.01 }],
  };

  await assert.rejects(
    () => buildEvidenceBundle(recordingDb(rows, [{ bundle: conflicting }]).db, { claim_ids: [CLAIM_A] }),
    /stored bundle payload does not match canonical content/,
  );
});

test("EvidenceBundle locators are deeply immutable after build and fetch", async () => {
  const rows = [
    bundleRow({
      locator: { kind: "nested", ranges: [{ offset_start: 10, offset_end: 20 }] },
    }),
  ];
  const built = await buildEvidenceBundle(recordingDb(rows).db, { claim_ids: [CLAIM_A] });
  const fetched = await getEvidenceBundle(recordingDb([], [{ bundle: built }]).db, built.bundle_id);

  const builtRange = (built.evidence[0]!.locator.ranges as Array<Record<string, unknown>>)[0]!;
  const fetchedRange = (fetched.evidence[0]!.locator.ranges as Array<Record<string, unknown>>)[0]!;

  assert.throws(() => {
    builtRange.offset_start = 99;
  }, TypeError);
  assert.throws(() => {
    fetchedRange.offset_start = 99;
  }, TypeError);
});

test("getEvidenceBundle rejects stored payloads whose content no longer matches bundle_id", async () => {
  const rows = [bundleRow({ claim_id: CLAIM_A, document_id: DOCUMENT_A, confidence: "0.95" })];
  const built = await buildEvidenceBundle(recordingDb(rows).db, { claim_ids: [CLAIM_A] });
  const tampered = {
    ...built,
    evidence: [{ ...built.evidence[0]!, confidence: 0.01 }],
  };

  await assert.rejects(
    () => getEvidenceBundle(recordingDb([], [{ bundle: tampered }]).db, built.bundle_id),
    /stored bundle payload does not match canonical content/,
  );
});

test("getEvidenceBundle rejects non-bundle ids before querying", async () => {
  const { db, queries } = recordingDb([]);

  await assert.rejects(() => getEvidenceBundle(db, "not-a-uuid"), /bundle_id/);

  assert.equal(queries.length, 0);
});

test("getEvidenceBundle reports missing persisted bundles", async () => {
  const { db, queries } = recordingDb([]);

  await assert.rejects(() => getEvidenceBundle(db, DOCUMENT_A), /not found/);

  assert.match(queries[0]!.text, /from evidence_bundles/i);
  assert.deepEqual(queries[0]!.values, [DOCUMENT_A]);
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
