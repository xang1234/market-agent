import { test } from "node:test";
import assert from "node:assert/strict";
import {
  insertHolding,
  topHoldersByIssuer,
  holdingsByFiler,
  findFilerIssuerHolding,
  priorPeriodForFiler,
  supersede13fFiling,
} from "../src/institutional-holdings-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const ISSUER = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const BERKSHIRE = "0001067983";

function fakeDb(rows: unknown[] = []): { db: QueryExecutor; calls: Array<{ text: string; values: unknown[] }> } {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows } as never;
    },
  } as unknown as QueryExecutor;
  return { db, calls };
}

test("insertHolding upserts on (filer_cik, issuer_id, filing_period) with all columns in order", async () => {
  const { db, calls } = fakeDb();
  await insertHolding(db, {
    filer_cik: BERKSHIRE,
    filer_name: "BERKSHIRE HATHAWAY INC",
    issuer_id: ISSUER,
    cusip: "037833100",
    shares: 915_560_382,
    value_usd: 174_300_000_000,
    filing_period: "2026-03-31",
    filing_date: "2026-05-15",
    source_id: SOURCE,
    accession: "0001193125-26-226661",
  });
  assert.match(calls[0].text, /insert into institutional_holdings/i);
  assert.match(calls[0].text, /on conflict \(filer_cik, issuer_id, filing_period\) do update/i);
  assert.deepEqual(calls[0].values, [
    BERKSHIRE, "BERKSHIRE HATHAWAY INC", ISSUER, "037833100", 915_560_382, 174_300_000_000,
    "2026-03-31", "2026-05-15", SOURCE, "0001193125-26-226661",
  ]);
});

test("topHoldersByIssuer scopes to the issuer's latest period and maps numerics", async () => {
  const { db, calls } = fakeDb([
    {
      filer_cik: BERKSHIRE,
      filer_name: "BERKSHIRE HATHAWAY INC",
      shares: "915560382",
      value_usd: "174300000000",
      filing_period: "2026-03-31",
      filing_date: "2026-05-15",
    },
  ]);
  const holders = await topHoldersByIssuer(db, ISSUER);
  assert.match(calls[0].text, /from institutional_holdings/i);
  assert.match(calls[0].text, /filing_period = \(select max\(filing_period\)/i, "scopes to latest period");
  assert.match(calls[0].text, /order by value_usd desc/i);
  assert.equal(holders.length, 1);
  assert.equal(holders[0]!.shares, 915_560_382, "numeric string mapped to number");
  assert.equal(holders[0]!.value_usd, 174_300_000_000);
  assert.equal(holders[0]!.filer_name, "BERKSHIRE HATHAWAY INC");
});

test("holdingsByFiler returns the filer's portfolio for a period, numerics mapped", async () => {
  const { db, calls } = fakeDb([{ issuer_id: ISSUER, cusip: "037833100", shares: "100", value_usd: "5000" }]);
  const holdings = await holdingsByFiler(db, BERKSHIRE, "2026-03-31");
  assert.deepEqual(calls[0].values, [BERKSHIRE, "2026-03-31"]);
  assert.deepEqual(holdings, [{ issuer_id: ISSUER, cusip: "037833100", shares: 100, value_usd: 5000 }]);
});

test("findFilerIssuerHolding returns the holding or null", async () => {
  const hit = await findFilerIssuerHolding(
    fakeDb([{ shares: "100", value_usd: "5000" }]).db,
    BERKSHIRE,
    ISSUER,
    "2025-12-31",
  );
  assert.deepEqual(hit, { shares: 100, value_usd: 5000 });
  const miss = await findFilerIssuerHolding(fakeDb([]).db, BERKSHIRE, ISSUER, "2025-12-31");
  assert.equal(miss, null);
});

test("priorPeriodForFiler returns the most recent period before the given one, or null", async () => {
  const { db, calls } = fakeDb([{ filing_period: "2025-12-31" }]);
  const prior = await priorPeriodForFiler(db, BERKSHIRE, "2026-03-31");
  assert.match(calls[0].text, /filing_period < \$2::date/i);
  assert.deepEqual(calls[0].values, [BERKSHIRE, "2026-03-31"]);
  assert.equal(prior, "2025-12-31");
  assert.equal(await priorPeriodForFiler(fakeDb([{ filing_period: null }]).db, BERKSHIRE, "2026-03-31"), null);
});

test("supersede13fFiling deletes the period's holdings and delegates the artifact cleanup to the shared helper", async () => {
  // Two holdings share one filing's source — the captured source set must dedup to one,
  // which is then forwarded to supersedeFilingArtifacts (claims, events, documents).
  const { db, calls } = fakeDb([{ source_id: SOURCE }, { source_id: SOURCE }]);
  await supersede13fFiling(db, { filer_cik: BERKSHIRE, filing_period: "2026-03-31" });
  assert.equal(calls.length, 4, "the read-model delete + the helper's 3 artifact queries");

  // Step 1 (this repo's job): delete the whole (filer, period) portfolio, capture sources.
  assert.match(calls[0].text, /delete from institutional_holdings\s+where filer_cik = \$1 and filing_period = \$2::date/i);
  assert.match(calls[0].text, /returning source_id/i);
  assert.deepEqual(calls[0].values, [BERKSHIRE, "2026-03-31"]);

  // The deduped source set is forwarded to the shared helper (predicate/event SQL is
  // asserted in supersede-filing.test.ts). 13F uses the position_change.* LIKE prefix.
  assert.deepEqual(calls[1].values, [[SOURCE], "position_change.%"], "deduped sources + position_change LIKE prefix");
});

test("supersede13fFiling no-ops (single query, zero counts) when no prior holdings match", async () => {
  const { db, calls } = fakeDb([]); // delete matched nothing → out-of-order amendment-before-original
  const result = await supersede13fFiling(db, { filer_cik: BERKSHIRE, filing_period: "2026-03-31" });
  assert.equal(calls.length, 1, "no claims/events/documents work when nothing was superseded");
  assert.deepEqual(result, { holdings: 0, claims: 0, events: 0, documents: 0 });
});

test("supersede13fFiling rejects an empty filing_period (would silently supersede nothing)", async () => {
  await assert.rejects(() => supersede13fFiling(fakeDb().db, { filer_cik: BERKSHIRE, filing_period: "" }), /filing_period is required/);
});
