import test from "node:test";
import assert from "node:assert/strict";

import { handle8k } from "../src/sec-8k-handler.ts";
import { MemoryObjectStore, rawBlobIdFromBytes } from "../src/object-store.ts";
import type { FilingIndexEntry } from "../src/sec-daily-index.ts";
import type { FormHandlerDeps } from "../src/sec-daily-crawl.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { cikMovesAfterRead } from "./cik-moves-after-read.ts";

const ACCESSION = "0000320193-26-000011";

// A full-submission .txt with two items in the header: 5.02 (officer change,
// material → claim) and 9.01 (exhibits, event-only → no claim).
const FIXTURE_TXT = `<SEC-DOCUMENT>${ACCESSION}.txt : 20260430
<SEC-HEADER>${ACCESSION}.hdr.sgml : 20260430
ACCESSION NUMBER:		${ACCESSION}
CONFORMED SUBMISSION TYPE:	8-K
ITEM INFORMATION:		Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers
ITEM INFORMATION:		Financial Statements and Exhibits
FILED AS OF DATE:		20260430
</SEC-HEADER>
<DOCUMENT><TYPE>8-K<TEXT>Body of the 8-K.</TEXT></DOCUMENT>
</SEC-DOCUMENT>`;

function fakeClient(txt: string = FIXTURE_TXT) {
  return {
    fetchFiling: async () => ({
      bytes: new TextEncoder().encode(txt),
      contentType: "text/plain",
      retrievedAt: "2026-04-30T00:00:00.000Z",
      url: `https://www.sec.gov/Archives/edgar/data/320193/000032019326000011/${ACCESSION}.txt`,
    }),
  };
}

function entry(): FilingIndexEntry {
  return {
    cik: 320193,
    company: "Apple Inc.",
    form: "8-K",
    filedDate: "2026-04-30",
    fileName: `edgar/data/320193/${ACCESSION}.txt`,
    accession: ACCESSION,
  };
}

test("handle8k records one event per item + a material claim only for claimable items (atomic)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form8k-handler");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const seeded = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193') returning issuer_id::text as issuer_id`,
  );
  const issuerId = seeded.rows[0]!.issuer_id;

  const deps = { db, objectStore: new MemoryObjectStore(), client: fakeClient() } as unknown as FormHandlerDeps;
  const result = await handle8k(entry(), deps);
  assert.equal(result.ingested, true);

  const docs = await client.query(`select count(*)::int as n from documents`);
  assert.equal(docs.rows[0]!.n, 1, "one document for the filing");

  const mentions = await client.query<{ subject_id: string }>(
    `select subject_id::text as subject_id from mentions where subject_kind = 'issuer'`,
  );
  assert.equal(mentions.rows.length, 1, "issuer mention recorded (reader doc-selection)");
  assert.equal(mentions.rows[0]!.subject_id, issuerId);

  const events = await client.query<{ event_type: string }>(
    `select event_type from events order by event_type`,
  );
  assert.deepEqual(events.rows.map((r) => r.event_type), ["material_event", "officer_change"], "an event per item");

  const claims = await client.query<{ predicate: string }>(`select predicate from claims`);
  assert.equal(claims.rows.length, 1, "only the claimable 5.02 item becomes a claim");
  assert.equal(claims.rows[0]!.predicate, "material_event.officer_change");

  const args = await client.query<{ subject_kind: string; subject_id: string }>(
    `select subject_kind, subject_id::text as subject_id from claim_arguments`,
  );
  assert.equal(args.rows.length, 1);
  assert.equal(args.rows[0]!.subject_kind, "issuer");
  assert.equal(args.rows[0]!.subject_id, issuerId);
});

