import test from "node:test";
import assert from "node:assert/strict";

import { handleForm4 } from "../src/sec-form4-handler.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { FilingIndexEntry } from "../src/sec-daily-index.ts";
import type { FormHandlerDeps } from "../src/sec-daily-crawl.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const ACCESSION = "0000320193-26-000050";

// A Form 4 with two non-derivative transactions:
//  1) P (open-market purchase) by the CEO, 1000 @ $150.25 = $150,250 → MATERIAL → claim
//  2) A (grant), 500 shares, no price → recorded but not material → no claim
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

function fakeClient() {
  return {
    fetchFiling: async () => ({
      bytes: new TextEncoder().encode(FIXTURE_TXT),
      contentType: "text/plain",
      retrievedAt: "2026-06-11T00:00:00.000Z",
      url: `https://www.sec.gov/Archives/edgar/data/320193/000032019326000050/${ACCESSION}.txt`,
    }),
  };
}

function entry(): FilingIndexEntry {
  return {
    cik: 320193,
    company: "Apple Inc.",
    form: "4",
    filedDate: "2026-06-11",
    fileName: `edgar/data/320193/${ACCESSION}.txt`,
    accession: ACCESSION,
  };
}

test("handleForm4 records all transactions + material-only claims (atomic)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-handler");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const seeded = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193') returning issuer_id::text as issuer_id`,
  );
  const issuerId = seeded.rows[0]!.issuer_id;

  const deps = { db, objectStore: new MemoryObjectStore(), client: fakeClient() } as unknown as FormHandlerDeps;
  const result = await handleForm4(entry(), deps);
  assert.equal(result.ingested, true);

  const txns = await client.query(`select count(*)::int as n from insider_transactions where issuer_id = $1`, [issuerId]);
  assert.equal(txns.rows[0]!.n, 2, "both transactions recorded in the read model");

  // period_of_report is persisted (FIXTURE_TXT has no <periodOfReport> → earliest txn
  // 2026-06-09), so a later 4/A can match this filing.
  const periods = await client.query<{ period_of_report: string | null }>(
    `select distinct to_char(period_of_report, 'YYYY-MM-DD') as period_of_report from insider_transactions where issuer_id = $1`,
    [issuerId],
  );
  assert.deepEqual(periods.rows.map((r) => r.period_of_report), ["2026-06-09"], "period_of_report stored on the plain 4");

  const events = await client.query(`select count(*)::int as n from events where event_type = 'insider_transaction'`);
  assert.equal(events.rows[0]!.n, 2, "an event per transaction");

  const claims = await client.query(`select count(*)::int as n from claims where predicate = 'insider.transaction'`);
  assert.equal(claims.rows[0]!.n, 1, "only the material P purchase becomes a claim");

  const args = await client.query<{ subject_kind: string; subject_id: string }>(
    `select subject_kind, subject_id::text as subject_id from claim_arguments`,
  );
  assert.equal(args.rows.length, 1);
  assert.equal(args.rows[0]!.subject_kind, "issuer");
  assert.equal(args.rows[0]!.subject_id, issuerId);
});

test("handleForm4 skips an untracked issuer CIK without writing", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-untracked");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  // No issuer seeded → CIK 320193 is not tracked.
  const result = await handleForm4(entry(), { db, objectStore: new MemoryObjectStore(), client: fakeClient() } as unknown as FormHandlerDeps);
  assert.equal(result.ingested, false);
  const txns = await client.query(`select count(*)::int as n from insider_transactions`);
  assert.equal(txns.rows[0]!.n, 0, "nothing written for an untracked issuer");
});

// A Form 4 whose only activity is in the derivative table (e.g. an option
// exercise). This extractor parses non-derivative transactions only, so it
// yields zero transactions — the handler must NOT persist a documents row, or
// the accession would be marked done and masked from future reprocessing.
const DERIVATIVE_ONLY_TXT = `<SEC-DOCUMENT>
<DOCUMENT><TYPE>4<TEXT><XML>
<ownershipDocument>
  <issuer><issuerCik>0000320193</issuerCik></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0001214156</rptOwnerCik><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle><isTenPercentOwner>0</isTenPercentOwner></reportingOwnerRelationship>
  </reportingOwner>
  <derivativeTable>
    <derivativeTransaction>
      <transactionDate><value>2026-06-10</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
    </derivativeTransaction>
  </derivativeTable>
</ownershipDocument>
</XML></TEXT></DOCUMENT></SEC-DOCUMENT>`;

test("handleForm4 skips a derivative-only filing without persisting an orphan document", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-derivative-only");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await client.query(`insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193')`);

  const deps = {
    db,
    objectStore: new MemoryObjectStore(),
    client: {
      fetchFiling: async () => ({
        bytes: new TextEncoder().encode(DERIVATIVE_ONLY_TXT),
        contentType: "text/plain",
        retrievedAt: "2026-06-11T00:00:00.000Z",
        url: `https://www.sec.gov/Archives/edgar/data/320193/x/${ACCESSION}.txt`,
      }),
    },
  } as unknown as FormHandlerDeps;

  const result = await handleForm4(entry(), deps);
  assert.equal(result.ingested, false, "no non-derivative transactions → not ingested");

  const docs = await client.query(`select count(*)::int as n from documents`);
  assert.equal(docs.rows[0]!.n, 0, "no orphan documents row — the filing can be reprocessed later");
  const txns = await client.query(`select count(*)::int as n from insider_transactions`);
  assert.equal(txns.rows[0]!.n, 0, "no read-model rows");
});

