import test from "node:test";
import assert from "node:assert/strict";

import {
  GDELT_ARTICLE_DISCOVERY_PROVIDER,
  GDELT_DISCOVERY_LICENSE_CLASS,
  GDELT_DISCOVERY_SOURCE_KIND,
  GDELT_DISCOVERY_TRUST_TIER,
} from "../src/gdelt-source.ts";
import {
  GDELT_ROUTED_READER_TOOL_NAMES,
  buildGdeltSubjectArticleQuery,
  ingestGdeltArticleDiscoveries,
} from "../src/gdelt-ingest.ts";
import type { GdeltArticleDiscovery } from "../src/providers/gdelt.ts";
import type { QueryExecutor } from "../src/types.ts";
import type { ReaderToolInput, ReaderToolOutput } from "../../tools/src/reader-tool-dispatcher.ts";
import { RecordingObjectStore } from "./recording-object-store.ts";

const SUBJECT_ID = "33333333-3333-4333-a333-333333333333";
const SOURCE_ID = "11111111-1111-4111-a111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-a222-222222222222";
const HASH = `sha256:${"a".repeat(64)}`;

function article(overrides: Partial<GdeltArticleDiscovery> = {}): GdeltArticleDiscovery {
  return Object.freeze({
    url: "https://reuters.com/markets/acme-robotics",
    title: "Acme Robotics wins order as shares rise",
    seenAt: "2026-05-29T12:30:00.000Z",
    domain: "reuters.com",
    language: "English",
    sourceCountry: "United States",
    snippet: "Acme Robotics Holdings lifted guidance after a large enterprise order.",
    imageUrl: "https://reuters.com/acme.jpg",
    dedupeKey: "https://reuters.com/markets/acme-robotics",
    providerMetadataHash: HASH,
    providerMetadata: Object.freeze({
      fulltext: "FULL PUBLISHER ARTICLE BODY MUST NOT BE ROUTED OR STORED",
    }),
    ...overrides,
  });
}

