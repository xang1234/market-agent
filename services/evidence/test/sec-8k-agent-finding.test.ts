import test from "node:test";
import assert from "node:assert/strict";

import { handle8k } from "../src/sec-8k-handler.ts";
import { loadLocalRuntimeEvidence } from "../src/local-runtime-evidence.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { FilingIndexEntry } from "../src/sec-daily-index.ts";
import type { FormHandlerDeps } from "../src/sec-daily-crawl.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

// End-to-end acceptance for the 8-K slice: a listing-scoped agent universe
// surfaces a material-event claim that handle8k attaches to the ISSUER, proving
// the chain handle8k → issuer-attributed claim → ADR-0001 universe→issuer
// expansion. The materiality gate is the other half: a 9.01-only filing records
// an event but never a claim, so the universe surfaces nothing new.

const ISSUER_ID = "c1111111-1111-4111-8111-111111111111";
const INSTRUMENT_ID = "c2222222-2222-4222-8222-222222222222";
const LISTING_ID = "c3333333-3333-4333-8333-333333333333";

const OFFICER_ACCESSION = "0000320193-26-000011"; // Items 5.02 + 9.01 → one claim (5.02)
const EXHIBITS_ACCESSION = "0000320193-26-000012"; // Item 9.01 only → event, no claim

function header(accession: string, itemLines: string): string {
  return `<SEC-DOCUMENT>${accession}.txt : 20260430
<SEC-HEADER>${accession}.hdr.sgml : 20260430
CONFORMED SUBMISSION TYPE:	8-K
${itemLines}
</SEC-HEADER>
<DOCUMENT><TYPE>8-K<TEXT>Body.</TEXT></DOCUMENT>
</SEC-DOCUMENT>`;
}

const TXT_BY_ACCESSION: Record<string, string> = {
  [OFFICER_ACCESSION]: header(
    OFFICER_ACCESSION,
    `ITEM INFORMATION:		Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers
ITEM INFORMATION:		Financial Statements and Exhibits`,
  ),
  [EXHIBITS_ACCESSION]: header(EXHIBITS_ACCESSION, `ITEM INFORMATION:		Financial Statements and Exhibits`),
};

function fakeClient() {
  return {
    fetchFiling: async (input: { accession_number: string }) => {
      const txt = TXT_BY_ACCESSION[input.accession_number];
      assert.ok(txt, `missing fixture for accession ${input.accession_number}`);
      return {
        bytes: new TextEncoder().encode(txt),
        contentType: "text/plain",
        retrievedAt: "2026-04-30T00:00:00.000Z",
        url: `https://www.sec.gov/Archives/edgar/data/320193/x/${input.accession_number}.txt`,
      };
    },
  };
}

function entry(accession: string): FilingIndexEntry {
  return {
    cik: 320193,
    company: "Apple Inc.",
    form: "8-K",
    filedDate: "2026-04-30",
    fileName: `edgar/data/320193/${accession}.txt`,
    accession,
  };
}

test("a listing-universe agent surfaces a material 8-K claim; a 9.01-only filing stays unsurfaced", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "form8k-agent-finding");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

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

  // 1) Items 5.02 + 9.01 → exactly one issuer-attributed claim (the 5.02), surfaced
  //    to the listing universe through the expansion.
  assert.equal((await handle8k(entry(OFFICER_ACCESSION), deps)).ingested, true);

  const claimRows = await client.query<{ claim_id: string; predicate: string }>(
    `select claim_id::text as claim_id, predicate from claims`,
  );
  assert.equal(claimRows.rows.length, 1, "only the claimable 5.02 item produced a claim");
  assert.equal(claimRows.rows[0]!.predicate, "material_event.officer_change");
  const materialClaimId = claimRows.rows[0]!.claim_id;

  const surfaced = await loadLocalRuntimeEvidence(db, listingUniverse);
  assert.deepEqual(
    surfaced.claim_refs,
    [materialClaimId],
    "listing universe surfaces the issuer-attributed material-event claim (ADR-0001 expansion)",
  );

  // 2) A 9.01-only filing → recorded as an event, but the materiality gate blocks
  //    a claim, so the listing universe surfaces nothing new.
  assert.equal((await handle8k(entry(EXHIBITS_ACCESSION), deps)).ingested, true);

  const afterExhibits = await loadLocalRuntimeEvidence(db, listingUniverse);
  assert.deepEqual(
    afterExhibits.claim_refs,
    [materialClaimId],
    "the 9.01-only filing adds no surfaced claim — the materiality gate holds",
  );

  const events = await client.query<{ n: number }>(`select count(*)::int as n from events`);
  assert.equal(events.rows[0]!.n, 3, "events: 5.02 + 9.01 from the first filing, 9.01 from the second");
});
