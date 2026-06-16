import test from "node:test";
import assert from "node:assert/strict";

import { backfillIssuer8k, type Form8kBackfillClient } from "../src/sec-8k-backfill.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const IN_WINDOW = "0000320193-26-000011"; // 8-K, items 5.02,9.01 — ingest
const STALE = "0000320193-25-000001"; //      8-K, out of window — skip
const TEN_K = "0000320193-26-000002"; //      10-K — wrong form — skip

// The backfill takes item codes from the feed (recent.items), not the header, so
// the fetched body is only stored as the document blob.
const BODY = `<SEC-DOCUMENT>8-K body</SEC-DOCUMENT>`;

function fakeClient(fetchCount: { n: number }): Form8kBackfillClient {
  return {
    fetchSubmissions: async () => ({
      filings: {
        recent: {
          accessionNumber: [IN_WINDOW, TEN_K, STALE],
          form: ["8-K", "10-K", "8-K"],
          primaryDocument: ["aapl-8k.htm", "aapl-10k.htm", "aapl-8k-old.htm"],
          filingDate: ["2026-04-30", "2026-04-01", "2025-01-01"],
          items: ["5.02,9.01", "", "2.02,9.01"],
        },
      },
    }),
    fetchFiling: async () => {
      fetchCount.n += 1;
      return {
        bytes: new TextEncoder().encode(BODY),
        contentType: "text/plain",
        retrievedAt: "2026-04-30T00:00:00.000Z",
        url: `https://www.sec.gov/Archives/edgar/data/320193/x/${IN_WINDOW}.txt`,
      };
    },
  } as unknown as Form8kBackfillClient;
}

test("backfillIssuer8k ingests only in-window 8-K filings (items from the feed), then is idempotent", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form8k-backfill");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const seeded = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193') returning issuer_id::text as issuer_id`,
  );
  const issuerId = seeded.rows[0]!.issuer_id;

  const fetchCount = { n: 0 };
  const deps = { db, objectStore: new MemoryObjectStore(), secClient: fakeClient(fetchCount) };
  const opts = { cik: 320193, sinceDays: 180, now: () => new Date("2026-06-20T00:00:00.000Z") };

  const first = await backfillIssuer8k(deps, opts);
  assert.equal(first.ingested, 1, "only the in-window 8-K is ingested");
  assert.equal(fetchCount.n, 1, "only the eligible filing is fetched (10-K + stale 8-K skipped pre-fetch)");

  const events = await client.query<{ event_type: string }>(
    `select event_type from events where event_type in ('officer_change','material_event') order by event_type`,
  );
  assert.deepEqual(events.rows.map((r) => r.event_type), ["material_event", "officer_change"], "5.02 + 9.01 → two events");

  const claims = await client.query<{ n: number }>(
    `select count(*)::int as n from claims where predicate = 'material_event.officer_change'`,
  );
  assert.equal(claims.rows[0]!.n, 1, "only the claimable 5.02 item becomes a claim");

  // Rerun: the accession now has a live documents row → skipped without refetch.
  const second = await backfillIssuer8k(deps, opts);
  assert.equal(second.ingested, 0);
  assert.equal(second.skipped, 1, "already-stored accession is skipped");
  assert.equal(fetchCount.n, 1, "no refetch on the idempotent rerun");

  const eventCount = await client.query<{ n: number }>(`select count(*)::int as n from events`);
  assert.equal(eventCount.rows[0]!.n, 2, "rerun does not duplicate events");
  void issuerId;
});
