import test from "node:test";
import assert from "node:assert/strict";

import { handle13f } from "../src/sec-13f-handler.ts";
import { insertHolding } from "../src/institutional-holdings-repo.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { FilingIndexEntry } from "../src/sec-daily-index.ts";
import type { FormHandlerDeps } from "../src/sec-daily-crawl.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const BERKSHIRE = 1067983; // seeded superinvestor
const AAPL_CUSIP = "037833100";
const KO_CUSIP = "191216100";
const NEW_CUSIP = "478160104";
const EXIT_CUSIP = "023135106";

type Row = { name: string; cusip: string; value: number; shares: number; putCall?: string };

function submission(periodMMDDYYYY: string, rows: Row[]): string {
  const tables = rows
    .map(
      (r) =>
        `<infoTable><nameOfIssuer>${r.name}</nameOfIssuer><cusip>${r.cusip}</cusip><value>${r.value}</value>` +
        `<shrsOrPrnAmt><sshPrnamt>${r.shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>` +
        (r.putCall ? `<putCall>${r.putCall}</putCall>` : "") +
        `</infoTable>`,
    )
    .join("\n");
  return `<SEC-DOCUMENT>
<XML><edgarSubmission><headerData><periodOfReport>${periodMMDDYYYY}</periodOfReport></headerData></edgarSubmission></XML>
<XML><informationTable>${tables}</informationTable></XML>
</SEC-DOCUMENT>`;
}

function fakeClient(txt: string) {
  return {
    fetchFiling: async (input: { accession_number: string }) => ({
      bytes: new TextEncoder().encode(txt),
      contentType: "text/plain",
      retrievedAt: "2026-05-15T00:00:00.000Z",
      url: `https://www.sec.gov/Archives/edgar/data/1067983/x/${input.accession_number}.txt`,
    }),
  };
}

function entry(accession: string, filedDate = "2026-05-15", cik = BERKSHIRE): FilingIndexEntry {
  return { cik, company: "Berkshire Hathaway Inc", form: "13F-HR", filedDate, fileName: `x/${accession}.txt`, accession };
}

async function seedIssuerWithCusip(client: { query: QueryExecutor["query"] }, name: string, cusip: string): Promise<string> {
  const r = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name) values ($1) returning issuer_id::text as issuer_id`,
    [name],
  );
  const id = r.rows[0]!.issuer_id;
  await client.query(`insert into instruments (issuer_id, asset_type, cusip) values ($1, 'common_stock', $2)`, [id, cusip]);
  return id;
}

async function seedSource(client: { query: QueryExecutor["query"] }): Promise<string> {
  const r = await client.query<{ source_id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
     values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text as source_id`,
  );
  return r.rows[0]!.source_id;
}

test("handle13f ignores a non-superinvestor filer", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-nonsuper");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const deps = { db, objectStore: new MemoryObjectStore(), client: fakeClient(submission("03-31-2026", [{ name: "APPLE INC", cusip: AAPL_CUSIP, value: 200000, shares: 1000 }])) } as unknown as FormHandlerDeps;

  const result = await handle13f(entry("0001193125-26-000001", "2026-05-15", 9999999), deps);
  assert.equal(result.ingested, false);
  assert.equal((await client.query(`select count(*)::int as n from institutional_holdings`)).rows[0]!.n, 0);
});

test("handle13f stores resolvable holdings, skips CUSIP misses, no claims on a baseline period", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-baseline");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await seedIssuerWithCusip(client, "Apple Inc.", AAPL_CUSIP);
  await seedIssuerWithCusip(client, "Coca-Cola Co", KO_CUSIP);

  const txt = submission("03-31-2026", [
    { name: "APPLE INC", cusip: AAPL_CUSIP, value: 200000, shares: 1000 },
    { name: "COCA COLA CO", cusip: KO_CUSIP, value: 30000, shares: 500 },
    { name: "UNTRACKED CO", cusip: "999999999", value: 1000, shares: 10 }, // unresolvable → skipped
  ]);
  const deps = { db, objectStore: new MemoryObjectStore(), client: fakeClient(txt) } as unknown as FormHandlerDeps;
  const result = await handle13f(entry("0001193125-26-000002"), deps);
  assert.equal(result.ingested, true);

  assert.equal((await client.query(`select count(*)::int as n from institutional_holdings`)).rows[0]!.n, 2, "two resolvable; the miss is skipped");
  assert.equal((await client.query(`select count(*)::int as n from claims where predicate like 'position_change.%'`)).rows[0]!.n, 0, "baseline period → no change claims");
});

