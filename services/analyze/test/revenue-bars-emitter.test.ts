import test from "node:test";
import assert from "node:assert/strict";

import { emitRevenueBarsBlock } from "../src/revenue-bars-emitter.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-0000000000ed";
const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };

// Eight quarters of revenue rows, newest-first (as the loader SQL returns them).
function quarterRows() {
  const quarters = [
    [2026, "Q1"], [2025, "Q4"], [2025, "Q3"], [2025, "Q2"],
    [2025, "Q1"], [2024, "Q4"], [2024, "Q3"], [2024, "Q2"],
  ] as const;
  return quarters.map(([fy, fp], i) => ({
    fact_id: `f0000000-0000-4000-8000-0000000000${(i + 10).toString(16).padStart(2, "0")}`,
    source_id: SRC,
    unit: "currency",
    period_kind: "fiscal_q",
    period_start: null,
    period_end: `${fy}-03-31`,
    fiscal_year: fy,
    fiscal_period: fp,
    value_num: 1_000_000_000 + i * 100_000_000,
    scale: 1,
    currency: "USD",
  }));
}

function fakeDb(rows: ReadonlyArray<Record<string, unknown>>): QueryExecutor {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string): Promise<any> {
      if (/from facts/i.test(text)) return { rows };
      throw new Error(`unexpected query: ${text}`);
    },
  } as QueryExecutor;
}

const INPUT = { primary: PRIMARY, snapshotId: SNAP, blockId: "revenue_trend-1", asOf: "2026-03-31T00:00:00.000Z" };

test("emitRevenueBarsBlock builds an 8-bar block that passes the real verifier", async () => {
  const seal = await emitRevenueBarsBlock({ db: fakeDb(quarterRows()) }, INPUT);
  assert.ok(seal, "a seal input was emitted");
  assert.equal(seal.blocks[0].kind, "revenue_bars");
  assert.equal((seal.blocks[0] as { bars: unknown[] }).bars.length, 8);
  assert.equal(seal.manifest.fact_refs.length, 8);

  const verification = await verifySnapshotSeal(seal);
  assert.equal(verification.ok, true, verification.ok ? "" : JSON.stringify(verification.failures, null, 2));
});

test("emitRevenueBarsBlock returns null when the issuer has no quarterly revenue facts", async () => {
  const seal = await emitRevenueBarsBlock({ db: fakeDb([]) }, INPUT);
  assert.equal(seal, null);
});

test("emitRevenueBarsBlock skips facts with a null value_num", async () => {
  const rows = quarterRows();
  (rows[0] as { value_num: number | null }).value_num = null;
  const seal = await emitRevenueBarsBlock({ db: fakeDb(rows) }, INPUT);
  assert.ok(seal);
  assert.equal((seal.blocks[0] as { bars: unknown[] }).bars.length, 7);
});