function recordingDb(existing: ReadonlyArray<GdeltArticleDiscovery> = []) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const sources = new Map<string, Record<string, unknown>>();
  const documents = new Map<string, Record<string, unknown>>();

  for (const item of existing) {
    sources.set(item.dedupeKey, sourceRow(item.dedupeKey, item.providerMetadataHash));
    documents.set(item.dedupeKey, documentRow(item));
  }

  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });

      if (/from documents d/i.test(text) && /join sources s/i.test(text)) {
        const canonicalUrl = String(values?.[1]);
        const source = sources.get(canonicalUrl);
        const document = documents.get(canonicalUrl);
        return {
          rows: source && document ? [{ ...source, ...document }] as R[] : [] as R[],
          command: "SELECT",
          rowCount: source && document ? 1 : 0,
          oid: 0,
          fields: [],
        };
      }

      if (/insert into sources/i.test(text)) {
        const row = sourceRow(String(values?.[2]), String(values?.[6]), {
          provider: values?.[0],
          kind: values?.[1],
          trust_tier: values?.[3],
          license_class: values?.[4],
          retrieved_at: new Date(String(values?.[5])),
          user_id: values?.[7] ?? null,
        });
        sources.set(String(values?.[2]), row);
        return {
          rows: [row] as R[],
          command: "INSERT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }

      if (/insert into documents/i.test(text)) {
        const canonicalUrl = Array.from(sources.entries()).find(([, row]) => row.s_source_id === values?.[0])?.[0];
        const row = documentRow(article({
          url: canonicalUrl ?? "https://reuters.com/markets/acme-robotics",
          title: String(values?.[5]),
          seenAt: String(values?.[7]),
          language: values?.[8] == null ? null : String(values?.[8]),
          providerMetadataHash: String(values?.[1]),
        }), {
          content_hash: values?.[9],
          raw_blob_id: values?.[10],
        });
        if (canonicalUrl) documents.set(canonicalUrl, row);
        return {
          rows: [row] as R[],
          command: "INSERT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }

      if (/insert into mentions/i.test(text)) {
        return {
          rows: [{
            mention_id: "44444444-4444-4444-a444-444444444444",
            document_id: values?.[0],
            subject_kind: values?.[1],
            subject_id: values?.[2],
            prominence: values?.[3],
            mention_count: values?.[4],
            confidence: values?.[5],
            created_at: new Date("2026-05-30T01:00:00.000Z"),
          }] as R[],
          command: "INSERT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }

      if (/delete from sources/i.test(text)) {
        return {
          rows: [] as R[],
          command: "DELETE",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }

      throw new Error(`unexpected SQL: ${text}`);
    },
  };

  return { db, queries };
}

function sourceRow(canonicalUrl: string, contentHash: string, overrides: Record<string, unknown> = {}) {
  return {
    s_source_id: SOURCE_ID,
    s_provider: GDELT_ARTICLE_DISCOVERY_PROVIDER,
    s_kind: GDELT_DISCOVERY_SOURCE_KIND,
    s_canonical_url: canonicalUrl,
    s_trust_tier: GDELT_DISCOVERY_TRUST_TIER,
    s_license_class: GDELT_DISCOVERY_LICENSE_CLASS,
    s_retrieved_at: new Date("2026-05-30T01:00:00.000Z"),
    s_content_hash: contentHash,
    s_user_id: null,
    s_created_at: new Date("2026-05-30T01:00:00.000Z"),
    source_id: SOURCE_ID,
    provider: GDELT_ARTICLE_DISCOVERY_PROVIDER,
    kind: GDELT_DISCOVERY_SOURCE_KIND,
    canonical_url: canonicalUrl,
    trust_tier: GDELT_DISCOVERY_TRUST_TIER,
    license_class: GDELT_DISCOVERY_LICENSE_CLASS,
    retrieved_at: new Date("2026-05-30T01:00:00.000Z"),
    content_hash: contentHash,
    user_id: null,
    created_at: new Date("2026-05-30T01:00:00.000Z"),
    ...overrides,
  };
}

function documentRow(item: GdeltArticleDiscovery, overrides: Record<string, unknown> = {}) {
  return {
    d_document_id: DOCUMENT_ID,
    d_source_id: SOURCE_ID,
    d_provider_doc_id: item.providerMetadataHash,
    d_kind: "article",
    d_parent_document_id: null,
    d_conversation_id: null,
    d_title: item.title,
    d_author: item.domain,
    d_published_at: new Date(item.seenAt),
    d_lang: item.language,
    d_content_hash: item.providerMetadataHash,
    d_raw_blob_id: `ephemeral:${SOURCE_ID}`,
    d_parse_status: "pending",
    d_deleted_at: null,
    d_created_at: new Date("2026-05-30T01:00:00.000Z"),
    d_updated_at: new Date("2026-05-30T01:00:00.000Z"),
    inserted: true,
    document_id: DOCUMENT_ID,
    source_id: SOURCE_ID,
    provider_doc_id: item.providerMetadataHash,
    kind: "article",
    parent_document_id: null,
    conversation_id: null,
    title: item.title,
    author: item.domain,
    published_at: new Date(item.seenAt),
    lang: item.language,
    content_hash: item.providerMetadataHash,
    raw_blob_id: `ephemeral:${SOURCE_ID}`,
    parse_status: "pending",
    deleted_at: null,
    created_at: new Date("2026-05-30T01:00:00.000Z"),
    updated_at: new Date("2026-05-30T01:00:00.000Z"),
    ...overrides,
  };
}

test("buildGdeltSubjectArticleQuery uses issuer phrases plus market-qualified ticker terms", () => {
  assert.equal(
    buildGdeltSubjectArticleQuery({
      subjectRef: { kind: "issuer", id: SUBJECT_ID },
      issuerName: "Acme Robotics Holdings",
      ticker: " acme ",
      aliases: ["Acme Robotics", "Acme Robotics Holdings"],
    }),
    '("Acme Robotics Holdings" OR "Acme Robotics" OR (ACME stock OR ACME shares OR $ACME))',
  );
  assert.throws(
    () =>
      buildGdeltSubjectArticleQuery({
        subjectRef: { kind: "issuer", id: SUBJECT_ID },
        issuerName: "Acme Robotics Holdings",
        ticker: "ACME) OR domain:spam.example",
      }),
    /ticker/,
  );
});

test("ingestGdeltArticleDiscoveries stores metadata-only GDELT articles and routes safe reader tool hints", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();
  const requests: unknown[] = [];
  const routed: Array<{ toolName: string; input: ReaderToolInput }> = [];
  const readerTools = Object.fromEntries(
    GDELT_ROUTED_READER_TOOL_NAMES.map((toolName) => [
      toolName,
      async (input: ReaderToolInput): Promise<ReaderToolOutput> => {
        routed.push({ toolName, input });
        return { items: [], source_ids: [SOURCE_ID] };
      },
    ]),
  );

  const result = await ingestGdeltArticleDiscoveries(
    {
      db,
      objectStore,
      discoveryClient: {
        async searchArticles(request) {
          requests.push(request);
          return {
            articles: [
              article(),
              article({
                url: "https://spam.example/acme",
                domain: "spam.example",
                dedupeKey: "https://spam.example/acme",
              }),
              article({
                url: "https://reuters.com/lifestyle/acme-cartoon",
                title: "ACME rocket cartoon returns to theaters",
                snippet: "The old ACME gag gets a reboot.",
                dedupeKey: "https://reuters.com/lifestyle/acme-cartoon",
                providerMetadataHash: `sha256:${"b".repeat(64)}`,
              }),
              article({
                url: "https://reuters.com/markets/acme-spanish",
                title: "Acme Robotics Holdings gana contrato",
                snippet: "Acme Robotics Holdings actualizo su guia.",
                language: "Spanish",
                dedupeKey: "https://reuters.com/markets/acme-spanish",
                providerMetadataHash: `sha256:${"c".repeat(64)}`,
              }),
            ],
            requestUrl: "https://api.gdeltproject.org/api/v2/doc/doc?query=...",
            retrievedAt: "2026-05-30T01:00:00.000Z",
          };
        },
      },
      readerTools,
    },
    {
      subject: {
        subjectRef: { kind: "issuer", id: SUBJECT_ID },
        issuerName: "Acme Robotics Holdings",
        ticker: "ACME",
        aliases: ["Acme Robotics"],
      },
      startDateTime: "2026-05-29T00:00:00Z",
      endDateTime: "2026-05-30T00:00:00Z",
      maxRecords: 25,
      searchLanguage: "english",
      domains: ["Reuters.com"],
    },
  );

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    query: '("Acme Robotics Holdings" OR "Acme Robotics" OR (ACME stock OR ACME shares OR $ACME))',
    startDateTime: "2026-05-29T00:00:00Z",
    endDateTime: "2026-05-30T00:00:00Z",
    maxRecords: 25,
    searchLanguage: "english",
    domains: ["Reuters.com"],
  });
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0]?.status, "created");
  assert.deepEqual(
    result.skipped.map((item) => item.reason).sort(),
    ["domain_mismatch", "irrelevant_subject_match", "language_mismatch"],
  );

  const sourceInsert = queries.find((query) => /insert into sources/i.test(query.text));
  assert.deepEqual(sourceInsert?.values?.slice(0, 7), [
    GDELT_ARTICLE_DISCOVERY_PROVIDER,
    "article",
    "https://reuters.com/markets/acme-robotics",
    "tertiary",
    "ephemeral",
    "2026-05-30T01:00:00.000Z",
    HASH,
  ]);

  const documentInsert = queries.find((query) => /insert into documents/i.test(query.text));
  assert.equal(documentInsert?.values?.[1], HASH);
  assert.equal(documentInsert?.values?.[2], "article");
  assert.equal(documentInsert?.values?.[5], "Acme Robotics wins order as shares rise");
  assert.equal(documentInsert?.values?.[6], "reuters.com");
  assert.equal(documentInsert?.values?.[7], "2026-05-29T12:30:00.000Z");
  assert.equal(documentInsert?.values?.[8], "English");
  assert.equal(String(documentInsert?.values?.[10]), `ephemeral:${SOURCE_ID}`);
  assert.equal(objectStore.putCalls, 0, "ephemeral GDELT metadata must not persist a raw blob");

  const mentionInsert = queries.find((query) => /insert into mentions/i.test(query.text));
  assert.deepEqual(mentionInsert?.values, [
    DOCUMENT_ID,
    "issuer",
    SUBJECT_ID,
    "headline",
    1,
    0.6,
  ]);

  assert.deepEqual(
    routed.map((call) => call.toolName),
    ["extract_mentions", "extract_claims", "extract_events", "classify_sentiment"],
  );
  const hint = routed[0]?.input.schema_hint as Record<string, unknown>;
  assert.equal(hint.storage_policy, "metadata_only");
  assert.equal(hint.provider, GDELT_ARTICLE_DISCOVERY_PROVIDER);
  assert.match(String(hint.allowed_text), /Acme Robotics Holdings lifted guidance/);
  assert.doesNotMatch(String(hint.allowed_text), /FULL PUBLISHER ARTICLE BODY/);
});

