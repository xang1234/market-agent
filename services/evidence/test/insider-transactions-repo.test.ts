import { test } from "node:test";
import assert from "node:assert/strict";
import { insertInsiderTransaction, findRecentByIssuer } from "../src/insider-transactions-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const ISSUER = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";

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

test("insertInsiderTransaction inserts every column in order", async () => {
  const { db, calls } = fakeDb();
  await insertInsiderTransaction(db, {
    issuer_id: ISSUER,
    insider_name: "COOK TIMOTHY D",
    insider_role: "Chief Executive Officer",
    insider_cik: "0001214156",
    transaction_date: "2026-06-10",
    transaction_code: "P",
    transaction_type: "buy",
    acquired_disposed: "A",
    shares: 1000,
    price: 150.25,
    value: 150250,
    source_id: SOURCE,
    accession: "0000320193-26-000050",
    period_of_report: "2026-06-09",
    filed_at: "2026-06-11T00:00:00Z",
  });
  assert.match(calls[0].text, /insert into insider_transactions/i);
  assert.deepEqual(calls[0].values, [
    ISSUER, "COOK TIMOTHY D", "Chief Executive Officer", "0001214156", "2026-06-10",
    "P", "buy", "A", 1000, 150.25, 150250, SOURCE, "0000320193-26-000050", "2026-06-09", "2026-06-11T00:00:00Z",
  ]);
});

test("findRecentByIssuer scopes to issuer + window and maps numerics", async () => {
  const { db, calls } = fakeDb([
    {
      insider_name: "COOK TIMOTHY D",
      insider_role: "Chief Executive Officer",
      transaction_date: "2026-06-10",
      transaction_type: "buy",
      shares: "1000",
      price: "150.25",
      value: "150250",
      source_id: SOURCE,
      filed_at: "2026-06-11T00:00:00.000Z",
    },
  ]);
  const rows = await findRecentByIssuer(db, ISSUER, 180);
  assert.match(calls[0].text, /from insider_transactions/i);
  assert.match(calls[0].text, /where issuer_id = \$1/i);
  assert.match(calls[0].text, /transaction_date >= current_date - \$2/i);
  assert.match(calls[0].text, /order by transaction_date desc/i);
  assert.deepEqual(calls[0].values, [ISSUER, 180]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shares, 1000);
  assert.equal(rows[0].price, 150.25);
  assert.equal(rows[0].transaction_type, "buy");
});

test("findRecentByIssuer keeps null price/value null", async () => {
  const { db } = fakeDb([
    {
      insider_name: "JONES PATRICIA A",
      insider_role: "Director",
      transaction_date: "2026-05-01",
      transaction_type: "gift",
      shares: "200",
      price: null,
      value: null,
      source_id: SOURCE,
      filed_at: "2026-05-02T00:00:00.000Z",
    },
  ]);
  const rows = await findRecentByIssuer(db, ISSUER, 90);
  assert.equal(rows[0].price, null);
  assert.equal(rows[0].value, null);
  assert.equal(rows[0].shares, 200);
});
