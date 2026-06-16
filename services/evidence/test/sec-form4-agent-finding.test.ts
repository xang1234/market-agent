import test from "node:test";
import assert from "node:assert/strict";

import { handleForm4 } from "../src/sec-form4-handler.ts";
import { loadLocalRuntimeEvidence } from "../src/local-runtime-evidence.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { FilingIndexEntry } from "../src/sec-daily-index.ts";
import type { FormHandlerDeps } from "../src/sec-daily-crawl.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

// End-to-end acceptance for the Form 4 slice: a listing-scoped agent universe
// surfaces a material insider claim that the handler attaches to the ISSUER,
// proving the whole chain — handler → issuer-attributed claim → ADR-0001
// universe→issuer expansion in the delta query. The materiality gate is the
// other half: a sub-threshold buy is recorded in the read model but never
// becomes a surfaced claim.

const ISSUER_ID = "b1111111-1111-4111-8111-111111111111";
const INSTRUMENT_ID = "b2222222-2222-4222-8222-222222222222";
const LISTING_ID = "b3333333-3333-4333-8333-333333333333";

const MATERIAL_ACCESSION = "0000320193-26-000050"; // CEO buys 1000 @ $150.25 = $150,250 → material
const SUB_ACCESSION = "0000320193-26-000051"; //      CEO buys 100 @ $50.00 = $5,000 → sub-threshold

// A single-transaction open-market purchase (code P) by the CEO. value is
// derived as shares * price, which the materiality gate compares to $100k.
function form4Txt(shares: number, price: string): string {
  return `<SEC-DOCUMENT>
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
        <transactionShares><value>${shares}</value></transactionShares>
        <transactionPricePerShare><value>${price}</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>
</XML></TEXT></DOCUMENT></SEC-DOCUMENT>`;
}

function fakeClient() {
  return {
    fetchFiling: async (input: { accession_number: string }) => ({
      bytes: new TextEncoder().encode(
        input.accession_number === SUB_ACCESSION ? form4Txt(100, "50.00") : form4Txt(1000, "150.25"),
      ),
      contentType: "text/plain",
      retrievedAt: "2026-06-11T00:00:00.000Z",
      url: `https://www.sec.gov/Archives/edgar/data/320193/x/${input.accession_number}.txt`,
    }),
  };
}

function entry(accession: string): FilingIndexEntry {
  return {
    cik: 320193,
    company: "Apple Inc.",
    form: "4",
    filedDate: "2026-06-11",
    fileName: `edgar/data/320193/${accession}.txt`,
    accession,
  };
}

test("a listing-universe agent surfaces a material insider claim; a sub-threshold buy stays unsurfaced", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form4-agent-finding");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  // Tracked issuer + instrument + listing. The agent universe is the LISTING;
  // the handler attaches insider claims to the ISSUER behind it.
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Apple Inc.', '0000320193')`, [ISSUER_ID]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, 'common_stock')`, [
    INSTRUMENT_ID,
    ISSUER_ID,
  ]);
  await db.query(
    `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, $2, 'XNAS', 'AAPL', 'USD', 'America/New_York')`,
    [LISTING_ID, INSTRUMENT_ID],
  );

  const deps = { db, objectStore: new MemoryObjectStore(), client: fakeClient() } as unknown as FormHandlerDeps;
  const listingUniverse = { subject_refs: [{ kind: "listing" as const, id: LISTING_ID }] };

  // 1) Material open-market buy → exactly one issuer-attributed claim, surfaced
  //    to the listing universe through the expansion.
  assert.equal((await handleForm4(entry(MATERIAL_ACCESSION), deps)).ingested, true);

  const claimRows = await client.query<{ claim_id: string }>(
    `select claim_id::text as claim_id from claims where predicate = 'insider.transaction'`,
  );
  assert.equal(claimRows.rows.length, 1, "the material buy produced exactly one claim");
  const materialClaimId = claimRows.rows[0]!.claim_id;

  const surfaced = await loadLocalRuntimeEvidence(db, listingUniverse);
  assert.deepEqual(
    surfaced.claim_refs,
    [materialClaimId],
    "listing universe surfaces the issuer-attributed insider claim (ADR-0001 expansion)",
  );

  // 2) Sub-threshold buy → recorded in the read model, but the materiality gate
  //    blocks a claim, so the listing universe surfaces nothing new.
  assert.equal((await handleForm4(entry(SUB_ACCESSION), deps)).ingested, true);

  const txnCount = await client.query<{ n: number }>(
    `select count(*)::int as n from insider_transactions where issuer_id = $1`,
    [ISSUER_ID],
  );
  assert.equal(txnCount.rows[0]!.n, 2, "both buys are in the read model");

  const afterSub = await loadLocalRuntimeEvidence(db, listingUniverse);
  assert.deepEqual(
    afterSub.claim_refs,
    [materialClaimId],
    "the sub-threshold buy adds no surfaced claim — the materiality gate holds",
  );
});
