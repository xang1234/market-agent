import test from "node:test";
import assert from "node:assert/strict";

import { runRepair8kDrain, type Repair8kDeps } from "../src/sec-8k-repair.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const ACCESSION = "0000320193-26-000011";

// A full-submission .txt header with two items: 5.02 (officer change → claim) and
// 9.01 (exhibits → event only), plus the canonical FILED AS OF DATE.
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

function fakeClient(txt: string = FIXTURE_TXT): Repair8kDeps["secClient"] {
  return {
    fetchFiling: async (input: { accession_number: string }) => ({
      bytes: new TextEncoder().encode(txt),
      contentType: "text/plain",
      retrievedAt: "2026-06-20T00:00:00.000Z",
      url: `https://www.sec.gov/Archives/edgar/data/320193/x/${input.accession_number}.txt`,
    }),
  } as unknown as Repair8kDeps["secClient"];
}

// Seed a LEGACY 8-K document as the old generic backfill left it: a sec_edgar filing
// source + a document (kind filing, title "8-K", provider_doc_id = accession) with NO
// events/claims. Returns the document + source ids.
async function seedLegacy8k(
  client: { query: QueryExecutor["query"] },
  accession: string,
): Promise<{ documentId: string; sourceId: string }> {
  const src = await client.query<{ id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
     values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text as id`,
  );
  const sourceId = src.rows[0]!.id;
  const doc = await client.query<{ id: string }>(
    `insert into documents (source_id, provider_doc_id, kind, title, content_hash, raw_blob_id, parse_status)
     values ($1, $2, 'filing', '8-K', $3, $4, 'parsed') returning document_id::text as id`,
    [sourceId, accession, `h-${accession}`, `sha256:${accession}`],
  );
  return { documentId: doc.rows[0]!.id, sourceId };
}

test("runRepair8kDrain attaches typed events/claims to the existing legacy 8-K doc, reusing its source", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "8k-repair");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await client.query(`insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193')`);
  const { documentId, sourceId } = await seedLegacy8k(client, ACCESSION);
  assert.equal((await client.query(`select count(*)::int as n from events`)).rows[0]!.n, 0, "no typed artifacts yet");

  const result = await runRepair8kDrain({ db, secClient: fakeClient() });
  assert.deepEqual(result, { repaired: 1, untracked: 0, no_items: 0, no_date: 0, failed: 0 });

  // The existing document is reused — not duplicated — and no second source is minted.
  assert.equal((await client.query(`select count(*)::int as n from documents`)).rows[0]!.n, 1, "existing document reused");
  assert.equal((await client.query(`select count(*)::int as n from sources`)).rows[0]!.n, 1, "no duplicate source minted");

  // One event per item; both reference the EXISTING legacy source.
  const events = await client.query<{ event_type: string }>(`select event_type from events order by event_type`);
  assert.deepEqual(events.rows.map((r) => r.event_type), ["material_event", "officer_change"], "an event per item");
  const linked = await client.query<{ n: number }>(
    `select count(*)::int as n from events where source_ids @> to_jsonb($1::text)`,
    [sourceId],
  );
  assert.equal(linked.rows[0]!.n, 2, "both events reference the existing legacy source");

  // Only the claimable item becomes a claim, attached to the EXISTING document + source.
  const claims = await client.query<{ predicate: string; document_id: string; reported_by_source_id: string }>(
    `select predicate, document_id::text as document_id, reported_by_source_id::text as reported_by_source_id from claims`,
  );
  assert.equal(claims.rows.length, 1);
  assert.equal(claims.rows[0]!.predicate, "material_event.officer_change");
  assert.equal(claims.rows[0]!.document_id, documentId, "claim attached to the existing document");
  assert.equal(claims.rows[0]!.reported_by_source_id, sourceId, "claim reuses the existing source");

  // occurred_at comes from FILED AS OF DATE, not the (now) fetch time.
  const occurred = await client.query<{ d: string }>(`select to_char(min(occurred_at), 'YYYY-MM-DD') as d from events`);
  assert.equal(occurred.rows[0]!.d, "2026-04-30");

  // Idempotent: the repaired doc now has events for its source → no longer a candidate.
  const second = await runRepair8kDrain({ db, secClient: fakeClient() });
  assert.deepEqual(second, { repaired: 0, untracked: 0, no_items: 0, no_date: 0, failed: 0 }, "re-run is a no-op");
  assert.equal((await client.query(`select count(*)::int as n from events`)).rows[0]!.n, 2, "no duplicate events on re-run");
});

test("runRepair8kDrain skips a legacy 8-K whose filer CIK is not tracked", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "8k-repair-untracked");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await seedLegacy8k(client, ACCESSION); // no issuers row for this CIK

  const result = await runRepair8kDrain({ db, secClient: fakeClient() });
  assert.equal(result.untracked, 1);
  assert.equal(result.repaired, 0);
  assert.equal((await client.query(`select count(*)::int as n from events`)).rows[0]!.n, 0, "nothing attached for an untracked filer");
});

test("runRepair8kDrain skips a filing whose header has no ITEM INFORMATION (no events written)", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "8k-repair-noitems");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await client.query(`insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193')`);
  await seedLegacy8k(client, ACCESSION);

  const noItems = `<SEC-DOCUMENT>${ACCESSION}.txt : 20260430
<SEC-HEADER>CONFORMED SUBMISSION TYPE:	8-K
FILED AS OF DATE:		20260430
</SEC-HEADER></SEC-DOCUMENT>`;
  const result = await runRepair8kDrain({ db, secClient: fakeClient(noItems) });
  assert.equal(result.no_items, 1);
  assert.equal((await client.query(`select count(*)::int as n from events`)).rows[0]!.n, 0, "no events for a header without items");
});
