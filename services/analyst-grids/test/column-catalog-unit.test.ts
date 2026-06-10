import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResult } from "pg";

import { getColumn } from "../src/column-catalog.ts";
import type { QueryExecutor } from "../src/types.ts";

// Docker-free coverage for latestMarketCapProducer. The producer's SQL needs a
// real DB, but the row -> cell/seal mapping is pure, so a fakeDb returning a
// canned fact row exercises everything except the query itself.

const FACT_ID = "11111111-1111-4111-a111-111111111111";
const SOURCE_ID = "22222222-2222-4222-a222-222222222222";
const ISSUER_ID = "33333333-3333-4333-a333-333333333333";
const SNAPSHOT_ID = "44444444-4444-4444-a444-444444444444";

type Captured = { text: string; values?: unknown[] };

function fakeDb(rows: unknown[]): { db: QueryExecutor; queries: Captured[] } {
  const queries: Captured[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows: rows as R[], rowCount: rows.length, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
  return { db, queries };
}

const FACT_ROW = {
  fact_id: FACT_ID,
  value_num: 3200000000000,
  source_id: SOURCE_ID,
  unit: "USD",
  period_kind: "point",
  period_start: null,
  period_end: "2024-03-31",
  fiscal_year: null,
  fiscal_period: null,
};

const CTX = {
  subject: { kind: "issuer" as const, id: ISSUER_ID },
  period: null,
  snapshotId: SNAPSHOT_ID,
  asOf: "2026-06-09T00:00:00.000Z",
  params: null,
};

test("latest_market_cap restricts the fact query to the 'app' entitlement channel", async () => {
  const { db, queries } = fakeDb([FACT_ROW]);
  const result = await getColumn("latest_market_cap")!.producer({ db }, CTX);

  assert.equal(result.status, "ok");
  assert.match(result.display.value, /3\.2/);
  assert.equal(result.primaryRef?.id, FACT_ID);
  assert.ok(result.seal, "expected a seal input");
  assert.match(queries[0].text, /entitlement_channels \? \$2/);
  assert.deepEqual(queries[0].values, [ISSUER_ID, "app"]);
});

test("latest_market_cap returns missing_data for a non-issuer subject (no query issued)", async () => {
  const { db, queries } = fakeDb([]);
  const result = await getColumn("latest_market_cap")!.producer(
    { db },
    { ...CTX, subject: { kind: "instrument", id: ISSUER_ID } },
  );
  assert.equal(result.status, "missing_data");
  assert.equal(queries.length, 0);
});

test("latest_market_cap returns missing_data when no fact row matches", async () => {
  const { db } = fakeDb([]);
  const result = await getColumn("latest_market_cap")!.producer({ db }, CTX);
  assert.equal(result.status, "missing_data");
  assert.equal(result.seal, undefined);
});