test("ingestGdeltArticleDiscoveries is idempotent by GDELT canonical article URL", async () => {
  const canonicalUrl = "https://reuters.com/markets/acme-robotics";
  const existingItem = article({
    url: `${canonicalUrl}?utm_source=feed`,
    dedupeKey: canonicalUrl,
  });
  const incomingItem = article({
    url: `${canonicalUrl}?utm_medium=email`,
    dedupeKey: canonicalUrl,
  });
  const { db, queries } = recordingDb([existingItem]);
  const objectStore = new RecordingObjectStore();
  const routed: string[] = [];
  const readerTools = Object.fromEntries(
    GDELT_ROUTED_READER_TOOL_NAMES.map((toolName) => [
      toolName,
      async (): Promise<ReaderToolOutput> => {
        routed.push(toolName);
        return { items: [], source_ids: [SOURCE_ID] };
      },
    ]),
  );

  const result = await ingestGdeltArticleDiscoveries(
    {
      db,
      objectStore,
      readerTools,
      discoveryClient: {
        async searchArticles() {
          return {
            articles: [incomingItem],
            requestUrl: "https://api.gdeltproject.org/api/v2/doc/doc?query=...",
            retrievedAt: "2026-05-30T01:00:00.000Z",
          };
        },
      },
    },
    {
      subject: {
        subjectRef: { kind: "issuer", id: SUBJECT_ID },
        issuerName: "Acme Robotics Holdings",
        aliases: ["Acme Robotics"],
      },
      timespan: "1d",
    },
  );

  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0]?.status, "already_present");
  assert.equal(queries.some((query) => /insert into sources/i.test(query.text)), false);
  assert.equal(queries.some((query) => /insert into documents/i.test(query.text)), false);
  assert.equal(objectStore.putCalls, 0);
  assert.deepEqual(routed, []);
});

test("ingestGdeltArticleDiscoveries does not match issuer phrases inside unrelated words", async () => {
  const { db, queries } = recordingDb();

  const result = await ingestGdeltArticleDiscoveries(
    {
      db,
      objectStore: new RecordingObjectStore(),
      discoveryClient: {
        async searchArticles() {
          return {
            articles: [
              article({
                title: "Retailers said margins improved",
                snippet: "The report does not mention the target company.",
                providerMetadataHash: `sha256:${"d".repeat(64)}`,
              }),
            ],
            requestUrl: "https://api.gdeltproject.org/api/v2/doc/doc?query=...",
            retrievedAt: "2026-05-30T01:00:00.000Z",
          };
        },
      },
    },
    {
      subject: {
        subjectRef: { kind: "issuer", id: SUBJECT_ID },
        issuerName: "AI",
      },
      timespan: "1d",
    },
  );

  assert.equal(result.articles.length, 0);
  assert.deepEqual(result.skipped.map((item) => item.reason), ["irrelevant_subject_match"]);
  assert.equal(queries.some((query) => /insert into sources/i.test(query.text)), false);
});
