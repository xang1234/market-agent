import assert from "node:assert/strict";
import test from "node:test";

import { createCampaignDocumentService, createIssuerIrPrimaryDocumentCandidateFinder, createPinnedIssuerIrPrimaryDocumentCandidateFinder, createPostgresCampaignDocumentRepository, createSecPrimaryDocumentCandidateFinder } from "../src/campaign-documents.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { QueryExecutor } from "../src/types.ts";
import { fakeOperations } from "../../discovery/test/fake-operations.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const USER = "11111111-1111-4111-a111-111111111111";
const ISSUER = "22222222-2222-4222-a222-222222222222";
const DOCUMENT_SOURCE = "33333333-3333-4333-a333-333333333333";
const REPORTING_SOURCE = "44444444-4444-4444-a444-444444444444";
const DOCUMENT = "55555555-5555-4555-a555-555555555555";
const IR_SOURCE = "99999999-9999-4999-a999-999999999999";

test("campaign documents preserve a document source separately from its reporting claim source", async () => {
  const documents = createCampaignDocumentService({
    user_id: USER,
    repository: {
      load: async () => [{
        document_id: DOCUMENT, source_id: DOCUMENT_SOURCE, owner_user_id: null, family_key: "sec:10-k", title: "10-K",
        url: "https://www.sec.gov/Archives/example", published_at: "2026-02-20T00:00:00.000Z",
        retrieved_at: "2026-02-21T00:00:00.000Z", document_hash: "sha256:document", normalized_text: "Grid demand increased.",
        primary: true, primary_eligible: true,
        claims: [{ claim_id: "66666666-6666-4666-a666-666666666666", reporting_source_id: REPORTING_SOURCE, text_canonical: "Grid demand increased." }],
      }],
      store: async () => { throw new Error("unexpected"); },
    },
  });

  const loaded = await documents.load({ issuer_id: ISSUER, limit: 6 });

  assert.equal(loaded.documents[0]?.source_id, DOCUMENT_SOURCE);
  assert.equal(loaded.documents[0]?.claims[0]?.source_id, REPORTING_SOURCE);
  assert.doesNotMatch(JSON.stringify(loaded), /raw_blob_id|bytes/i);
});

test("campaign documents refuse a repository row owned by another user", async () => {
  const documents = createCampaignDocumentService({
    user_id: USER,
    repository: {
      load: async () => [{
        document_id: DOCUMENT, source_id: DOCUMENT_SOURCE, owner_user_id: "77777777-7777-4777-a777-777777777777", family_key: "sec:10-k", title: "10-K",
        url: "https://www.sec.gov/Archives/example", published_at: null, retrieved_at: "2026-02-21T00:00:00.000Z",
        document_hash: "sha256:document", normalized_text: "Private document.", primary: true, primary_eligible: true, claims: [],
      }],
      store: async () => { throw new Error("unexpected"); },
    },
  });

  await assert.rejects(documents.load({ issuer_id: ISSUER, limit: 6 }), /not visible/i);
});

test("campaign documents meter each verified external fetch before source registration", async () => {
  const stored: string[] = [];
  const documents = createCampaignDocumentService({
    user_id: USER,
    repository: {
      load: async () => [],
      store: async (input) => {
        stored.push(input.url);
        return {
          document_id: DOCUMENT, source_id: DOCUMENT_SOURCE, family_key: "issuer:release", title: input.title, url: input.url,
          published_at: input.published_at, retrieved_at: input.retrieved_at, document_hash: "sha256:document",
          normalized_text: "Issuer release", primary: true, primary_eligible: true, claims: [],
        };
      },
    },
    fetcher: {
      fetch: async () => ({ url: "https://issuer.example/release", content_type: "text/html", bytes: new TextEncoder().encode("Issuer release") }),
    },
  });
  const fake = fakeOperations();

  await documents.fetchAndStore({
    issuer_id: ISSUER, url: "https://issuer.example/release", title: "Issuer release", published_at: null,
    provider: "issuer_ir", kind: "press_release", ir_source_id: IR_SOURCE, operation_key: "run/research/candidate/document/0",
    request_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", phase: "research",
    candidate_id: "88888888-8888-4888-a888-888888888888",
  }, fake.operations);

  assert.deepEqual(stored, ["https://issuer.example/release"]);
  assert.equal(fake.ledger.size, 1);
});

