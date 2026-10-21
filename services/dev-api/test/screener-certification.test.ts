// The screener's certified market cap and P/E (#444): the batch values every
// issuer the screener can show at one cutoff, in engine runs owned by the
// screener's service user, and writes each sealed figure, or the gap sealed
// instead, to the issuer-keyed read model screens read.

import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "pg";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { listRecoverableRuns, recoverRun } from "../../financial-engine/src/recovery.ts";
import { databaseUrl, engineDatabase, NVDA, seedNvda, seedValuedIssuer, type ValuedIssuer } from "../../financial-engine/test/db-fixtures.ts";
import { snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { recoveryParents } from "../src/runtime.ts";
import { certifyScreenerUniverse, parseAsOf } from "../src/screener-certification.ts";

const id = (suffix: string) => `4f000000-0000-4000-8000-000000000${suffix}`;
/** A loss maker: its P/E has no value. */
const LOSS: ValuedIssuer = { issuer: id("611"), listing: id("612"), tenK: id("613"), tenQ: id("614"), ticker: "LOSS", name: "Loss Co", close: "20.00", eps: "-0.50", shares: "1000000000" };
/** Two common-stock listings, which may have split differently: neither figure has a value. */
const DUAL: ValuedIssuer = { issuer: id("621"), listing: id("622"), tenK: id("623"), tenQ: id("624"), ticker: "DUAL", name: "Dual Listed Co", close: "50.00", eps: "2.00", shares: "500000000" };
const DUAL_SECOND_LISTING = id("625");
/** No sector, so the screener never shows it. */
const BARE: ValuedIssuer = { issuer: id("631"), listing: id("632"), tenK: id("633"), tenQ: id("634"), ticker: "BARE", name: "Unclassified Co", close: "10.00", eps: "1.00", shares: "100000000" };

/** NVDA, LOSS and DUAL as the screener shows them, and BARE, which it cannot. */
async function seedScreenerUniverse(db: Client): Promise<void> {
  await seedNvda(db);
  for (const subject of [LOSS, DUAL, BARE]) await seedValuedIssuer(db, subject);
  await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNYS', 'DUAL', 'USD', 'America/New_York')`, [DUAL_SECOND_LISTING, DUAL.issuer]);
  await db.query(`update issuers set domicile = 'US', sector = 'Technology', industry = 'Semiconductors' where issuer_id = any($1::uuid[])`, [[NVDA.issuer, LOSS.issuer, DUAL.issuer]]);
}

const valuations = async (db: Client) => (await db.query(
  `select i.legal_name, v.valuation, v.value::text, v.currency, v.reason_code, v.session_date::text,
          to_char(v.knowledge_cutoff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as knowledge_cutoff
     from screener_certified_valuations v join issuers i on i.issuer_id = v.issuer_id
    order by i.legal_name, v.valuation`,
)).rows;

const ledger = async (db: Client) => (await db.query(
  `select (select count(*)::int from screener_valuation_runs) as runs,
          (select count(*)::int from financial_runs where parent_kind = 'screener_valuation_run') as financial_runs,
          (select count(*)::int from snapshot_financial_runs c join financial_runs r on r.run_id = c.run_id where r.parent_kind = 'screener_valuation_run') as certificates`,
)).rows[0];

test("the batch certifies as of now, or the pinned past cutoff an operator resumes with", () => {
  const now = new Date("2024-06-10T20:30:00.000Z");
  assert.equal(parseAsOf([], now), "2024-06-10T20:30:00.000Z");
  assert.equal(parseAsOf(["--as-of", "2024-06-10T14:00:00Z"], now), "2024-06-10T14:00:00.000Z");
  assert.throws(() => parseAsOf(["--as-of", "2024-06-11T00:00:00Z"], now), /--as-of 2024-06-11T00:00:00Z is in the future/u);
  assert.throws(() => parseAsOf(["--as-of", "Monday"], now), /usage: npm run certify:screener-universe -- \[--as-of <ISO timestamp>\]/u);
  assert.throws(() => parseAsOf(["2024-06-10"], now), /usage/u);
});

test("screener certification", { timeout: 600_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for screener certification coverage");
    return;
  }
  const db = await engineDatabase(t, "screener-certification");
  const pool = await connectedPool(t, databaseUrl(db));
  await seedScreenerUniverse(db);
  const deps = { pool, evidence: createEvidenceFinancialPort };

  await t.test("every issuer the screener can show is valued at the cutoff, and every null keeps its reason", async () => {
    const outcomes = await certifyScreenerUniverse(deps, NVDA.cutoff);
    assert.deepEqual(outcomes.map((chunk) => [chunk.issuers, chunk.outcome, chunk.rejected_units]), [[3, "published", 0]]);
    const at = { session_date: "2024-06-07", knowledge_cutoff: NVDA.cutoff };
    assert.deepEqual(await valuations(db), [
      { legal_name: "Dual Listed Co", valuation: "market_cap", value: null, currency: null, reason_code: "split_listing_unresolved", ...at },
      { legal_name: "Dual Listed Co", valuation: "pe_ratio", value: null, currency: null, reason_code: "split_listing_unresolved", ...at },
      { legal_name: "Loss Co", valuation: "market_cap", value: "20000000000", currency: "USD", reason_code: null, ...at },
      { legal_name: "Loss Co", valuation: "pe_ratio", value: null, currency: null, reason_code: "non_positive_denominator", ...at },
      // NVDA split 10-for-1 on 2024-06-10: 1200.00 / 10 x 2,464,000,000 x 10, and 120 / (11.93 / 10).
      { legal_name: "NVIDIA Corporation", valuation: "market_cap", value: "2956800000000", currency: "USD", reason_code: null, ...at },
      { legal_name: "NVIDIA Corporation", valuation: "pe_ratio", value: "100.58675607711651299245599329421626152556580050293", currency: null, reason_code: null, ...at },
    ]);
    const owners = (await db.query(`select distinct user_id::text from financial_runs where parent_kind = 'screener_valuation_run'`)).rows;
    assert.deepEqual(owners, [{ user_id: "00000000-0000-4000-8000-0000000005ee" }]);
  });

  await t.test("rerunning the cutoff resumes its run and publishes nothing twice", async () => {
    const before = await ledger(db);
    assert.deepEqual(before, { runs: 1, financial_runs: 1, certificates: 6 });
    const outcomes = await certifyScreenerUniverse(deps, NVDA.cutoff);
    assert.deepEqual(outcomes.map((chunk) => chunk.outcome), ["published"]);
    assert.deepEqual(await ledger(db), before);
  });

  await t.test("a run that finishes after a later cutoff's never replaces its figures", async () => {
    const fridayClose = "2024-06-07T21:00:00.000Z";
    assert.deepEqual((await certifyScreenerUniverse(deps, fridayClose)).map((chunk) => chunk.outcome), ["published"]);
    assert.deepEqual(await ledger(db), { runs: 2, financial_runs: 2, certificates: 12 });
    assert.deepEqual([...new Set((await valuations(db)).map((row) => row.knowledge_cutoff))], [NVDA.cutoff]);
  });

  await t.test("the worker dev-api starts finishes an interrupted run", async () => {
    const later = "2024-06-10T15:00:00.000Z";
    await db.query(`
      create function fail_screener_pe() returns trigger language plpgsql as $$
      begin
        if new.valuation = 'pe_ratio' then raise exception 'read model unavailable' using errcode = '58030'; end if;
        return new;
      end $$;
      create trigger fail_screener_pe before insert or update on screener_certified_valuations for each row execute function fail_screener_pe();`);
    let interrupted;
    try {
      [interrupted] = await certifyScreenerUniverse(deps, later);
    } finally {
      await db.query(`drop trigger fail_screener_pe on screener_certified_valuations; drop function fail_screener_pe();`);
    }
    assert.equal(interrupted?.outcome, "publication_failed");
    const cutoffs = async () => (await valuations(db)).map((row) => `${row.legal_name} ${row.valuation} ${row.knowledge_cutoff}`);
    assert.deepEqual((await cutoffs()).filter((row) => row.startsWith("NVIDIA")), [`NVIDIA Corporation market_cap ${later}`, `NVIDIA Corporation pe_ratio ${NVDA.cutoff}`]);

    const parents = recoveryParents(pool);
    const [run] = (await listRecoverableRuns(db, { parent_kinds: Object.keys(parents), limit: 50 })).filter((candidate) => candidate.parent_id === interrupted!.screener_valuation_run_id);
    assert.ok(run, "the interrupted run is recoverable");
    const client = snapshotTransactionClient(await pool.connect());
    try {
      const outcome = await recoverRun(client, run, { worker_id: "screener-recovery-test", ttl_ms: 60_000, evidence: createEvidenceFinancialPort, parents });
      assert.deepEqual([outcome.status, outcome.status === "resumed" && outcome.published], ["resumed", 3]);
    } finally {
      client.release();
    }
    assert.deepEqual([...new Set((await valuations(db)).map((row) => row.knowledge_cutoff))], [later]);
  });

  // Last: erases every run.
  await t.test("deleting a fact erases every run that bound it, and with them the figures they certified", async () => {
    const eps = (await db.query(
      `select f.fact_id::text from facts f join metrics m on m.metric_id = f.metric_id where f.subject_id = $1 and m.metric_key = 'eps_diluted'`,
      [NVDA.issuer],
    )).rows[0].fact_id;
    await db.query(`delete from facts where fact_id = $1`, [eps]);
    assert.deepEqual(await valuations(db), [], "every run valued NVDA's P/E, so every figure goes, not only NVDA's");
    assert.deepEqual(await ledger(db), { runs: 3, financial_runs: 0, certificates: 0 });
  });
});
