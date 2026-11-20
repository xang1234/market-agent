import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

import { backfillIssuerFilings } from "../src/sec-filings-backfill.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { FetchFilingInput, FetchFilingResult } from "../src/sec-edgar.ts";
import type { QueryExecutor } from "../src/types.ts";
import { moveCik } from "./cik-moves-after-read.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

const ISSUER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CIK = 2488;
const NOW = () => new Date("2026-06-12T00:00:00.000Z");

// Column-oriented arrays, newest first — the shape data.sec.gov/submissions returns.
const SUBMISSIONS = {
  filings: {
    recent: {
      accessionNumber: [
        "0000002488-26-000010", // 10-Q, recent — ingest
        "0000002488-26-000008", // 6-K, recent — ingest
        "0000002488-26-000005", // S-8, recent but unsupported form — skip
        "0000002488-25-000001", // 10-K, outside the window — skip
      ],
      // 8-K is intentionally absent: it has a dedicated event handler (handle8k)
      // and is no longer a generic-backfill default. 6-K stands in as the second
      // recent narrative-evidence form here.
      form: ["10-Q", "6-K", "S-8", "10-K"],
      primaryDocument: ["amd-10q.htm", "amd-6k.htm", "amd-s8.htm", "amd-10k.htm"],
      filingDate: ["2026-05-01", "2026-04-15", "2026-04-01", "2025-08-01"],
    },
  },
};

function fakeClient(fetched: FetchFilingInput[]) {
  return {
    fetchSubmissions: async (cik: number) => {
      assert.equal(cik, CIK);
      return SUBMISSIONS;
    },
    fetchFiling: async (input: FetchFilingInput): Promise<FetchFilingResult> => {
      fetched.push(input);
      return {
        bytes: new TextEncoder().encode(`<html>${input.document}</html>`),
        contentType: "text/html",
        retrievedAt: "2026-06-12T00:00:00.000Z",
        url: `https://www.sec.gov/Archives/edgar/data/${input.cik}/${input.document}`,
      };
    },
  };
}

test(
  "backfillIssuerFilings ingests recent supported filings with issuer mentions, idempotently",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "sec-filings-backfill");
    const db = await connectedClient(t, databaseUrl);
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Advanced Micro Devices', $2)`, [
      ISSUER_ID,
      String(CIK),
    ]);
    const objectStore = new MemoryObjectStore();
    const fetched: FetchFilingInput[] = [];

    const result = await backfillIssuerFilings(
      { db, objectStore, secClient: fakeClient(fetched) },
      { issuerId: ISSUER_ID, cik: CIK, sinceDays: 180, maxFilings: 5, now: NOW },
    );

    assert.equal(result.ingested.length, 2, "the recent 10-Q and 6-K");
    assert.deepEqual(
      result.ingested.map((f) => f.form),
      ["10-Q", "6-K"],
    );
    assert.equal(result.skipped, 0, "nothing pre-existing on first run");
    assert.deepEqual(
      fetched.map((f) => f.document),
      ["amd-10q.htm", "amd-6k.htm"],
      "unsupported forms and out-of-window filings are never fetched",
    );

    // Documents landed with stored blobs, filing kind, accession as provider id.
    const docs = await db.query<{ provider_doc_id: string; kind: string; title: string; raw_blob_id: string }>(
      `select provider_doc_id, kind, title, raw_blob_id from documents order by provider_doc_id desc`,
    );
    assert.deepEqual(
      docs.rows.map((d) => ({ provider_doc_id: d.provider_doc_id, kind: d.kind, title: d.title })),
      [
        { provider_doc_id: "0000002488-26-000010", kind: "filing", title: "10-Q" },
        { provider_doc_id: "0000002488-26-000008", kind: "filing", title: "6-K" },
      ],
    );
    for (const d of docs.rows) {
      assert.match(d.raw_blob_id, /^sha256:/, "blob must be stored, not ephemeral");
    }

    // Each document mentions the issuer — the reader's selection path.
    const mentions = await db.query<{ subject_id: string; prominence: string }>(
      `select subject_id::text as subject_id, prominence from mentions`,
    );
    assert.equal(mentions.rows.length, 2);
    for (const m of mentions.rows) {
      assert.equal(m.subject_id, ISSUER_ID);
      assert.equal(m.prominence, "headline");
    }

    // Second run: both filings already ingested -> skipped, nothing fetched.
    const fetchedAgain: FetchFilingInput[] = [];
    const rerun = await backfillIssuerFilings(
      { db, objectStore, secClient: fakeClient(fetchedAgain) },
      { issuerId: ISSUER_ID, cik: CIK, sinceDays: 180, maxFilings: 5, now: NOW },
    );
    assert.equal(rerun.ingested.length, 0);
    assert.equal(rerun.skipped, 2);
    assert.deepEqual(fetchedAgain, [], "idempotent re-run must not refetch");
  },
);

const HOLDER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MOVE = { cik: String(CIK), from: ISSUER_ID, to: HOLDER_ID };

async function issuerAndHolder(t: TestContext) {
  const { databaseUrl } = await bootstrapDatabase(t, "sec-filings-backfill-cik-moved");
  const db = await connectedClient(t, databaseUrl);
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Advanced Micro Devices', $2), ($3, 'AMD Holdings', null)`, [
    ISSUER_ID,
    String(CIK),
    HOLDER_ID,
  ]);
  return db;
}

const storedRows = async (db: QueryExecutor) => (await db.query<{ sources: number; documents: number; mentions: number }>(
  `select (select count(*)::int from sources) as sources,
          (select count(*)::int from documents) as documents,
          (select count(*)::int from mentions) as mentions`,
)).rows[0];

test("a backfill whose issuer loses the CIK mid-download stores nothing", { skip: !dockerAvailable() }, async (t) => {
  const db = await issuerAndHolder(t);
  const client = fakeClient([]);
  const result = await backfillIssuerFilings(
    {
      db,
      objectStore: new MemoryObjectStore(),
      secClient: {
        ...client,
        fetchFiling: async (input) => {
          await moveCik(db, MOVE);
          return client.fetchFiling(input);
        },
      },
    },
    { issuerId: ISSUER_ID, cik: CIK, now: NOW },
  );
  assert.deepEqual(result.ingested, []);
  assert.deepEqual(await storedRows(db), { sources: 0, documents: 0, mentions: 0 });
});

test("a backfill whose issuer loses the CIK mentions it on no filing already stored", { skip: !dockerAvailable() }, async (t) => {
  const db = await issuerAndHolder(t);
  const { rows: [source] } = await db.query<{ id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text as id`,
  );
  await db.query(
    `insert into documents (source_id, kind, provider_doc_id, title, content_hash, raw_blob_id) values ($1, 'filing', '0000002488-26-000010', '10-Q', 'sha256:a', 'sha256:a')`,
    [source!.id],
  );
  const client = fakeClient([]);
  await backfillIssuerFilings(
    {
      db,
      objectStore: new MemoryObjectStore(),
      secClient: {
        ...client,
        fetchSubmissions: async (cik) => {
          await moveCik(db, MOVE);
          return client.fetchSubmissions(cik);
        },
      },
    },
    { issuerId: ISSUER_ID, cik: CIK, now: NOW },
  );
  assert.equal((await storedRows(db))!.mentions, 0);
});
