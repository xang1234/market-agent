import test from "node:test";
import assert from "node:assert/strict";

import { backfillIssuerForm4, type Form4BackfillClient } from "../src/sec-form4-backfill.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const ACCESSION = "0000320193-26-000050";

// One material P purchase by the CEO + one non-material grant → 2 read-model
// rows, 1 claim (mirrors the handler test's fixture).
const FIXTURE_TXT = `<SEC-DOCUMENT>
<DOCUMENT><TYPE>4<TEXT><XML>
<ownershipDocument>
  <issuer><issuerCik>0000320193</issuerCik></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0001214156</rptOwnerCik><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle><isTenPercentOwner>0</isTenPercentOwner></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-06-10</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>150.25</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-06-09</value></transactionDate>
      <transactionCoding><transactionCode>A</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>500</value></transactionShares>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>
</XML></TEXT></DOCUMENT></SEC-DOCUMENT>`;

// Submissions feed: one in-window Form 4 (ingested), one in-window 10-K (wrong
// form), one out-of-window Form 4 (too old). Tracks fetchFiling calls so the
// test can prove only the eligible filing is fetched.
function fakeClient(fetchCount: { n: number }): Form4BackfillClient {
  return {
    fetchSubmissions: async () => ({
      filings: {
        recent: {
          accessionNumber: [ACCESSION, "0000320193-26-000040", "0000320193-25-000010"],
          form: ["4", "10-K", "4"],
          primaryDocument: ["xslF345X05/form4.xml", "aapl-20260930.htm", "xslF345X05/old.xml"],
          filingDate: ["2026-06-11", "2026-05-01", "2025-01-01"],
        },
      },
    }),
    fetchFiling: async () => {
      fetchCount.n += 1;
      return {
        bytes: new TextEncoder().encode(FIXTURE_TXT),
        contentType: "text/plain",
        retrievedAt: "2026-06-11T00:00:00.000Z",
        url: `https://www.sec.gov/Archives/edgar/data/320193/000032019326000050/${ACCESSION}.txt`,
      };
    },
  } as unknown as Form4BackfillClient;
}

test("backfillIssuerForm4 ingests only in-window Form 4 filings, then is idempotent", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-backfill");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const seeded = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193') returning issuer_id::text as issuer_id`,
  );
  const issuerId = seeded.rows[0]!.issuer_id;

  const fetchCount = { n: 0 };
  const deps = { db, objectStore: new MemoryObjectStore(), secClient: fakeClient(fetchCount) };
  // now=2026-06-20, sinceDays=180 ⇒ cutoff ≈ 2025-12-22: keeps the 2026-06-11
  // Form 4, drops the 2025-01-01 one; the 10-K is dropped by form.
  const opts = { cik: 320193, sinceDays: 180, now: () => new Date("2026-06-20T00:00:00.000Z") };

  const first = await backfillIssuerForm4(deps, opts);
  assert.equal(first.ingested, 1, "only the in-window Form 4 is ingested");
  assert.equal(first.skipped, 0);
  assert.equal(fetchCount.n, 1, "only the eligible filing is fetched (10-K + stale Form 4 skipped pre-fetch)");

  const txns = await client.query(`select count(*)::int as n from insider_transactions where issuer_id = $1`, [issuerId]);
  assert.equal(txns.rows[0]!.n, 2, "both transactions from the filing are recorded");

  // Rerun: the accession now has a live documents row → skipped without refetch.
  const second = await backfillIssuerForm4(deps, opts);
  assert.equal(second.ingested, 0);
  assert.equal(second.skipped, 1, "already-stored accession is skipped");
  assert.equal(fetchCount.n, 1, "no refetch on the idempotent rerun");

  const after = await client.query(`select count(*)::int as n from insider_transactions where issuer_id = $1`, [issuerId]);
  assert.equal(after.rows[0]!.n, 2, "rerun does not duplicate read-model rows");
});

// A single-P Form 4/4-A on 2026-06-10 (period_of_report falls back to that date),
// for the backfill-ordering scenario.
function form4(form: string, pShares: number): string {
  return `<SEC-DOCUMENT>
<DOCUMENT><TYPE>${form}<TEXT><XML>
<ownershipDocument>
  <issuer><issuerCik>0000320193</issuerCik></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0001214156</rptOwnerCik><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>CEO</officerTitle><isTenPercentOwner>0</isTenPercentOwner></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable><nonDerivativeTransaction>
    <transactionDate><value>2026-06-10</value></transactionDate>
    <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
    <transactionAmounts>
      <transactionShares><value>${pShares}</value></transactionShares>
      <transactionPricePerShare><value>150.25</value></transactionPricePerShare>
      <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
    </transactionAmounts>
  </nonDerivativeTransaction></nonDerivativeTable>
</ownershipDocument>
</XML></TEXT></DOCUMENT></SEC-DOCUMENT>`;
}

test("backfillIssuerForm4 processes a 4/A after its original so the amendment supersedes (no double-count)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-backfill-amend-order");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const issuerId = (
    await client.query<{ issuer_id: string }>(
      `insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193') returning issuer_id::text as issuer_id`,
    )
  ).rows[0]!.issuer_id;

  const ORIG = "0000320193-26-000070";
  const AMEND = "0000320193-26-000071";
  const secClient = {
    // EDGAR returns `recent` newest-first: the 4/A (filed later) precedes its original.
    fetchSubmissions: async () => ({
      filings: {
        recent: {
          accessionNumber: [AMEND, ORIG],
          form: ["4/A", "4"],
          primaryDocument: ["xslF345X05/amend.xml", "xslF345X05/form4.xml"],
          filingDate: ["2026-06-12", "2026-06-10"],
        },
      },
    }),
    fetchFiling: async (input: { accession_number: string }) => ({
      bytes: new TextEncoder().encode(input.accession_number === AMEND ? form4("4/A", 800) : form4("4", 1000)),
      contentType: "text/plain",
      retrievedAt: "2026-06-12T00:00:00.000Z",
      url: `https://www.sec.gov/x/${input.accession_number}.txt`,
    }),
  } as unknown as Form4BackfillClient;

  const result = await backfillIssuerForm4(
    { db, objectStore: new MemoryObjectStore(), secClient },
    { cik: 320193, sinceDays: 180, now: () => new Date("2026-06-20T00:00:00.000Z") },
  );
  assert.equal(result.ingested, 2, "both the original and the amendment are ingested");

  const r = await client.query<{ n: number; p: string | null }>(
    `select count(*)::int as n, sum(case when transaction_code = 'P' then shares else 0 end) as p
       from insider_transactions where issuer_id = $1`,
    [issuerId],
  );
  assert.equal(r.rows[0]!.n, 1, "processed oldest-first, so the 4/A supersedes the original — 1 row, not 2");
  assert.equal(Number(r.rows[0]!.p), 800, "the amendment's corrected share count wins");
});
