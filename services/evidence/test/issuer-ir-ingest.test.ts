import test from "node:test";
import assert from "node:assert/strict";

import {
  ingestIssuerIrSource,
} from "../src/issuer-ir-ingest.ts";
import type { IrSourceRegistryRow } from "../src/issuer-ir-registry.ts";
import { MemoryObjectStore, rawBlobIdFromBytes } from "../src/object-store.ts";
import type { QueryExecutor } from "../src/types.ts";

const ISSUER_ID = "33333333-3333-4333-a333-333333333333";
const SOURCE_ID = "11111111-1111-4111-a111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-a222-222222222222";
const IR_SOURCE_ID = "44444444-4444-4444-a444-444444444444";
const CLAIM_ID = "55555555-5555-4555-a555-555555555555";

function registry(): IrSourceRegistryRow {
  return Object.freeze({
    ir_source_id: IR_SOURCE_ID,
    issuer_id: ISSUER_ID,
    source_type: "rss",
    url: "https://investors.acme.example/news/rss",
    provider_hint: "issuer_ir",
    document_kind: null,
    enabled: true,
    last_crawled_at: null,
    last_success_at: null,
    last_error: null,
    etag: null,
    last_modified: null,
    crawl_interval_seconds: 86_400,
    created_at: "2026-05-30T00:00:00.000Z",
    updated_at: "2026-05-30T00:00:00.000Z",
  });
}

function recordingDb() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let sourceCounter = 0;
  let documentCounter = 0;
  const assets = new Map<string, Record<string, unknown>>();
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (/from ir_document_assets/i.test(text)) {
        const row = assets.get(`${values?.[0]}:${values?.[1]}`);
        return result(row ? [row] : []);
      }
      if (/insert into sources/i.test(text)) {
        sourceCounter += 1;
        return result([{
          source_id: sourceCounter === 1 ? SOURCE_ID : `11111111-1111-4111-a111-11111111111${sourceCounter}`,
          provider: values?.[0],
          kind: values?.[1],
          canonical_url: values?.[2],
          trust_tier: values?.[3],
          license_class: values?.[4],
          retrieved_at: new Date(String(values?.[5])),
          content_hash: values?.[6] ?? null,
          user_id: values?.[7] ?? null,
          created_at: new Date("2026-05-30T00:00:00.000Z"),
        }]);
      }
      if (/insert into documents/i.test(text)) {
        documentCounter += 1;
        return result([{
          inserted: true,
          document_id: documentCounter === 1 ? DOCUMENT_ID : `22222222-2222-4222-a222-22222222222${documentCounter}`,
          source_id: values?.[0],
          provider_doc_id: values?.[1] ?? null,
          kind: values?.[2],
          parent_document_id: null,
          conversation_id: null,
          title: values?.[5] ?? null,
          author: values?.[6] ?? null,
          published_at: values?.[7] == null ? null : new Date(String(values?.[7])),
          lang: values?.[8] ?? null,
          content_hash: values?.[9],
          raw_blob_id: values?.[10],
          parse_status: "pending",
          deleted_at: null,
          created_at: new Date("2026-05-30T00:00:00.000Z"),
          updated_at: new Date("2026-05-30T00:00:00.000Z"),
        }]);
      }
      if (/insert into ir_document_assets/i.test(text)) {
        const row = {
          ir_document_asset_id: "66666666-6666-4666-a666-666666666666",
          ir_source_id: values?.[0],
          issuer_id: values?.[1],
          document_id: values?.[2],
          source_id: values?.[3],
          asset_kind: values?.[4],
          canonical_url: values?.[5],
          hosted_provider: values?.[6],
          issuer_attested: values?.[7],
          content_type: values?.[8],
          discovered_at: new Date(String(values?.[9])),
          fetched_at: new Date(String(values?.[10])),
          created_at: new Date("2026-05-30T00:00:00.000Z"),
        };
        assets.set(`${values?.[1]}:${values?.[5]}`, row);
        return result([row]);
      }
      if (/insert into mentions/i.test(text)) {
        return result([{
          mention_id: "77777777-7777-4777-a777-777777777777",
          document_id: values?.[0],
          subject_kind: values?.[1],
          subject_id: values?.[2],
          prominence: values?.[3],
          mention_count: values?.[4],
          confidence: values?.[5],
          created_at: new Date("2026-05-30T00:00:00.000Z"),
        }]);
      }
      if (/insert into claims/i.test(text)) {
        return result([{
          claim_id: CLAIM_ID,
          document_id: values?.[0],
          predicate: values?.[1],
          text_canonical: values?.[2],
          polarity: values?.[3],
          modality: values?.[4],
          reported_by_source_id: values?.[5],
          attributed_to_type: values?.[6],
          attributed_to_id: values?.[7],
          effective_time: values?.[8],
          confidence: values?.[9],
          status: values?.[10],
          created_at: new Date("2026-05-30T00:00:00.000Z"),
          updated_at: new Date("2026-05-30T00:00:00.000Z"),
        }]);
      }
      if (/insert into claim_arguments/i.test(text)) {
        return result([{
          claim_argument_id: "88888888-8888-4888-a888-888888888888",
          claim_id: values?.[0],
          subject_kind: values?.[1],
          subject_id: values?.[2],
          role: values?.[3],
          created_at: new Date("2026-05-30T00:00:00.000Z"),
        }]);
      }
      if (/insert into claim_evidence/i.test(text)) {
        return result([{
          claim_evidence_id: "99999999-9999-4999-a999-999999999999",
          claim_id: values?.[0],
          document_id: values?.[1],
          locator: values?.[2],
          excerpt_hash: values?.[3] ?? null,
          confidence: values?.[4],
          created_at: new Date("2026-05-30T00:00:00.000Z"),
        }]);
      }
      if (/insert into events/i.test(text)) {
        return result([{
          event_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          event_type: values?.[0],
          occurred_at: new Date(String(values?.[1])),
          status: values?.[2],
          source_claim_ids: values?.[3],
          source_ids: values?.[4],
          payload_json: values?.[5],
          created_at: new Date("2026-05-30T00:00:00.000Z"),
          updated_at: new Date("2026-05-30T00:00:00.000Z"),
        }]);
      }
      if (/insert into event_subjects/i.test(text)) {
        return result([{
          event_subject_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
          event_id: values?.[0],
          subject_kind: values?.[1],
          subject_id: values?.[2],
          role: values?.[3] ?? null,
          created_at: new Date("2026-05-30T00:00:00.000Z"),
        }]);
      }
      if (/update ir_source_registry/i.test(text)) return result([]);
      if (/from sources/i.test(text)) return result([{ source_id: values?.[0] }]);
      if (/^begin|^commit|^rollback|pg_advisory_xact_lock/i.test(text)) return result([]);
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, queries };
}

