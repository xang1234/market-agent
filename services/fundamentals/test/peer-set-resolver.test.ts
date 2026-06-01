import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PEER_LIMIT,
  createSqlPeerSetResolver,
} from "../src/peer-set-resolver.ts";
import type { FundamentalsQueryExecutor } from "../src/sec-facts-repository.ts";

const PRIMARY = "22222222-2222-4222-a222-222222222222";
const PEER_A = "33333333-3333-4333-a333-333333333333";
const PEER_B = "44444444-4444-4444-a444-444444444444";

function mockDb(rows: ReadonlyArray<{ issuer_id: string }>) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db: FundamentalsQueryExecutor = {
    // A concrete mock can't satisfy the generic query<R> return precisely; use
    // the codebase's mock-executor convention (Promise<any>) rather than an
    // `as never[]` cast on the rows.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, values?: unknown[]): Promise<any> {
      calls.push({ text, values: values ?? [] });
      return { rows };
    },
  };
  return { db, calls };
}

test("resolvePeers maps rows to issuer refs and defaults to the top-5 limit", async () => {
  const { db, calls } = mockDb([{ issuer_id: PEER_A }, { issuer_id: PEER_B }]);
  const peers = await createSqlPeerSetResolver(db).resolvePeers(PRIMARY);

  assert.deepEqual(peers, [
    { kind: "issuer", id: PEER_A },
    { kind: "issuer", id: PEER_B },
  ]);
  assert.deepEqual(calls[0].values, [PRIMARY, DEFAULT_PEER_LIMIT]);
});

test("resolvePeers passes a custom limit through", async () => {
  const { db, calls } = mockDb([]);
  await createSqlPeerSetResolver(db).resolvePeers(PRIMARY, { limit: 3 });
  assert.deepEqual(calls[0].values, [PRIMARY, 3]);
});

test("resolvePeers query ranks same-industry peers by market cap and excludes the primary", async () => {
  const { db, calls } = mockDb([]);
  await createSqlPeerSetResolver(db).resolvePeers(PRIMARY);
  const sql = calls[0].text;

  assert.match(sql, /m\.metric_key = 'market_cap'/);
  // Latest market_cap is picked deterministically (co-dated facts tie-broken).
  assert.match(sql, /order by f\.as_of desc, f\.created_at desc/);
  assert.match(sql, /peer\.industry = primary_issuer\.industry/);
  assert.match(sql, /peer\.issuer_id <> \$1/);
  assert.match(sql, /order by cap\.value_num desc nulls last/);
  assert.match(sql, /limit \$2/);
});

test("resolvePeers returns an empty set when no peers match", async () => {
  const { db } = mockDb([]);
  const peers = await createSqlPeerSetResolver(db).resolvePeers(PRIMARY);
  assert.deepEqual(peers, []);
});

test("resolvePeers rejects an invalid issuer id and a non-positive limit", async () => {
  const { db } = mockDb([]);
  const resolver = createSqlPeerSetResolver(db);
  await assert.rejects(() => resolver.resolvePeers("not-a-uuid"), /issuer_id/);
  await assert.rejects(() => resolver.resolvePeers(PRIMARY, { limit: 0 }), /limit/);
});