test("a verified issuer IR document remains primary eligible after durable PostgreSQL store and service reload", { skip: !dockerAvailable(), timeout: 120_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "campaign-documents-ir-attestation");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await db.query("insert into issuers (issuer_id, legal_name) values ($1::uuid, 'Acme Inc')", [ISSUER]);
  await db.query(
    `insert into ir_source_registry (ir_source_id, issuer_id, source_type, url, enabled)
     values ($1::uuid, $2::uuid, 'rss', 'https://investors.acme.example/rss', true)`,
    [IR_SOURCE, ISSUER],
  );
  const repository = createPostgresCampaignDocumentRepository({ db, object_store: new MemoryObjectStore() });

  await repository.store({
    issuer_id: ISSUER,
    url: "https://investors.acme.example/news/results",
    title: "Acme reports results",
    published_at: "2026-09-01T00:00:00.000Z",
    retrieved_at: "2026-09-02T00:00:00.000Z",
    provider: "issuer_ir",
    kind: "press_release",
    ir_source_id: IR_SOURCE,
    bytes: new TextEncoder().encode("Acme reports results. Grid demand increased."),
    content_type: "text/html",
  });

  const reloaded = createCampaignDocumentService({ user_id: USER, repository });
  const loaded = await reloaded.load({ issuer_id: ISSUER });

  assert.equal(loaded.documents.length, 1);
  assert.equal(loaded.documents[0]?.primary_eligible, true);
  const persisted = await db.query<{ ir_source_id: string; issuer_attested: boolean }>(
    "select ir_source_id::text as ir_source_id, issuer_attested from ir_document_assets where document_id = $1::uuid",
    [loaded.documents[0]?.document_id],
  );
  assert.deepEqual(persisted.rows, [{ ir_source_id: IR_SOURCE, issuer_attested: true }]);
});

test("SEC candidate finder meters submissions metadata before selecting current primary filing URLs", async () => {
  const finder = createSecPrimaryDocumentCandidateFinder({
    db: {
      query: async <R extends Record<string, unknown>>() => ({ rows: [{ cik: "0000320193" } as unknown as R] }),
    },
    sec: {
      fetchSubmissions: async () => ({
        filings: { recent: {
          accessionNumber: ["0000320193-26-000001", "0000320193-26-000002"], form: ["10-K", "8-K"],
          primaryDocument: ["annual.html", "current.html"], filingDate: ["2026-02-01", "2026-03-01"],
        } },
      }),
    },
  });
  const fake = fakeOperations();

  const candidates = await finder.find({
    issuer_id: ISSUER, operation_key: "run/research/candidate/evidence", request_hash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    candidate_id: "88888888-8888-4888-a888-888888888888", phase: "research",
  }, fake.operations);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.provider, "sec_edgar");
  assert.match(candidates[0]?.url ?? "", /^https:\/\/www\.sec\.gov\/Archives\//);
  assert.equal(fake.ledger.size, 1);
});