function result<R extends Record<string, unknown>>(rows: R[]) {
  return { rows, command: rows.length ? "INSERT" : "SELECT", rowCount: rows.length, oid: 0, fields: [] };
}

test("ingestIssuerIrSource stores issuer releases, links IR asset metadata, and extracts guidance claims", async () => {
  const feed = `<rss><channel><item>
    <title>Acme reports Q1 results and raises guidance</title>
    <link>https://investors.acme.example/news/q1-results</link>
    <pubDate>Fri, 29 May 2026 12:00:00 GMT</pubDate>
  </item></channel></rss>`;
  const body = `Acme reports Q1 results. Revenue increased 18% to $1.2 billion.
    Management raised full-year revenue guidance and expects operating margin to expand.`;
  const { db, queries } = recordingDb();
  const objectStore = new MemoryObjectStore();

  const result = await ingestIssuerIrSource(
    {
      db,
      objectStore,
      fetch: async (url) => new Response(url.endsWith("/rss") ? feed : body, {
        status: 200,
        headers: { "content-type": url.endsWith("/rss") ? "application/rss+xml" : "text/html" },
      }),
      now: () => Date.parse("2026-05-30T01:00:00.000Z"),
    },
    {
      registryEntry: registry(),
      issuerName: "Acme Robotics Holdings",
      subjectRef: { kind: "issuer", id: ISSUER_ID },
    },
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.document.kind, "press_release");
  assert.equal(result.records[0]?.asset.asset_kind, "press_release");
  assert.equal(result.records[0]?.claims.length, 2);
  assert.equal(await objectStore.has(rawBlobIdFromBytes(new TextEncoder().encode(body))), true);
  assert.ok(queries.some((query) => /insert into ir_document_assets/i.test(query.text)));
  assert.ok(queries.some((query) => /insert into claims/i.test(query.text)));
  assert.ok(queries.some((query) => /update ir_source_registry/i.test(query.text) && /last_success_at/i.test(query.text)));
});

test("ingestIssuerIrSource stores presentation PDFs as research_note documents", async () => {
  const feed = `<rss><channel><item>
    <title>Acme investor day presentation</title>
    <link>https://s201.q4cdn.com/123/files/doc_presentations/acme-investor-day.pdf</link>
    <pubDate>Fri, 29 May 2026 13:00:00 GMT</pubDate>
  </item></channel></rss>`;
  const body = "Investor day presentation. Segment cloud revenue increased 25%. Management tone is confident.";
  const { db } = recordingDb();

  const result = await ingestIssuerIrSource(
    {
      db,
      objectStore: new MemoryObjectStore(),
      fetch: async (url) => new Response(url.endsWith("/rss") ? feed : body, {
        status: 200,
        headers: { "content-type": url.endsWith(".pdf") ? "application/pdf" : "application/rss+xml" },
      }),
      now: () => Date.parse("2026-05-30T01:00:00.000Z"),
    },
    {
      registryEntry: registry(),
      issuerName: "Acme Robotics Holdings",
      subjectRef: { kind: "issuer", id: ISSUER_ID },
    },
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.document.kind, "research_note");
  assert.equal(result.records[0]?.asset.asset_kind, "presentation");
  assert.equal(result.records[0]?.source.provider, "issuer_ir");
  assert.equal(result.records[0]?.source.license_class, "public");
});
