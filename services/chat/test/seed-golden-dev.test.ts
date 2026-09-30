import assert from "node:assert/strict";
import test from "node:test";

import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { assertNoGoldenDataset, seedGoldenDevDatabase } from "../scripts/seed-golden-dev.ts";
import { GOLDEN_COMPANIES } from "./golden/dataset.ts";

test("seedGoldenDevDatabase seeds the frozen dataset once and is a no-op on rerun", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-dev-seed");
  const client = await connectedClient(t, databaseUrl);

  assert.equal(await seedGoldenDevDatabase(databaseUrl), "seeded");
  const factsAfterFirst = (await client.query<{ n: number }>(`select count(*)::int as n from facts`)).rows[0]!.n;
  assert.ok(factsAfterFirst > 0);

  // dev-shell reruns this on every `up`.
  assert.equal(await seedGoldenDevDatabase(databaseUrl), "already-seeded");
  const factsAfterSecond = (await client.query<{ n: number }>(`select count(*)::int as n from facts`)).rows[0]!.n;
  assert.equal(factsAfterSecond, factsAfterFirst);

  const tickers = (await client.query<{ ticker: string }>(`select ticker from listings order by ticker`)).rows.map((r) => r.ticker);
  assert.deepEqual(tickers, GOLDEN_COMPANIES.map((c) => c.ticker).sort());
});

test("assertNoGoldenDataset passes on a live database and rejects one holding the frozen dataset", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-dev-assert-absent");
  await assertNoGoldenDataset(databaseUrl);
  await seedGoldenDevDatabase(databaseUrl);
  await assert.rejects(() => assertNoGoldenDataset(databaseUrl), /frozen golden dataset.*down -v/s);
});

test("seedGoldenDevDatabase leaves nothing half-seeded when a golden ticker is already taken", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-dev-seed-conflict");
  const client = await connectedClient(t, databaseUrl);
  // A provider-hydrated AAPL (different ids) already holds XNAS:AAPL.
  const issuer = await client.query<{ id: string }>(
    `insert into issuers (legal_name, cik) values ('Apple Inc.', '0000320193') returning issuer_id::text as id`,
  );
  const instrument = await client.query<{ id: string }>(
    `insert into instruments (issuer_id, asset_type) values ($1::uuid, 'common_stock') returning instrument_id::text as id`,
    [issuer.rows[0]!.id],
  );
  await client.query(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone) values ($1::uuid, 'XNAS', 'AAPL', 'USD', 'America/New_York')`,
    [instrument.rows[0]!.id],
  );

  await assert.rejects(() => seedGoldenDevDatabase(databaseUrl), /golden dataset.*fresh database/i);
  const facts = (await client.query<{ n: number }>(`select count(*)::int as n from facts`)).rows[0]!.n;
  assert.equal(facts, 0, "the failed seed rolled back entirely");
});