const AMENDMENT_ACCESSION = "0000320193-26-000051";

// A 4/A amending the original: same issuer / owner / period (earliest txn 2026-06-09),
// but the P purchase is corrected 1000 → 800 shares. Carries an explicit <periodOfReport>.
const AMENDMENT_TXT = `<SEC-DOCUMENT>
<DOCUMENT><TYPE>4/A<TEXT><XML>
<ownershipDocument>
  <periodOfReport>2026-06-09</periodOfReport>
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
        <transactionShares><value>800</value></transactionShares>
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

function clientReturning(txt: string, accession: string) {
  return {
    fetchFiling: async () => ({
      bytes: new TextEncoder().encode(txt),
      contentType: "text/plain",
      retrievedAt: "2026-06-12T00:00:00.000Z",
      url: `https://www.sec.gov/Archives/edgar/data/320193/x/${accession}.txt`,
    }),
  };
}

function amendmentEntry(): FilingIndexEntry {
  return {
    cik: 320193,
    company: "Apple Inc.",
    form: "4/A",
    filedDate: "2026-06-12",
    fileName: `edgar/data/320193/${AMENDMENT_ACCESSION}.txt`,
    accession: AMENDMENT_ACCESSION,
  };
}

test("handleForm4 supersedes the original filing on a 4/A amendment (no double-count)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-amend");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const issuerId = (
    await client.query<{ issuer_id: string }>(
      `insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193') returning issuer_id::text as issuer_id`,
    )
  ).rows[0]!.issuer_id;

  // Original 4: P 1000 (material) + A 500 → 2 rows, 1 claim, 2 events.
  await handleForm4(entry(), { db, objectStore: new MemoryObjectStore(), client: fakeClient() } as unknown as FormHandlerDeps);
  // 4/A restating the same (issuer, owner, period) with P corrected to 800.
  await handleForm4(
    amendmentEntry(),
    { db, objectStore: new MemoryObjectStore(), client: clientReturning(AMENDMENT_TXT, AMENDMENT_ACCESSION) } as unknown as FormHandlerDeps,
  );

  const txns = await client.query<{ n: number; p_shares: string | null }>(
    `select count(*)::int as n, sum(case when transaction_code = 'P' then shares else 0 end) as p_shares
       from insider_transactions where issuer_id = $1`,
    [issuerId],
  );
  assert.equal(txns.rows[0]!.n, 2, "amendment replaces the original — 2 rows, not 4 (no double-count)");
  assert.equal(Number(txns.rows[0]!.p_shares), 800, "the corrected P share count, not stale 1000 or summed 1800");

  const claims = await client.query<{ n: number }>(`select count(*)::int as n from claims where predicate = 'insider.transaction'`);
  assert.equal(claims.rows[0]!.n, 1, "one material claim — the original's was superseded, not duplicated");
  const events = await client.query<{ n: number }>(`select count(*)::int as n from events where event_type = 'insider_transaction'`);
  assert.equal(events.rows[0]!.n, 2, "two events — the original's were superseded, not duplicated");
});

// A single-(P)-transaction Form 4/4-A on 2026-06-10, parameterized for the supersede
// edge cases. Omitting ownerCik exercises the NULL-cik name-match branch; omitting
// period relies on the earliest-transaction fallback (2026-06-10).
function form4Txt(opts: { form: string; ownerCik: string | null; period?: string; pShares: number }): string {
  const cikTag = opts.ownerCik ? `<rptOwnerCik>${opts.ownerCik}</rptOwnerCik>` : "";
  const periodTag = opts.period ? `<periodOfReport>${opts.period}</periodOfReport>` : "";
  return `<SEC-DOCUMENT>
<DOCUMENT><TYPE>${opts.form}<TEXT><XML>
<ownershipDocument>
  ${periodTag}
  <issuer><issuerCik>0000320193</issuerCik></issuer>
  <reportingOwner>
    <reportingOwnerId>${cikTag}<rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle><isTenPercentOwner>0</isTenPercentOwner></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-06-10</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>${opts.pShares}</value></transactionShares>
        <transactionPricePerShare><value>150.25</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>
</XML></TEXT></DOCUMENT></SEC-DOCUMENT>`;
}

function entryFor(form: string, accession: string): FilingIndexEntry {
  return { cik: 320193, company: "Apple Inc.", form, filedDate: "2026-06-12", fileName: `edgar/data/320193/${accession}.txt`, accession };
}

async function seedApple(client: { query: QueryExecutor["query"] }): Promise<string> {
  return (
    await client.query<{ issuer_id: string }>(
      `insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193') returning issuer_id::text as issuer_id`,
    )
  ).rows[0]!.issuer_id;
}

