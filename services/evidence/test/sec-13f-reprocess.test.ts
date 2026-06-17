import test from "node:test";
import assert from "node:assert/strict";

import { reprocessFiler13f, type Reprocess13fDeps } from "../src/sec-13f-reprocess.ts";
import { handle13f } from "../src/sec-13f-handler.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import type { FormHandlerDeps } from "../src/sec-daily-crawl.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { submission, seedIssuerWithCusip } from "./fixtures/sec-13f.ts";

const BERKSHIRE = 1067983; // seeded superinvestor
const AAPL_CUSIP = "037833100"; // pre-seeded → already resolvable
const NVDA_CUSIP = "67066G104"; // not tracked → harvested via OpenFIGI
const UNKNOWN_CUSIP = "999999999"; // OpenFIGI has no match → stays unmapped

const OPENFIGI = { enabled: true as const, baseUrl: "https://openfigi.test", apiKey: null };
const NOW = () => new Date("2026-06-01T00:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// OpenFIGI maps only the harvested NVDA CUSIP; everything else is "no identifier".
function fakeOpenFigiFetch(): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes(NVDA_CUSIP)) {
      return jsonResponse([
        {
          data: [
            {
              ticker: "nvda",
              name: "NVIDIA CORP",
              marketSector: "Equity",
              securityType: "Common Stock",
              compositeFIGI: "BBG000BBJQV0",
              isin: "US67066G1040",
            },
          ],
        },
      ]);
    }
    return jsonResponse([{ error: "No identifier found." }]);
  }) as unknown as typeof fetch;
}

function fakeSecClient(accession: string, txt: string, filedDate = "2026-05-15"): Reprocess13fDeps["secClient"] {
  return {
    fetchSubmissions: async (_cik: number) => ({
      filings: {
        recent: {
          accessionNumber: [accession],
          form: ["13F-HR"],
          primaryDocument: [`${accession}.txt`],
          filingDate: [filedDate],
        },
      },
    }),
    fetchFiling: async (input: { accession_number: string }) => ({
      bytes: new TextEncoder().encode(txt),
      contentType: "text/plain",
      retrievedAt: "2026-05-15T00:00:00.000Z",
      url: `https://www.sec.gov/Archives/edgar/data/1067983/x/${input.accession_number}.txt`,
    }),
  } as unknown as Reprocess13fDeps["secClient"];
}

test("reprocessFiler13f harvests an unresolved CUSIP and upserts the newly-resolvable holding", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-reprocess");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  // Partial first ingest: AAPL was resolvable; NVDA's CUSIP was not tracked (skipped).
  await seedIssuerWithCusip(client, "Apple Inc.", AAPL_CUSIP);

  const txt = submission("03-31-2026", [
    { name: "APPLE INC", cusip: AAPL_CUSIP, value: 200000, shares: 1000 },
    { name: "NVIDIA CORP", cusip: NVDA_CUSIP, value: 90000, shares: 300 },
  ]);
  const deps: Reprocess13fDeps = {
    db,
    secClient: fakeSecClient("0001067983-26-000001", txt),
    openfigi: OPENFIGI,
    openfigiFetch: fakeOpenFigiFetch(),
  };

  const result = await reprocessFiler13f(deps, { cik: BERKSHIRE, now: NOW });

  assert.equal(result.cusipsEnriched, 1, "NVDA enriched via OpenFIGI (AAPL was already resolvable)");
  assert.equal(result.cusipsUnmapped, 0);
  assert.equal(result.accessionsProcessed, 1);
  assert.equal(result.holdingsUpserted, 2, "AAPL + the newly-resolvable NVDA");

  // The harvest created the NVDA instrument with its CUSIP → a tracked issuer.
  const nvda = await client.query(`select count(*)::int as n from instruments where cusip = $1`, [NVDA_CUSIP]);
  assert.equal(nvda.rows[0]!.n, 1, "NVDA instrument created with its cusip");

  // Both holdings are in the read model for the period.
  const holdings = await client.query<{ n: number }>(
    `select count(*)::int as n from institutional_holdings where filing_period = '2026-03-31'`,
  );
  assert.equal(holdings.rows[0]!.n, 2);
});