test("handle13f emits new/increased/exit claims vs the prior period", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-changes");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const koId = await seedIssuerWithCusip(client, "Coca-Cola Co", KO_CUSIP);
  const newId = await seedIssuerWithCusip(client, "New Holding Co", NEW_CUSIP);
  const exitId = await seedIssuerWithCusip(client, "Exited Co", EXIT_CUSIP);
  const sourceId = await seedSource(client);

  // Prior period (2025-12-31): KO 100 sh, EXIT 200 sh.
  for (const [issuerId, cusip, shares] of [[koId, KO_CUSIP, 100], [exitId, EXIT_CUSIP, 200]] as const) {
    await insertHolding(db, {
      filer_cik: "0001067983", filer_name: "Berkshire Hathaway Inc", issuer_id: issuerId, cusip,
      shares, value_usd: shares * 50, filing_period: "2025-12-31", filing_date: "2026-02-14",
      source_id: sourceId, accession: "0001193125-26-000010",
    });
  }

  // Current (2026-03-31): KO 500 (was 100 → increased +400%), NEW 300 (new), EXIT absent (exited).
  const txt = submission("03-31-2026", [
    { name: "COCA COLA CO", cusip: KO_CUSIP, value: 50000, shares: 500 },
    { name: "NEW HOLDING CO", cusip: NEW_CUSIP, value: 9000, shares: 300 },
  ]);
  const deps = { db, objectStore: new MemoryObjectStore(), client: fakeClient(txt) } as unknown as FormHandlerDeps;
  assert.equal((await handle13f(entry("0001193125-26-000011"), deps)).ingested, true);

  const claims = await client.query<{ predicate: string }>(`select predicate from claims where predicate like 'position_change.%' order by predicate`);
  assert.deepEqual(
    claims.rows.map((r) => r.predicate),
    ["position_change.exit", "position_change.increased", "position_change.new_position"],
  );
  // The exit claim is attributed to the exited issuer (via claim_argument).
  const exitArg = await client.query<{ subject_id: string }>(
    `select ca.subject_id::text as subject_id from claim_arguments ca
       join claims c on c.claim_id = ca.claim_id where c.predicate = 'position_change.exit'`,
  );
  assert.equal(exitArg.rows[0]!.subject_id, exitId);
  // KO holding updated to the current period.
  const ko = await client.query<{ shares: string }>(`select shares from institutional_holdings where issuer_id = $1 and filing_period = '2026-03-31'`, [koId]);
  assert.equal(Number(ko.rows[0]!.shares), 500);
});

test("handle13f normalizes pre-2023 values from thousands to whole USD", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-units");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const id = await seedIssuerWithCusip(client, "Apple Inc.", AAPL_CUSIP);

  // A 2022 filing reports value in thousands → stored value should be ×1000.
  const txt = submission("09-30-2022", [{ name: "APPLE INC", cusip: AAPL_CUSIP, value: 50000, shares: 1000 }]);
  const deps = { db, objectStore: new MemoryObjectStore(), client: fakeClient(txt) } as unknown as FormHandlerDeps;
  await handle13f(entry("0001193125-22-000001", "2022-11-14"), deps);

  const row = await client.query<{ value_usd: string }>(`select value_usd from institutional_holdings where issuer_id = $1`, [id]);
  assert.equal(Number(row.rows[0]!.value_usd), 50_000_000, "50000 (thousands) → 50,000,000 USD");
});

