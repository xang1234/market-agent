import test from "node:test";
import assert from "node:assert/strict";

import {
  GDELT_ARTICLE_DISCOVERY_PROVIDER,
  GDELT_DISCOVERY_DISCLOSURE,
  GDELT_DISCOVERY_LICENSE_CLASS,
  GDELT_DISCOVERY_STORE_POLICY,
  GDELT_DISCOVERY_TRUST_TIER,
} from "../src/gdelt-source.ts";
import {
  fetchEvidenceDocumentMetadata,
  searchEvidenceDocuments,
} from "../src/document-research.ts";
import type { QueryExecutor } from "../src/types.ts";

const SOURCE_ID = "11111111-1111-4111-a111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-a222-222222222222";
const SUBJECT_ID = "33333333-3333-4333-a333-333333333333";
const USER_ID = "44444444-4444-4444-a444-444444444444";

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

test("searchEvidenceDocuments finds GDELT documents through metadata filters without exposing raw text handles", async () => {
  const { db, queries } = recordingDb([
    documentRow({
      title: "Acme Robotics wins order as shares rise",
      canonical_url: "https://reuters.com/markets/acme-robotics",
      raw_blob_id: `ephemeral:${SOURCE_ID}`,
    }),
  ]);

  const result = await searchEvidenceDocuments(db, {
    query: "Acme",
    subjectRefs: [{ kind: "issuer", id: SUBJECT_ID }],
    canonicalUrl: "https://reuters.com/markets/acme-robotics",
    domain: "reuters.com",
    kind: "article",
    publishedFrom: "2026-05-01T00:00:00Z",
    publishedTo: "2026-05-30T00:00:00Z",
    userId: USER_ID,
    limit: 10,
  });

  assert.match(queries[0]!.text, /from documents d/i);
  assert.match(queries[0]!.text, /join sources s/i);
  assert.match(queries[0]!.text, /from mentions m/i);
  assert.match(queries[0]!.text, /canonical_host/i);
  assert.deepEqual(queries[0]!.values, [
    "Acme",
    JSON.stringify([{ kind: "issuer", id: SUBJECT_ID }]),
    "https://reuters.com/markets/acme-robotics",
    "reuters.com",
    "article",
    "2026-05-01T00:00:00.000Z",
    "2026-05-30T00:00:00.000Z",
    USER_ID,
    10,
  ]);

  assert.deepEqual(result.documents, [
    {
      document_id: DOCUMENT_ID,
      source_id: SOURCE_ID,
      kind: "article",
      title: "Acme Robotics wins order as shares rise",
      author: "reuters.com",
      published_at: "2026-05-29T12:30:00.000Z",
      canonical_url: "https://reuters.com/markets/acme-robotics",
      provider: GDELT_ARTICLE_DISCOVERY_PROVIDER,
      trust_tier: GDELT_DISCOVERY_TRUST_TIER,
      license_class: GDELT_DISCOVERY_LICENSE_CLASS,
      storage_policy: GDELT_DISCOVERY_STORE_POLICY,
      source_disclosure: GDELT_DISCOVERY_DISCLOSURE,
      raw_available: false,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /raw_blob_id|raw_text|FULL ARTICLE BODY/i);
});

test("searchEvidenceDocuments clamps caller-provided limits before querying", async () => {
  const { db, queries } = recordingDb([]);

  await searchEvidenceDocuments(db, {
    domain: "reuters.com",
    limit: 10_000,
  });

  assert.equal(queries[0]!.values?.[8], 100);
});

test("fetchEvidenceDocumentMetadata returns GDELT disclosure and no raw blob handle for an ephemeral document", async () => {
  const { db, queries } = recordingDb([documentRow()]);

  const result = await fetchEvidenceDocumentMetadata(db, {
    documentId: DOCUMENT_ID,
    userId: USER_ID,
  });

  assert.match(queries[0]!.text, /where d\.document_id = \$1::uuid/i);
  assert.deepEqual(queries[0]!.values, [DOCUMENT_ID, USER_ID]);
  assert.equal(result?.storage_policy, "metadata_only");
  assert.equal(result?.source_disclosure, GDELT_DISCOVERY_DISCLOSURE);
  assert.equal(result?.raw_available, false);
  assert.doesNotMatch(JSON.stringify(result), /raw_blob_id|raw_text|FULL ARTICLE BODY/i);
});

test("searchEvidenceDocuments rejects inverted publication ranges before querying", async () => {
  const { db, queries } = recordingDb([]);

  await assert.rejects(
    () => searchEvidenceDocuments(db, {
      query: "Acme",
      publishedFrom: "2026-05-30T00:00:00Z",
      publishedTo: "2026-05-01T00:00:00Z",
    }),
    /publishedFrom/,
  );

  assert.equal(queries.length, 0);
});

test("searchEvidenceDocuments normalizes domain filters to host-boundary matching", async () => {
  const { db, queries } = recordingDb([]);

  await searchEvidenceDocuments(db, {
    domain: "WWW.Reuters.com",
  });

  assert.match(queries[0]!.text, /canonical_host = \$4::text/i);
  assert.match(queries[0]!.text, /canonical_host like \('%\.' \|\| \$4::text\)/i);
  assert.equal(queries[0]!.values?.[3], "reuters.com");
});

test("searchEvidenceDocuments rejects domain filters that are not host names", async () => {
  const { db, queries } = recordingDb([]);

  await assert.rejects(
    () => searchEvidenceDocuments(db, { domain: "notreuters.com/path" }),
    /domain/,
  );

  assert.equal(queries.length, 0);
});

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    document_id: DOCUMENT_ID,
    source_id: SOURCE_ID,
    kind: "article",
    title: "Acme Robotics wins order as shares rise",
    author: "reuters.com",
    published_at: new Date("2026-05-29T12:30:00.000Z"),
    canonical_url: "https://reuters.com/markets/acme-robotics",
    provider: GDELT_ARTICLE_DISCOVERY_PROVIDER,
    trust_tier: GDELT_DISCOVERY_TRUST_TIER,
    license_class: GDELT_DISCOVERY_LICENSE_CLASS,
    raw_blob_id: `ephemeral:${SOURCE_ID}`,
    raw_text: "FULL ARTICLE BODY MUST NOT LEAK",
    ...overrides,
  };
}