test("reprocessFiler13f is idempotent — a rerun upserts, it does not duplicate", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-reprocess-idem");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await seedIssuerWithCusip(client, "Apple Inc.", AAPL_CUSIP);

  const txt = submission("03-31-2026", [
    { name: "APPLE INC", cusip: AAPL_CUSIP, value: 200000, shares: 1000 },
    { name: "NVIDIA CORP", cusip: NVDA_CUSIP, value: 90000, shares: 300 },
  ]);
  const deps: Reprocess13fDeps = {
    db,
    secClient: fakeSecClient("0001067983-26-000002", txt),
    openfigi: OPENFIGI,
    openfigiFetch: fakeOpenFigiFetch(),
  };

  await reprocessFiler13f(deps, { cik: BERKSHIRE, now: NOW });
  const second = await reprocessFiler13f(deps, { cik: BERKSHIRE, now: NOW });

  assert.equal(second.cusipsEnriched, 0, "NVDA already resolvable on the rerun → no OpenFIGI call");
  assert.equal(second.holdingsUpserted, 2, "the rerun re-upserts the same two holdings");
  const holdings = await client.query<{ n: number }>(`select count(*)::int as n from institutional_holdings`);
  assert.equal(holdings.rows[0]!.n, 2, "still exactly two rows — no duplicates");
});

test("reprocessFiler13f leaves an OpenFIGI-unmapped CUSIP skipped (not a phantom holding)", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-reprocess-unmapped");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await seedIssuerWithCusip(client, "Apple Inc.", AAPL_CUSIP);

  const txt = submission("03-31-2026", [
    { name: "APPLE INC", cusip: AAPL_CUSIP, value: 200000, shares: 1000 },
    { name: "MYSTERY CO", cusip: UNKNOWN_CUSIP, value: 1000, shares: 10 },
  ]);
  const deps: Reprocess13fDeps = {
    db,
    secClient: fakeSecClient("0001067983-26-000003", txt),
    openfigi: OPENFIGI,
    openfigiFetch: fakeOpenFigiFetch(),
  };

  const result = await reprocessFiler13f(deps, { cik: BERKSHIRE, now: NOW });
  assert.equal(result.cusipsEnriched, 0);
  assert.equal(result.cusipsUnmapped, 1, "the unknown CUSIP could not be mapped");
  assert.equal(result.holdingsUpserted, 1, "only AAPL — the unmapped holding is not invented");
  const instruments = await client.query(`select count(*)::int as n from instruments where cusip = $1`, [UNKNOWN_CUSIP]);
  assert.equal((instruments.rows[0] as { n: number }).n, 0, "no instrument fabricated for the unmapped CUSIP");
});

test("reprocessFiler13f rejects a non-superinvestor filer before any fetch", async () => {
  const deps = { db: {}, secClient: {}, openfigi: OPENFIGI } as unknown as Reprocess13fDeps;
  await assert.rejects(() => reprocessFiler13f(deps, { cik: 9999999 }), /not a seeded superinvestor/);
});