test("handle13f excludes option (putCall) rows from common-share holdings", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-options");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const id = await seedIssuerWithCusip(client, "Apple Inc.", AAPL_CUSIP);

  const txt = submission("03-31-2026", [
    { name: "APPLE INC", cusip: AAPL_CUSIP, value: 200000, shares: 1000 }, // direct
    { name: "APPLE INC", cusip: AAPL_CUSIP, value: 9999, shares: 555, putCall: "Call" }, // option → excluded
  ]);
  await handle13f(entry("0001193125-26-000020"), { db, objectStore: new MemoryObjectStore(), client: fakeClient(txt) } as unknown as FormHandlerDeps);

  const row = await client.query<{ shares: string }>(`select shares from institutional_holdings where issuer_id = $1`, [id]);
  assert.equal(row.rows.length, 1);
  assert.equal(Number(row.rows[0]!.shares), 1000, "the call option's 555 shares are not counted");
});

test("handle13f sums multiple CUSIPs that resolve to the same issuer", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-multiclass");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  // One issuer, two share classes (two CUSIPs) → both resolve to the same issuer_id.
  const issuerId = await seedIssuerWithCusip(client, "Alphabet Inc.", "02079K305"); // GOOGL
  await client.query(`insert into instruments (issuer_id, asset_type, cusip) values ($1, 'common_stock', '02079K107')`, [issuerId]); // GOOG

  const txt = submission("03-31-2026", [
    { name: "ALPHABET INC CL A", cusip: "02079K305", value: 1000, shares: 100 },
    { name: "ALPHABET INC CL C", cusip: "02079K107", value: 2000, shares: 200 },
  ]);
  await handle13f(entry("0001193125-26-000021"), { db, objectStore: new MemoryObjectStore(), client: fakeClient(txt) } as unknown as FormHandlerDeps);

  const row = await client.query<{ shares: string; value_usd: string }>(
    `select shares, value_usd from institutional_holdings where issuer_id = $1`,
    [issuerId],
  );
  assert.equal(row.rows.length, 1, "one issuer-level row, not one-per-CUSIP");
  assert.equal(Number(row.rows[0]!.shares), 300, "shares summed across both classes (100 + 200)");
  assert.equal(Number(row.rows[0]!.value_usd), 3000, "value summed (1000 + 2000)");
});

test("handle13f skips exit detection when the current filing has unresolved CUSIPs", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-exitguard");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const koId = await seedIssuerWithCusip(client, "Coca-Cola Co", KO_CUSIP);
  const exitId = await seedIssuerWithCusip(client, "Exited Co", EXIT_CUSIP);
  const sourceId = await seedSource(client);

  // Prior period: KO 100 + EXIT 200.
  for (const [issuerId, cusip, shares] of [[koId, KO_CUSIP, 100], [exitId, EXIT_CUSIP, 200]] as const) {
    await insertHolding(db, {
      filer_cik: "0001067983", filer_name: "Berkshire Hathaway Inc", issuer_id: issuerId, cusip,
      shares, value_usd: shares * 50, filing_period: "2025-12-31", filing_date: "2026-02-14",
      source_id: sourceId, accession: "0001193125-26-000030",
    });
  }
  // Current: KO 500 (resolves) + an UNRESOLVABLE cusip. EXIT is absent — but because
  // a current CUSIP didn't resolve, we can't be sure EXIT was truly sold → no exit claim.
  const txt = submission("03-31-2026", [
    { name: "COCA COLA CO", cusip: KO_CUSIP, value: 50000, shares: 500 },
    { name: "MYSTERY CO", cusip: "999999999", value: 1000, shares: 10 },
  ]);
  await handle13f(entry("0001193125-26-000031"), { db, objectStore: new MemoryObjectStore(), client: fakeClient(txt) } as unknown as FormHandlerDeps);

  assert.equal(
    (await client.query(`select count(*)::int as n from claims where predicate = 'position_change.exit'`)).rows[0]!.n,
    0,
    "no exit claim emitted while current-period coverage is incomplete",
  );
  // The increased claim (KO 100→500, both periods resolved) is still reliable.
  assert.equal(
    (await client.query(`select count(*)::int as n from claims where predicate = 'position_change.increased'`)).rows[0]!.n,
    1,
    "increased still fires (issuer resolved in both periods)",
  );
});