async function pShareCount(client: { query: QueryExecutor["query"] }, issuerId: string): Promise<{ rows: number; shares: number }> {
  const r = await client.query<{ n: number; p: string | null }>(
    `select count(*)::int as n, sum(case when transaction_code = 'P' then shares else 0 end) as p
       from insider_transactions where issuer_id = $1`,
    [issuerId],
  );
  return { rows: r.rows[0]!.n, shares: Number(r.rows[0]!.p ?? 0) };
}

test("handleForm4 supersedes a NULL-CIK owner by name (4/A name-match branch)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-amend-nocik");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const issuerId = await seedApple(client);
  const deps = (txt: string) => ({ db, objectStore: new MemoryObjectStore(), client: { fetchFiling: async () => ({ bytes: new TextEncoder().encode(txt), contentType: "text/plain", retrievedAt: "2026-06-12T00:00:00.000Z", url: "https://www.sec.gov/x.txt" }) } } as unknown as FormHandlerDeps);

  await handleForm4(entryFor("4", "0000320193-26-000060"), deps(form4Txt({ form: "4", ownerCik: null, pShares: 1000 })));
  await handleForm4(entryFor("4/A", "0000320193-26-000061"), deps(form4Txt({ form: "4/A", ownerCik: null, pShares: 700 })));

  const { rows, shares } = await pShareCount(client, issuerId);
  assert.equal(rows, 1, "no-CIK owner superseded by name — 1 row, not 2");
  assert.equal(shares, 700, "the corrected share count");
});

test("handleForm4 ingests a 4/A with no prior filing (insert-only, supersede is a no-op)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-amend-noprior");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const issuerId = await seedApple(client);
  const deps = { db, objectStore: new MemoryObjectStore(), client: { fetchFiling: async () => ({ bytes: new TextEncoder().encode(form4Txt({ form: "4/A", ownerCik: "0001214156", pShares: 800 })), contentType: "text/plain", retrievedAt: "2026-06-12T00:00:00.000Z", url: "https://www.sec.gov/x.txt" }) } } as unknown as FormHandlerDeps;

  const result = await handleForm4(entryFor("4/A", "0000320193-26-000062"), deps);
  assert.equal(result.ingested, true);
  const { rows, shares } = await pShareCount(client, issuerId);
  assert.equal(rows, 1, "amendment inserted normally when there is nothing to supersede");
  assert.equal(shares, 800);
});

test("handleForm4 chains supersession: 4 -> 4/A -> 4/A'", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-amend-chain");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const issuerId = await seedApple(client);
  const deps = (txt: string) => ({ db, objectStore: new MemoryObjectStore(), client: { fetchFiling: async () => ({ bytes: new TextEncoder().encode(txt), contentType: "text/plain", retrievedAt: "2026-06-12T00:00:00.000Z", url: "https://www.sec.gov/x.txt" }) } } as unknown as FormHandlerDeps);

  await handleForm4(entryFor("4", "0000320193-26-000063"), deps(form4Txt({ form: "4", ownerCik: "0001214156", pShares: 1000 })));
  await handleForm4(entryFor("4/A", "0000320193-26-000064"), deps(form4Txt({ form: "4/A", ownerCik: "0001214156", pShares: 800 })));
  await handleForm4(entryFor("4/A", "0000320193-26-000065"), deps(form4Txt({ form: "4/A", ownerCik: "0001214156", pShares: 700 })));

  const { rows, shares } = await pShareCount(client, issuerId);
  assert.equal(rows, 1, "each amendment supersedes the prior — 1 row after the chain, not 3");
  assert.equal(shares, 700, "the latest amendment wins");
  const claims = await client.query<{ n: number }>(`select count(*)::int as n from claims where predicate = 'insider.transaction'`);
  assert.equal(claims.rows[0]!.n, 1, "one material claim after the chain, not three");
});

test("handleForm4 supersedes across a CIK-presence change (original null-CIK, amendment with CIK)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-amend-cikchange");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const issuerId = await seedApple(client);
  const deps = (txt: string) =>
    ({ db, objectStore: new MemoryObjectStore(), client: { fetchFiling: async () => ({ bytes: new TextEncoder().encode(txt), contentType: "text/plain", retrievedAt: "2026-06-12T00:00:00.000Z", url: "https://www.sec.gov/x.txt" }) } }) as unknown as FormHandlerDeps;

  // Original omits rptOwnerCik (parser stores null); the amendment includes it — the
  // supersede must still match the same owner by name across that change.
  await handleForm4(entryFor("4", "0000320193-26-000066"), deps(form4Txt({ form: "4", ownerCik: null, pShares: 1000 })));
  await handleForm4(entryFor("4/A", "0000320193-26-000067"), deps(form4Txt({ form: "4/A", ownerCik: "0001214156", pShares: 700 })));

  const { rows, shares } = await pShareCount(client, issuerId);
  assert.equal(rows, 1, "matched by name across the CIK-presence change — 1 row, not 2");
  assert.equal(shares, 700);
});