test("reprocessFiler13f reuses the original ingest's source — no document-less source leak", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-reprocess-source");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await seedIssuerWithCusip(client, "Apple Inc.", AAPL_CUSIP);

  const accession = "0001067983-26-000004";
  const txt = submission("03-31-2026", [
    { name: "APPLE INC", cusip: AAPL_CUSIP, value: 200000, shares: 1000 },
    { name: "NVIDIA CORP", cusip: NVDA_CUSIP, value: 90000, shares: 300 },
  ]);
  // Real first ingest: AAPL resolves → persists a source + document; NVDA is skipped.
  await handle13f(
    { cik: BERKSHIRE, form: "13F-HR", filedDate: "2026-05-15", accession },
    { db, objectStore: new MemoryObjectStore(), client: fakeSecClient(accession, txt) } as unknown as FormHandlerDeps,
  );
  const sourcesBefore = (await client.query<{ n: number }>(`select count(*)::int as n from sources`)).rows[0]!.n;
  const origSourceId = (
    await client.query<{ source_id: string }>(`select source_id::text as source_id from institutional_holdings where cusip = $1`, [AAPL_CUSIP])
  ).rows[0]!.source_id;

  // Reprocess: enrich NVDA + backfill the read model, reusing the original source.
  await reprocessFiler13f(
    { db, secClient: fakeSecClient(accession, txt), openfigi: OPENFIGI, openfigiFetch: fakeOpenFigiFetch() },
    { cik: BERKSHIRE, now: NOW },
  );

  const sourcesAfter = (await client.query<{ n: number }>(`select count(*)::int as n from sources`)).rows[0]!.n;
  assert.equal(sourcesAfter, sourcesBefore, "no new source minted — the original is reused");
  const distinctSources = (await client.query<{ n: number }>(`select count(distinct source_id)::int as n from institutional_holdings`)).rows[0]!.n;
  assert.equal(distinctSources, 1, "AAPL + newly-resolved NVDA both point at the one original source");
  const aaplSourceAfter = (
    await client.query<{ source_id: string }>(`select source_id::text as source_id from institutional_holdings where cusip = $1`, [AAPL_CUSIP])
  ).rows[0]!.source_id;
  assert.equal(aaplSourceAfter, origSourceId, "AAPL still points at the original document-bearing source");
});

test("reprocessFiler13f propagates an OpenFIGI transport failure (does not swallow it as unmapped)", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-reprocess-transport");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await seedIssuerWithCusip(client, "Apple Inc.", AAPL_CUSIP); // AAPL resolvable; NVDA hits the failing fetch

  const txt = submission("03-31-2026", [
    { name: "APPLE INC", cusip: AAPL_CUSIP, value: 200000, shares: 1000 },
    { name: "NVIDIA CORP", cusip: NVDA_CUSIP, value: 90000, shares: 300 },
  ]);
  // Both a thrown network error AND a non-2xx (429) response must reject the run for
  // retry — never be counted as 'unmapped' (which would silently skip the holding).
  const throwingFetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      reprocessFiler13f(
        { db, secClient: fakeSecClient("0001067983-26-000005", txt), openfigi: OPENFIGI, openfigiFetch: throwingFetch },
        { cik: BERKSHIRE, now: NOW },
      ),
    /network down/,
  );
  const rateLimitedFetch = (async () => jsonResponse({ error: "rate limited" }, 429)) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      reprocessFiler13f(
        { db, secClient: fakeSecClient("0001067983-26-000006", txt), openfigi: OPENFIGI, openfigiFetch: rateLimitedFetch },
        { cik: BERKSHIRE, now: NOW },
      ),
    /429/,
  );
});

test("reprocessFiler13f keeps per-filer rows distinct when two filers hold the same issuer", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-reprocess-multifiler");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const aapl = await seedIssuerWithCusip(client, "Apple Inc.", AAPL_CUSIP);

  const PERSHING = 1336528; // also a seeded superinvestor
  const txt = submission("03-31-2026", [{ name: "APPLE INC", cusip: AAPL_CUSIP, value: 200000, shares: 1000 }]);
  for (const cik of [BERKSHIRE, PERSHING]) {
    await reprocessFiler13f(
      { db, secClient: fakeSecClient(`${String(cik).padStart(10, "0")}-26-000006`, txt), openfigi: OPENFIGI, openfigiFetch: fakeOpenFigiFetch() },
      { cik, now: NOW },
    );
  }
  const rows = (await client.query<{ n: number }>(`select count(*)::int as n from institutional_holdings where issuer_id = $1`, [aapl])).rows[0]!.n;
  assert.equal(rows, 2, "two filers holding AAPL → two distinct rows (unique on filer_cik,issuer,period), not a collision");
});
