import test from "node:test";
import assert from "node:assert/strict";
import type { QueryExecutor } from "../src/types.ts";
import { loadVerifierFactsForRefs } from "../src/local-runtime-evidence.ts";

const FACT_ID = "11111111-1111-4111-8111-111111111111";

function recordingDb(rows: unknown[]): { db: QueryExecutor; calls: Array<{ text: string; values: unknown[] }> } {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db: QueryExecutor = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values: values ?? [] });
      return { rows, rowCount: rows.length } as never;
    },
  };
  return { db, calls };
}

test("loadVerifierFactsForRefs returns [] without a query when there are no refs", async () => {
  const { db, calls } = recordingDb([]);
  const facts = await loadVerifierFactsForRefs(db, { fact_refs: [] });
  assert.deepEqual(facts, []);
  assert.equal(calls.length, 0);
});

test("loadVerifierFactsForRefs selects verifier fact fields for active facts by id", async () => {
  const { db, calls } = recordingDb([
    {
      fact_id: FACT_ID,
      source_id: "22222222-2222-4222-8222-222222222222",
      unit: "currency",
      period_kind: "fiscal_y",
      period_start: null,
      period_end: null,
      fiscal_year: 2024,
      fiscal_period: "FY",
    },
  ]);
  const facts = await loadVerifierFactsForRefs(db, { fact_refs: [FACT_ID, FACT_ID] });
  // de-duped fact_ids bound as a uuid[] param
  assert.deepEqual(calls[0].values, [[FACT_ID]]);
  assert.match(calls[0].text, /from facts/);
  assert.match(calls[0].text, /fact_id = any\(\$1::uuid\[\]\)/);
  assert.match(calls[0].text, /superseded_by is null/);
  assert.match(calls[0].text, /invalidated_at is null/);
  assert.deepEqual(facts, [
    {
      fact_id: FACT_ID,
      source_id: "22222222-2222-4222-8222-222222222222",
      unit: "currency",
      period_kind: "fiscal_y",
      period_start: null,
      period_end: null,
      fiscal_year: 2024,
      fiscal_period: "FY",
    },
  ]);
});