test("issuer IR candidate finder accepts only an existing verified registry entry and meters its index fetch", async () => {
  const finder = createIssuerIrPrimaryDocumentCandidateFinder({
    list: async () => [{
      ir_source_id: "99999999-9999-4999-a999-999999999999", issuer_id: ISSUER, source_type: "rss", url: "https://investors.acme.example/rss",
      provider_hint: "issuer_ir", document_kind: null, enabled: true, last_crawled_at: null, last_success_at: null, last_error: null,
      etag: null, last_modified: null, crawl_interval_seconds: 86_400, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    }],
    fetch: async () => new Response("<rss><channel><item><title>Acme reports results</title><link>https://investors.acme.example/news/results</link><pubDate>2026-09-01</pubDate></item></channel></rss>", {
      headers: { "content-type": "application/rss+xml" },
    }),
  });
  const fake = fakeOperations();

  const candidates = await finder.find({
    issuer_id: ISSUER, operation_key: "run/research/candidate/evidence", request_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    candidate_id: "88888888-8888-4888-a888-888888888888", phase: "research",
  }, fake.operations);

  assert.deepEqual(candidates.map((candidate) => candidate.url), ["https://investors.acme.example/news/results"]);
  assert.equal(fake.ledger.size, 1);
});

test("issuer IR candidate discovery does not scan more empty indexes than remaining document capacity", async () => {
  const fetched: string[] = [];
  const finder = createIssuerIrPrimaryDocumentCandidateFinder({
    list: async () => [0, 1, 2].map((index) => irRegistryEntry(index)),
    fetch: async (url) => {
      fetched.push(String(url));
      return new Response("<rss><channel></channel></rss>", { headers: { "content-type": "application/rss+xml" } });
    },
  });
  const fake = fakeOperations();

  const candidates = await finder.find({
    issuer_id: ISSUER, operation_key: "run/research/candidate/evidence", request_hash: "sha256:abababababababababababababababababababababababababababababababab",
    candidate_id: "88888888-8888-4888-a888-888888888888", phase: "research", remaining_capacity: 2,
  }, fake.operations);

  assert.deepEqual(candidates, []);
  assert.deepEqual(fetched, ["https://investors.acme.example/rss/0", "https://investors.acme.example/rss/1"]);
  assert.equal(fake.ledger.size, 2);
});

test("pinned issuer IR finder composes the verified registry with a DNS-pinned index transport", async () => {
  const requests: string[] = [];
  const finder = createPinnedIssuerIrPrimaryDocumentCandidateFinder({
    db: {
      query: async () => ({ rows: [{
        ir_source_id: "99999999-9999-4999-a999-999999999999", issuer_id: ISSUER, source_type: "rss", url: "https://investors.acme.example/rss",
        provider_hint: "issuer_ir", document_kind: null, enabled: true, last_crawled_at: null, last_success_at: null, last_error: null,
        etag: null, last_modified: null, crawl_interval_seconds: 86_400, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
      }] }),
    } as unknown as QueryExecutor,
    dns: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
    transport: { request: async (request) => {
      requests.push(request.hostname);
      return { status: 200, headers: { "content-type": "application/rss+xml" }, body: new TextEncoder().encode("<rss><channel><item><title>Acme reports results</title><link>https://investors.acme.example/news/results</link><pubDate>2026-09-01</pubDate></item></channel></rss>") };
    } },
  });
  const fake = fakeOperations();

  const candidates = await finder.find({
    issuer_id: ISSUER, operation_key: "run/research/candidate/evidence", request_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    candidate_id: "88888888-8888-4888-a888-888888888888", phase: "research",
  }, fake.operations);

  assert.deepEqual(candidates.map((candidate) => candidate.url), ["https://investors.acme.example/news/results"]);
  assert.deepEqual(requests, ["93.184.216.34"]);
  assert.equal(fake.ledger.size, 1);
});

function irRegistryEntry(index: number) {
  return {
    ir_source_id: `99999999-9999-4999-a999-99999999999${index}`,
    issuer_id: ISSUER,
    source_type: "rss" as const,
    url: `https://investors.acme.example/rss/${index}`,
    provider_hint: "issuer_ir",
    document_kind: null,
    enabled: true,
    last_crawled_at: null,
    last_success_at: null,
    last_error: null,
    etag: null,
    last_modified: null,
    crawl_interval_seconds: 86_400,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}