test("handle8k stores nothing when the filer's CIK moves to another issuer after it is read (#685)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form8k-cik-moved");
  const client = await connectedClient(t, databaseUrl);
  const [from, to] = (await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, cik) values ('Apple ETN', '0000320193'), ('Apple Inc.', null) returning issuer_id::text as issuer_id`,
  )).rows.map((row) => row.issuer_id);
  const db = cikMovesAfterRead(client as unknown as QueryExecutor, { cik: "0000320193", from: from!, to: to! });
  const result = await handle8k(entry(), { db, objectStore: new MemoryObjectStore(), client: fakeClient() } as unknown as FormHandlerDeps);
  assert.equal(result.ingested, false);
  const docs = await client.query(`select count(*)::int as n from documents`);
  assert.equal(docs.rows[0]!.n, 0, "nothing written for the issuer that lost the CIK");
});

test("handle8k skips an untracked filer CIK without writing", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form8k-untracked");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const result = await handle8k(entry(), { db, objectStore: new MemoryObjectStore(), client: fakeClient() } as unknown as FormHandlerDeps);
  assert.equal(result.ingested, false);
  const docs = await client.query(`select count(*)::int as n from documents`);
  assert.equal(docs.rows[0]!.n, 0, "nothing written for an untracked issuer");
});

test("handle8k skips a header with no ITEM INFORMATION without persisting a document", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form8k-noitems");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await client.query(`insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193')`);
  const noItems = `<SEC-DOCUMENT>${ACCESSION}.txt : 20260430
<SEC-HEADER>${ACCESSION}.hdr.sgml : 20260430
CONFORMED SUBMISSION TYPE:	8-K
</SEC-HEADER></SEC-DOCUMENT>`;
  const result = await handle8k(entry(), { db, objectStore: new MemoryObjectStore(), client: fakeClient(noItems) } as unknown as FormHandlerDeps);
  assert.equal(result.ingested, false);
  const docs = await client.query(`select count(*)::int as n from documents`);
  assert.equal(docs.rows[0]!.n, 0, "no orphan document — the filing can be reprocessed later");
});

test("handle8k stores the submission without its uuencoded bodies, under SEC's content hash (#757)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form8k-strip");
  const client = await connectedClient(t, databaseUrl);
  await client.query(`insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193')`);
  const withGraphic = FIXTURE_TXT.replace(
    "</SEC-DOCUMENT>",
    "<DOCUMENT>\n<TYPE>GRAPHIC\n<SEQUENCE>2\n<FILENAME>logo.jpg\n<TEXT>\nbegin 644 logo.jpg\nM_]C_X  02D9)1@\n`\nend\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>",
  );
  const stripped = withGraphic.replace("begin 644 logo.jpg\nM_]C_X  02D9)1@\n`\nend\n", "");
  const objectStore = new MemoryObjectStore();
  const deps = { db: client as unknown as QueryExecutor, objectStore, client: fakeClient(withGraphic) } as unknown as FormHandlerDeps;
  assert.equal((await handle8k(entry(), deps)).ingested, true);

  const { rows: [document] } = await client.query<{ content_hash: string; raw_blob_id: string; raw_blob_transform: string | null }>(
    `select content_hash, raw_blob_id, raw_blob_transform from documents`,
  );
  assert.deepEqual(document, {
    content_hash: rawBlobIdFromBytes(new TextEncoder().encode(withGraphic)),
    raw_blob_id: rawBlobIdFromBytes(new TextEncoder().encode(stripped)),
    raw_blob_transform: "sec_uuencoded_bodies_removed.v1",
  });
  assert.equal(new TextDecoder().decode((await objectStore.get(document!.raw_blob_id))!.bytes), stripped);
  assert.equal(await objectStore.has(document!.content_hash), false, "SEC's bytes are not stored");

  // A submission with nothing to strip is stored as SEC sent it.
  await client.query(`delete from documents`);
  assert.equal((await handle8k(entry(), { ...deps, client: fakeClient() } as unknown as FormHandlerDeps)).ingested, true);
  const { rows: [verbatim] } = await client.query(`select content_hash = raw_blob_id as same, raw_blob_transform from documents`);
  assert.deepEqual(verbatim, { same: true, raw_blob_transform: null });
});
