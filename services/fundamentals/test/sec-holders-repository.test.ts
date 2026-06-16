import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecHoldersRepository, type HoldersQueryExecutor } from "../src/sec-holders-repository.ts";

const ISSUER = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";

function fakeDb(rows: unknown[]): HoldersQueryExecutor {
  return { query: async () => ({ rows }) } as unknown as HoldersQueryExecutor;
}

test("createSecHoldersRepository returns null for institutional when there is no coverage (falls through)", async () => {
  const repo = createSecHoldersRepository(fakeDb([]));
  assert.equal(await repo.find(ISSUER as never, "institutional"), null);
});

test("createSecHoldersRepository maps institutional rows: null percent, period as_of", async () => {
  const repo = createSecHoldersRepository(
    fakeDb([
      {
        filer_name: "Berkshire Hathaway Inc",
        shares: "915560382",
        value_usd: "174300000000",
        shares_change: "12000000",
        filing_period: "2026-03-31",
        filing_date: "2026-05-15",
        source_id: SOURCE,
      },
    ]),
  );
  const env = await repo.find(ISSUER as never, "institutional");
  assert.ok(env, "expected an envelope");
  assert.equal(env.kind, "institutional");
  assert.equal(env.currency, "USD");
  assert.equal(env.source_id, SOURCE);
  // as_of is the reporting period end, not now (the ~45-day-lag disclosure, T7).
  assert.equal(env.as_of, "2026-03-31T00:00:00.000Z");
  assert.equal(env.holders.length, 1);
  const h = env.holders[0]!;
  assert.equal(h.holder_name, "Berkshire Hathaway Inc");
  assert.equal(h.shares_held, 915_560_382);
  assert.equal(h.market_value, 174_300_000_000);
  assert.equal(h.percent_of_shares_outstanding, null, "13F carries no ownership percentage");
  assert.equal(h.shares_change, 12_000_000);
  assert.equal(h.filing_date, "2026-05-15");
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

test("createSecHoldersRepository derives as_of/source from the newest filed row, not latest transaction_date", async () => {
  const NEWER_SOURCE = "33333333-3333-4333-8333-333333333333";
  const repo = createSecHoldersRepository(
    fakeDb([
      // Rows arrive ordered by transaction_date desc (as the query returns them).
      // This one has the latest transaction_date but was filed earlier.
      {
        insider_name: "COOK TIMOTHY D",
        insider_role: "Chief Executive Officer",
        transaction_date: "2026-06-10",
        transaction_type: "buy",
        shares: "1000",
        price: "150",
        value: "150000",
        source_id: SOURCE,
        filed_at: "2026-06-11T00:00:00.000Z",
      },
      // A later-filed amendment of an OLDER trade → should drive as_of and source.
      {
        insider_name: "COOK TIMOTHY D",
        insider_role: "Chief Executive Officer",
        transaction_date: "2026-06-02",
        transaction_type: "buy",
        shares: "500",
        price: "150",
        value: "75000",
        source_id: NEWER_SOURCE,
        filed_at: "2026-06-20T00:00:00.000Z",
      },
    ]),
  );
  const env = await repo.find(ISSUER as never, "insider");
  assert.ok(env, "expected an envelope");
  assert.equal(env.as_of, "2026-06-20T00:00:00.000Z", "as_of = max filed_at, not rows[0].filed_at");
  assert.equal(env.source_id, NEWER_SOURCE, "source = the newest-filed row");
});
