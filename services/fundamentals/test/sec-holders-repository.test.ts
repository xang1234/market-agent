import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecHoldersRepository, type HoldersQueryExecutor } from "../src/sec-holders-repository.ts";

const ISSUER = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";

function fakeDb(rows: unknown[]): HoldersQueryExecutor {
  return { query: async () => ({ rows }) } as unknown as HoldersQueryExecutor;
}

test("createSecHoldersRepository returns null for institutional (falls through)", async () => {
  const repo = createSecHoldersRepository(fakeDb([{ insider_name: "x" }]));
  assert.equal(await repo.find(ISSUER as never, "institutional"), null);
});

test("createSecHoldersRepository returns null when there are no insider rows", async () => {
  const repo = createSecHoldersRepository(fakeDb([]));
  assert.equal(await repo.find(ISSUER as never, "insider"), null);
});

test("createSecHoldersRepository maps insider rows into a frozen envelope", async () => {
  const repo = createSecHoldersRepository(
    fakeDb([
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
    ]),
  );
  const env = await repo.find(ISSUER as never, "insider");
  assert.ok(env, "expected an envelope");
  assert.equal(env.kind, "insider");
  assert.equal(env.source_id, SOURCE);
  assert.equal(env.currency, "USD");
  assert.equal(env.holders.length, 1);
  assert.equal(env.holders[0]!.transaction_type, "buy");
  assert.equal(env.holders[0]!.shares, 1000);
  assert.equal(env.holders[0]!.price, 150.25);
  assert.equal(env.holders[0]!.value, 150250);
});
